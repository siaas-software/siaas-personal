import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { FILE_EXTENSIONS, MAX_FILE_BYTES } from "../catalog";
import { LOCAL_USER_ID } from "../runtime";
import type { LocalDatabase } from "./database";

type Row = Record<string, any>;
export class KnowledgeError extends Error {}
export const fingerprint = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel))
  );
};

export function scanFolder(
  db: LocalDatabase,
  path: string,
  recursive: boolean,
) {
  if (!isAbsolute(path))
    throw new KnowledgeError("Inserisci il percorso completo della cartella.");
  let root: string;
  try {
    root = realpathSync(path);
    if (!lstatSync(root).isDirectory()) throw new Error();
  } catch {
    throw new KnowledgeError(
      "Cartella non disponibile. Verifica il percorso o ricollega il disco.",
    );
  }
  const data = realpathSync(db.directory);
  if (inside(data, root))
    throw new KnowledgeError(
      "Scegli una cartella esterna all’archivio gestito da SIAAS Personal.",
    );
  const files: {
    relative_path: string;
    kind: string;
    byte_size: number;
    hash: string;
  }[] = [];
  let skipped = 0,
    visited = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 30)
      throw new KnowledgeError(
        "Cartella troppo articolata. Scegli una sottocartella.",
      );
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (++visited > 5000)
        throw new KnowledgeError(
          "Troppi elementi. Scegli una cartella più specifica.",
        );
      const full = join(dir, item.name);
      if (
        item.isSymbolicLink() ||
        item.name.startsWith(".") ||
        inside(data, full)
      ) {
        skipped++;
        continue;
      }
      if (item.isDirectory()) {
        if (recursive) walk(full, depth + 1);
        continue;
      }
      const kind = extname(item.name).slice(1).toLowerCase();
      if (!item.isFile() || !FILE_EXTENSIONS.includes(kind)) {
        skipped++;
        continue;
      }
      const stat = lstatSync(full);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        !inside(root, realpathSync(full))
      ) {
        skipped++;
        continue;
      }
      if (!stat.size || stat.size > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      if (files.length >= 100)
        throw new KnowledgeError(
          "La cartella supera 100 documenti supportati. Scegli una sottocartella.",
        );
      files.push({
        relative_path: relative(root, full),
        kind,
        byte_size: stat.size,
        hash: fingerprint(readFileSync(full)),
      });
    }
  };
  try {
    walk(root, 0);
  } catch (e) {
    if (e instanceof KnowledgeError) throw e;
    throw new KnowledgeError(
      "Impossibile leggere tutti i file. Verifica i permessi e riprova.",
    );
  }
  return { path: root, files, skipped };
}

export function listSources(db: LocalDatabase, assistantId: string): Row[] {
  db.assistantDirectory(assistantId);
  return db
    .rows("knowledge_sources")
    .filter((s) => s.assistant_id === assistantId)
    .map((s) => ({
      ...s,
      document_count: db.rows("documents").filter((d) => d.source_id === s.id)
        .length,
    }));
}
function invalidate(db: LocalDatabase, doc: Row, error: string | null = null) {
  db.sql.prepare("DELETE FROM document_chunks WHERE document_id=?").run(doc.id);
  return db.put(
    "documents",
    {
      ...doc,
      status: error ? "error" : "queued",
      error,
      chunk_count: 0,
      lease_token: null,
      lease_until: null,
      embedding_model: "pending-local",
    },
    true,
  );
}
export function refreshSource(db: LocalDatabase, id: string) {
  const source = db.get("knowledge_sources", id);
  if (!source) throw new KnowledgeError("Fonte non trovata.");
  let scan: ReturnType<typeof scanFolder>;
  try {
    scan = scanFolder(db, source.path, source.recursive);
  } catch (e) {
    const error = (e as Error).message;
    db.transaction(() => {
      db.put(
        "knowledge_sources",
        {
          ...source,
          status: "unavailable",
          error,
          checked_at: new Date().toISOString(),
        },
        true,
      );
      for (const doc of db.rows("documents").filter((d) => d.source_id === id))
        invalidate(db, doc, error);
    });
    db.syncKnowledgeFiles(source.assistant_id);
    return { source: db.get("knowledge_sources", id), queued: [], removed: 0 };
  }
  const files = scan.files.filter(
    (f) => !(source.excluded_paths ?? []).includes(f.relative_path),
  );
  const existing = db.rows("documents").filter((d) => d.source_id === id);
  const others = db
    .rows("documents")
    .filter(
      (d) => d.assistant_id === source.assistant_id && d.source_id !== id,
    );
  if (others.length + files.length > 100) {
    const error =
      "Limite di 100 documenti per assistente raggiunto. Riduci i documenti o scegli una sottocartella.";
    db.transaction(() => {
      db.put(
        "knowledge_sources",
        {
          ...source,
          status: "unavailable",
          error,
          checked_at: new Date().toISOString(),
        },
        true,
      );
      for (const doc of existing) invalidate(db, doc, error);
    });
    db.syncKnowledgeFiles(source.assistant_id);
    return { source: db.get("knowledge_sources", id), queued: [], removed: 0 };
  }
  const queued: string[] = [];
  let removed = 0;
  db.transaction(() => {
    for (const old of existing) {
      if (!files.some((f) => f.relative_path === old.relative_path)) {
        db.sql.prepare("DELETE FROM documents WHERE id=?").run(old.id);
        removed++;
      }
    }
    for (const file of files) {
      let doc = existing.find((d) => d.relative_path === file.relative_path);
      if (!doc) {
        doc = db.put("documents", {
          tenant_id: LOCAL_USER_ID,
          assistant_id: source.assistant_id,
          source_id: id,
          title: basename(file.relative_path),
          kind: file.kind,
          relative_path: file.relative_path,
          byte_size: file.byte_size,
          content_hash: file.hash,
          storage_path: null,
        });
      } else if (
        doc.content_hash !== file.hash ||
        source.status === "unavailable"
      ) {
        doc = invalidate(db, {
          ...doc,
          content_hash: file.hash,
          byte_size: file.byte_size,
          kind: file.kind,
        });
      }
      if (doc.status === "queued" || doc.status === "error")
        queued.push(doc.id);
    }
    db.put(
      "knowledge_sources",
      {
        ...source,
        path: scan.path,
        status: "connected",
        error: null,
        skipped: scan.skipped,
        checked_at: new Date().toISOString(),
      },
      true,
    );
  });
  db.syncKnowledgeFiles(source.assistant_id);
  return { source: db.get("knowledge_sources", id), queued, removed };
}
export function connectFolder(
  db: LocalDatabase,
  assistantId: string,
  path: string,
  recursive: boolean,
  sourceId?: string,
) {
  db.assistantDirectory(assistantId);
  const previous = sourceId ? db.get("knowledge_sources", sourceId) : null;
  if (sourceId && (!previous || previous.assistant_id !== assistantId))
    throw new KnowledgeError("Fonte non trovata.");
  const scan = scanFolder(db, path, recursive);
  // Overlapping sources would import the same file more than once into one assistant.
  for (const other of listSources(db, assistantId)) {
    if (other.id === sourceId) continue;
    if (
      other.path === scan.path ||
      (other.recursive && inside(other.path, scan.path)) ||
      (recursive && inside(scan.path, other.path))
    )
      throw new KnowledgeError(
        "Questa cartella è già collegata, direttamente o tramite una cartella principale.",
      );
  }
  const otherDocs = db
    .rows("documents")
    .filter(
      (d) =>
        d.assistant_id === assistantId &&
        (!sourceId || d.source_id !== sourceId),
    );
  if (otherDocs.length + scan.files.length > 100)
    throw new KnowledgeError(
      "Limite di 100 documenti per assistente raggiunto.",
    );
  const source = db.put(
    "knowledge_sources",
    {
      ...previous,
      id: sourceId ?? randomUUID(),
      tenant_id: LOCAL_USER_ID,
      assistant_id: assistantId,
      path: scan.path,
      recursive,
      status: "unavailable",
      excluded_paths: previous?.excluded_paths ?? [],
      checked_at: null,
    },
    !!previous,
  );
  return refreshSource(db, source.id);
}
export function readLinkedDocument(db: LocalDatabase, doc: Row) {
  const source = db.get("knowledge_sources", doc.source_id);
  if (
    !source ||
    source.assistant_id !== doc.assistant_id ||
    source.status !== "connected"
  )
    throw new KnowledgeError("Cartella non disponibile. Aggiorna la fonte.");
  const root = realpathSync(source.path);
  if (root !== source.path)
    throw new KnowledgeError(
      "Il percorso della cartella è cambiato. Aggiorna la fonte.",
    );
  const path = resolve(root, doc.relative_path);
  // Revalidate every component; a linked file or directory must never become an escape path.
  if (!inside(root, path) || path === root)
    throw new KnowledgeError("Percorso documento non valido.");
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new KnowledgeError("I collegamenti simbolici non sono supportati.");
  }
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    !stat.size ||
    stat.size > MAX_FILE_BYTES ||
    !inside(root, realpathSync(path))
  )
    throw new KnowledgeError("File non disponibile o troppo grande.");
  const bytes = readFileSync(path);
  if (fingerprint(bytes) !== doc.content_hash)
    throw new KnowledgeError(
      "Il documento è cambiato. Premi Aggiorna adesso sulla cartella.",
    );
  return bytes;
}
export function removeLocalDocument(
  db: LocalDatabase,
  id: string,
  deleteCopy: boolean,
) {
  const doc = db.get("documents", id);
  if (!doc) throw new KnowledgeError("Documento non trovato.");
  if (deleteCopy && doc.storage_path) {
    rmSync(db.filePath(doc.storage_path), { force: true });
    if (doc.storage_path.startsWith("projects/"))
      rmSync(resolve(db.filePath(doc.storage_path), ".."), {
        recursive: true,
        force: true,
      });
  }
  db.transaction(() => {
    if (doc.source_id) {
      const source = db.get("knowledge_sources", doc.source_id);
      if (source)
        db.put(
          "knowledge_sources",
          {
            ...source,
            excluded_paths: [
              ...new Set([...(source.excluded_paths ?? []), doc.relative_path]),
            ],
          },
          true,
        );
    }
    db.sql.prepare("DELETE FROM documents WHERE id=?").run(id);
  });
  db.syncKnowledgeFiles(doc.assistant_id);
}
export function disconnectFolder(db: LocalDatabase, id: string) {
  const source = db.get("knowledge_sources", id);
  if (!source) throw new KnowledgeError("Fonte non trovata.");
  db.transaction(() => {
    for (const doc of db.rows("documents").filter((d) => d.source_id === id))
      db.sql.prepare("DELETE FROM documents WHERE id=?").run(doc.id);
    db.sql.prepare("DELETE FROM knowledge_sources WHERE id=?").run(id);
  });
  db.syncKnowledgeFiles(source.assistant_id);
}
export function saveImportedFile(
  db: LocalDatabase,
  id: string,
  bytes: Uint8Array,
) {
  const doc = db.get("documents", id);
  if (!doc?.storage_path || doc.source_id)
    throw new KnowledgeError("File non trovato.");
  const hash = fingerprint(bytes);
  const duplicate = db.rows("documents").find((d) => {
    if (d.id === id || d.assistant_id !== doc.assistant_id || !d.storage_path)
      return false;
    if (d.content_hash) return d.content_hash === hash;
    return (
      existsSync(db.filePath(d.storage_path)) &&
      fingerprint(readFileSync(db.filePath(d.storage_path))) === hash
    );
  });
  if (duplicate) {
    db.sql.prepare("DELETE FROM documents WHERE id=?").run(id);
    db.syncKnowledgeFiles(doc.assistant_id);
    return { id: duplicate.id, duplicate: true };
  }
  db.saveFile(doc.storage_path, bytes);
  db.put("documents", { ...doc, content_hash: hash }, true);
  db.syncKnowledgeFiles(doc.assistant_id);
  return { id, duplicate: false };
}
