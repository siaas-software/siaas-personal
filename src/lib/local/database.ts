import { researchSettingsSchema } from "../research";
import { migrateExperimentalFeatures } from "../experimental";
import { DatabaseSync } from "node:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { removeEmptyLegacyDirectories } from "./legacy-cleanup";
import { EMBEDDING_DIMENSIONS } from "../catalog";
import { LOCAL_USER_ID } from "../runtime";

type Row = Record<string, any>;
type Result<T = any> = { data: T; error: Error | null; count?: number };
const tables = [
  "workspaces",
  "projects",
  "project_templates",
  "actions",
  "assistants",
  "knowledge_sources",
  "documents",
  "document_chunks",
  "conversations",
  "messages",
] as const;
type Table = (typeof tables)[number];
const profilePattern =
  /^ollama\/embeddinggemma:latest@[a-f0-9]{64}:retrieval-v1$/;
const relations: Record<Table, Record<string, Table>> = {
  workspaces: {},
  projects: { tenant_id: "workspaces" },
  project_templates: { tenant_id: "workspaces" },
  actions: { tenant_id: "workspaces" },
  assistants: { tenant_id: "workspaces", project_id: "projects" },
  knowledge_sources: { tenant_id: "workspaces", assistant_id: "assistants" },
  documents: { tenant_id: "workspaces", assistant_id: "assistants" },
  document_chunks: {
    tenant_id: "workspaces",
    assistant_id: "assistants",
    document_id: "documents",
  },
  conversations: { tenant_id: "workspaces", assistant_id: "assistants" },
  messages: {
    tenant_id: "workspaces",
    assistant_id: "assistants",
    conversation_id: "conversations",
  },
};
export function dataDirectory() {
  return resolve(
    /* turbopackIgnore: true */ process.env.SIAAS_DATA_DIR ||
      join(homedir(), ".siaas"),
  );
}
export class LocalDatabase {
  readonly sql: DatabaseSync;
  constructor(readonly directory = dataDirectory()) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.sql = new DatabaseSync(join(directory, "siaas.sqlite"));
    this.sql.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    const version = this.sql.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version > 4)
      throw new Error(
        "Database creato da una versione più recente di SIAAS Personal.",
      );
    if (version.user_version < 2) {
      const existing = this.sql
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='assistants'",
        )
        .get();
      if (existing)
        this.sql.exec(
          "ALTER TABLE assistants ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE",
        );
    }
    for (const table of tables) {
      const refs = Object.entries(relations[table]).map(
        ([column, parent]) =>
          `${column} TEXT NOT NULL REFERENCES ${parent}(id) ON DELETE CASCADE`,
      );
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body))${refs.length ? "," + refs.join(",") : ""});`,
      );
      for (const column of Object.keys(relations[table]))
        this.sql.exec(
          `CREATE INDEX IF NOT EXISTS ${table}_${column} ON ${table}(${column});`,
        );
    }
    if (!this.get("workspaces", LOCAL_USER_ID))
      this.put("workspaces", { id: LOCAL_USER_ID, name: "My PC" });
    if (version.user_version < 2) {
      const legacy = this.rows("assistants");
      if (legacy.length) {
        const project = this.put("projects", {
          tenant_id: LOCAL_USER_ID,
          name: "My project",
          description: "",
          template_id: null,
        });
        for (const assistant of legacy)
          this.put(
            "assistants",
            { ...assistant, project_id: project.id },
            true,
          );
      }
    }
    const workspace = this.get("workspaces", LOCAL_USER_ID)!;
    if (!workspace.experimental_features) {
      this.put(
        "workspaces",
        {
          ...workspace,
          experimental_features: migrateExperimentalFeatures(undefined),
        },
        true,
      );
    }
    for (const assistant of this.rows("assistants")) {
      if (assistant.research?.version === 2) continue;
      const research = researchSettingsSchema.safeParse(
        assistant.research ?? {},
      );
      if (research.success)
        this.put("assistants", { ...assistant, research: research.data }, true);
    }
    this.sql.exec("PRAGMA user_version=4");
    this.migrateFiles();
    removeEmptyLegacyDirectories(
      directory,
      this.rows("assistants").map((a) => ({
        id: a.id,
        project_id: a.project_id,
      })),
      this.rows("knowledge_sources").map((source) => source.path),
    );
  }
  close() {
    this.sql.close();
  }
  transaction<T>(fn: () => T): T {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.sql.exec("COMMIT");
      return result;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
  get(table: Table, id: string): Row | null {
    const row = this.sql
      .prepare(`SELECT body FROM ${table} WHERE id=?`)
      .get(id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : null;
  }
  rows(table: Table): Row[] {
    return this.sql
      .prepare(`SELECT body FROM ${table}`)
      .all()
      .map((r) => JSON.parse(r.body as string));
  }
  put(table: Table, input: Row, replace = false): Row {
    const defaults: Partial<Record<Table, Row>> = {
      projects: { description: "", template_id: null, color: "#FFFFFF" },
      assistants: {
        research: researchSettingsSchema.parse({}),
        description: "",
        instructions: "",
        model_id: null,
      },
      documents: {
        status: "queued",
        error: null,
        chunk_count: 0,
        attempts: 0,
        lease_token: null,
        lease_until: null,
        embedding_model: "pending-local",
        storage_path: null,
      },
      conversations: {
        title: "New conversation",
        lease_token: null,
        lease_until: null,
      },
      messages: {
        content: "",
        status: "complete",
        sources: [],
        input_tokens: 0,
        output_tokens: 0,
      },
    };
    const row: Row = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      ...defaults[table],
      ...input,
    };
    if (table !== "workspaces" && row.tenant_id !== LOCAL_USER_ID)
      throw new Error("Spazio locale non valido.");
    if (table === "workspaces" && row.id !== LOCAL_USER_ID)
      throw new Error("Spazio locale non valido.");
    for (const [column, parent] of Object.entries(relations[table])) {
      const p = this.get(parent, row[column]);
      if (
        !p ||
        (p.tenant_id && p.tenant_id !== LOCAL_USER_ID) ||
        (p.assistant_id && p.assistant_id !== row.assistant_id)
      )
        throw new Error("Risorsa collegata non valida.");
    }
    const keys = ["id", "body", ...Object.keys(relations[table])];
    const params = [
      row.id,
      JSON.stringify(row),
      ...Object.keys(relations[table]).map((k) => row[k]),
    ];
    // Update via conflict clause preserves dependent records (REPLACE would cascade-delete them).
    this.sql
      .prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})${
          replace
            ? " ON CONFLICT(id) DO UPDATE SET " +
              keys
                .slice(1)
                .map((k) => `${k}=excluded.${k}`)
                .join(",")
            : ""
        }`,
      )
      .run(...params);
    return row;
  }
  from(table: string): LocalQuery<Row[]> {
    if (!tables.includes(table as Table))
      throw new Error("Tabella locale non disponibile.");
    return new LocalQuery<Row[]>(this, table as Table);
  }
  async rpc(name: string, args: Row): Promise<Result> {
    try {
      const data = this.transaction(() => this.call(name, args));
      if (name === "complete_document_local") {
        const doc = this.get("documents", args.target_document);
        if (doc) this.syncKnowledgeFiles(doc.assistant_id);
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  }
  private call(name: string, a: Row): any {
    if (name === "claim_conversation") {
      const c = this.get("conversations", a.target_conversation);
      if (!c || (c.lease_until && c.lease_until > new Date().toISOString()))
        return null;
      for (const m of this.rows("messages").filter(
        (m) => m.conversation_id === c.id && m.status === "pending",
      ))
        this.put(
          "messages",
          {
            ...m,
            status: "error",
            content:
              m.content ||
              "The previous response was interrupted. Please retry.",
          },
          true,
        );
      const token = randomUUID();
      this.put(
        "conversations",
        {
          ...c,
          lease_token: token,
          lease_until: new Date(Date.now() + 300_000).toISOString(),
        },
        true,
      );
      return token;
    }
    if (!profilePattern.test(a.target_profile))
      throw new Error("Profilo embedding non valido.");
    if (name === "claim_document_local") {
      const d = this.get("documents", a.target_document);
      if (
        !d ||
        d.enabled === false ||
        (d.status === "ready" && d.embedding_model === a.target_profile) ||
        (d.status === "processing" && d.lease_until > new Date().toISOString())
      )
        return null;
      const token = randomUUID();
      this.put(
        "documents",
        {
          ...d,
          status: "processing",
          error: null,
          attempts: d.attempts + 1,
          lease_token: token,
          lease_until: new Date(Date.now() + 300_000).toISOString(),
        },
        true,
      );
      return token;
    }
    if (name === "complete_document_local") {
      const d = this.get("documents", a.target_document);
      if (!d || d.status !== "processing" || d.lease_token !== a.token)
        throw new Error("Elaborazione scaduta.");
      if (!Array.isArray(a.chunks) || !a.chunks.length || a.chunks.length > 150)
        throw new Error("Frammenti non validi.");
      for (const c of a.chunks) {
        validateVector(c.embedding);
        if (
          typeof c.content !== "string" ||
          !c.content ||
          c.content.length > 4000
        )
          throw new Error("Contenuto non valido.");
      }
      this.sql
        .prepare("DELETE FROM document_chunks WHERE document_id=?")
        .run(d.id);
      a.chunks.forEach((c: Row, position: number) =>
        this.put("document_chunks", {
          tenant_id: LOCAL_USER_ID,
          assistant_id: d.assistant_id,
          document_id: d.id,
          position,
          content: c.content,
          embedding_local: c.embedding,
        }),
      );
      this.put(
        "documents",
        {
          ...d,
          status: "ready",
          error: null,
          embedding_model: a.target_profile,
          chunk_count: a.chunks.length,
          lease_token: null,
          lease_until: null,
        },
        true,
      );
      return null;
    }
    if (name === "match_documents_local") {
      validateVector(a.query_embedding);
      const docs = new Map(
        this.rows("documents")
          .filter(
            (d) =>
              d.assistant_id === a.target_assistant &&
              d.status === "ready" &&
              d.enabled !== false &&
              d.embedding_model === a.target_profile,
          )
          .map((d) => [d.id, d]),
      );
      return this.rows("document_chunks")
        .filter(
          (c) =>
            c.assistant_id === a.target_assistant && docs.has(c.document_id),
        )
        .map((c) => ({
          id: c.id,
          document_id: c.document_id,
          title: docs.get(c.document_id)!.title,
          url: docs.get(c.document_id)!.source_url,
          fetched_at: docs.get(c.document_id)!.fetched_at,
          kind: docs.get(c.document_id)!.source_url ? "website" : "document",
          content: c.content,
          position: c.position,
          similarity: cosine(c.embedding_local, a.query_embedding),
        }))
        .filter((c) => c.similarity > (a.match_threshold ?? 0.25))
        .sort((x, y) => y.similarity - x.similarity)
        .slice(0, Math.max(1, Math.min(a.match_count ?? 3, 10)));
    }
    throw new Error("Operazione locale sconosciuta.");
  }
  assistantDirectory(assistantId: string) {
    const assistant = this.get("assistants", assistantId);
    if (
      !assistant ||
      !/^[a-f0-9-]{36}$/.test(assistantId) ||
      !/^[a-f0-9-]{36}$/.test(assistant.project_id)
    )
      throw new Error("Assistente non valido.");
    return join(
      this.directory,
      "projects",
      assistant.project_id,
      "assistants",
      assistantId,
    );
  }
  managedPath(
    assistantId: string,
    documentId: string,
    title: string,
    kind: string,
  ) {
    const assistant = this.get("assistants", assistantId);
    this.assistantDirectory(assistantId);
    if (
      !/^[a-f0-9-]{36}$/.test(documentId) ||
      !/^(pdf|docx|txt|md|xlsx|csv)$/.test(kind)
    )
      throw new Error("Documento non valido.");
    // A dedicated document directory prevents collisions while retaining a readable filename.
    const name =
      title
        .replace(/[^a-zA-Z0-9._ -]/g, "_")
        .replace(/^[. ]+|[. ]+$/g, "")
        .slice(0, 100) || "document";
    const filename =
      "file-" +
      (name.toLowerCase().endsWith("." + kind) ? name : name + "." + kind);
    return `projects/${assistant!.project_id}/assistants/${assistantId}/documents/${documentId}/${filename}`;
  }
  filePath(path: string) {
    const parts = path.split("/");
    const id = /^[a-f0-9-]{36}$/;
    if (
      parts.length === 7 &&
      parts[0] === "projects" &&
      id.test(parts[1]) &&
      parts[2] === "assistants" &&
      id.test(parts[3]) &&
      parts[4] === "documents" &&
      id.test(parts[5]) &&
      /^[a-zA-Z0-9_][a-zA-Z0-9._ -]*\.(pdf|docx|txt|md|xlsx|csv)$/.test(parts[6])
    )
      return join(this.directory, ...parts);
    // Legacy paths remain readable if migration was interrupted or a file is missing.
    if (
      parts.length !== 3 ||
      parts[0] !== LOCAL_USER_ID ||
      !id.test(parts[1]) ||
      !/^[a-f0-9-]{36}\.(pdf|docx|txt|md|xlsx|csv)$/.test(parts[2])
    )
      throw new Error("Percorso file non valido.");
    return join(this.directory, "files", ...parts);
  }
  private migrateFiles() {
    for (const doc of this.rows("documents")) {
      if (!doc.storage_path || doc.storage_path.startsWith("projects/"))
        continue;
      try {
        const previous = this.filePath(doc.storage_path);
        if (!existsSync(previous)) continue;
        const path = this.managedPath(
          doc.assistant_id,
          doc.id,
          doc.title,
          doc.kind,
        );
        const next = this.filePath(path);
        mkdirSync(resolve(next, ".."), { recursive: true, mode: 0o700 });
        // Replace only this document's own migration destination after an interrupted run.
        copyFileSync(previous, next);
        this.put("documents", { ...doc, storage_path: path }, true);
        rmSync(previous, { force: true });
      } catch {
        // Keep the legacy record and original file usable; retry on next startup.
      }
    }
    for (const a of this.rows("assistants")) this.syncKnowledgeFiles(a.id);
  }
  syncKnowledgeFiles(assistantId: string) {
    // SQLite is authoritative. These human-readable files can always be rebuilt.
    try {
      const dir = this.assistantDirectory(assistantId);
      const knowledge = join(dir, "knowledge");
      mkdirSync(knowledge, { recursive: true, mode: 0o700 });
      mkdirSync(join(dir, "documents"), { recursive: true, mode: 0o700 });
      const docs = this.rows("documents").filter(
        (d) => d.assistant_id === assistantId,
      );
      const chunks = this.rows("document_chunks").filter(
        (c) => c.assistant_id === assistantId,
      );
      const write = (path: string, data: unknown) => {
        const tmp = path + ".tmp";
        writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
        renameSync(tmp, path);
      };
      write(join(dir, "sources.json"), {
        version: 1,
        assistant: {
          id: assistantId,
          name: this.get("assistants", assistantId)!.name,
        },
        project: {
          id: this.get("assistants", assistantId)!.project_id,
          name: this.get(
            "projects",
            this.get("assistants", assistantId)!.project_id,
          )!.name,
        },
        folders: this.rows("knowledge_sources").filter(
          (s) => s.assistant_id === assistantId,
        ),
        documents: docs.map(({ raw_text, ...doc }) => doc),
      });
      write(join(knowledge, "index.json"), {
        version: 1,
        documents: docs
          .filter((d) => d.status === "ready" && d.enabled !== false)
          .map((d) => ({
            id: d.id,
            title: d.title,
            embedding_model: d.embedding_model,
            chunks: chunks
              .filter((c) => c.document_id === d.id)
              .map((c) => ({ position: c.position, content: c.content })),
          })),
      });
    } catch {
      console.warn("Local knowledge manifest could not be refreshed.");
    }
  }
  saveFile(path: string, bytes: Uint8Array) {
    const target = this.filePath(path);
    mkdirSync(resolve(target, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  }
  storage = {
    from: (bucket: string) => {
      if (bucket !== "documents") throw new Error("Archivio non valido.");
      return {
        download: async (path: string) => {
          try {
            return {
              data: new Blob([readFileSync(this.filePath(path))]),
              error: null,
            };
          } catch (error) {
            return { data: null, error };
          }
        },
        remove: async (paths: string[]) => {
          try {
            paths.forEach((p) => {
              rmSync(this.filePath(p), { force: true });
              if (p.startsWith("projects/"))
                rmSync(resolve(this.filePath(p), ".."), {
                  recursive: true,
                  force: true,
                });
            });
            return { error: null };
          } catch (error) {
            return { error };
          }
        },
        fileUrl: async (path: string) => {
          this.filePath(path);
          const doc = this.rows("documents").find(
            (d) => d.storage_path === path,
          );
          if (!doc) throw new Error("Documento non trovato.");
          return {
            data: {
              url: `/api/local/files/${doc.id}`,
            },
            error: null,
          };
        },
      };
    },
  };
}
function validateVector(v: unknown): asserts v is number[] {
  if (
    !Array.isArray(v) ||
    v.length !== EMBEDDING_DIMENSIONS ||
    v.some((x) => typeof x !== "number" || !Number.isFinite(x)) ||
    !v.some((x) => x !== 0)
  )
    throw new Error("Vettore embedding non valido.");
}
function cosine(a: number[], b: number[]) {
  let dot = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    x += a[i] ** 2;
    y += b[i] ** 2;
  }
  return dot / Math.sqrt(x * y);
}
class LocalQuery<T = Row[]> implements PromiseLike<Result<T>> {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { key: string; ascending: boolean }[] = [];
  private fields = "*";
  private offset = 0;
  private max = Infinity;
  private head = false;
  private count = false;
  private cardinality = "many";
  private operation = "select";
  private values: Row[] = [];
  private cached?: Promise<Result<T>>;
  constructor(
    private db: LocalDatabase,
    private table: Table,
  ) {}
  select(fields = "*", options?: { count?: string; head?: boolean }) {
    this.fields = fields;
    this.head = !!options?.head;
    this.count = !!options?.count;
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  gte(k: string, v: string) {
    this.filters.push((r) => r[k] >= v);
    return this;
  }
  order(key: string, options?: { ascending?: boolean }) {
    this.orders.push({ key, ascending: options?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  range(start: number, end: number) {
    this.offset = start;
    this.max = end - start + 1;
    return this;
  }
  single() {
    this.cardinality = "one";
    return this as unknown as LocalQuery<Row>;
  }
  maybeSingle() {
    this.cardinality = "maybe";
    return this as unknown as LocalQuery<Row | null>;
  }
  insert(input: Row | Row[]) {
    this.operation = "insert";
    this.values = Array.isArray(input) ? input : [input];
    return this;
  }
  upsert(input: Row) {
    this.operation = "upsert";
    this.values = [input];
    return this;
  }
  update(input: Row) {
    this.operation = "update";
    this.values = [input];
    return this;
  }
  delete() {
    this.operation = "delete";
    return this;
  }
  then<R = Result<T>, U = never>(
    resolve?: ((value: Result<T>) => R | PromiseLike<R>) | null,
    reject?: ((reason: unknown) => U | PromiseLike<U>) | null,
  ): PromiseLike<R | U> {
    this.cached ??= Promise.resolve().then(() => {
      try {
        return this.db.transaction(() => {
          let rows = this.db
            .rows(this.table)
            .filter((r) => this.filters.every((f) => f(r)));
          if (this.operation === "insert" || this.operation === "upsert")
            rows = this.values.map((r) =>
              this.db.put(this.table, r, this.operation === "upsert"),
            );
          if (this.operation === "update")
            rows = rows.map((r) =>
              this.db.put(this.table, { ...r, ...this.values[0] }, true),
            );
          if (this.operation === "delete")
            rows.forEach((r) =>
              this.db.sql
                .prepare(`DELETE FROM ${this.table} WHERE id=?`)
                .run(r.id),
            );
          const count = rows.length;
          rows.sort((a, b) => {
            for (const o of this.orders) {
              const v = a[o.key] < b[o.key] ? -1 : a[o.key] > b[o.key] ? 1 : 0;
              if (v) return o.ascending ? v : -v;
            }
            return 0;
          });
          rows = rows
            .slice(this.offset, this.offset + this.max)
            .map((r) =>
              this.fields === "*"
                ? r
                : Object.fromEntries(
                    this.fields.split(",").map((k) => [k, r[k]]),
                  ),
            );
          if (
            (this.cardinality === "one" && rows.length !== 1) ||
            (this.cardinality === "maybe" && rows.length > 1)
          )
            throw new Error("Risorsa locale non trovata.");
          return {
            data: (this.head
              ? null
              : this.cardinality === "many"
                ? rows
                : (rows[0] ?? null)) as T,
            error: null,
            ...(this.count ? { count } : {}),
          };
        });
      } catch (e) {
        return { data: null as T, error: e as Error };
      }
    });
    return this.cached.then(resolve, reject);
  }
}
const globalLocal = globalThis as typeof globalThis & {
  siaasLocal?: LocalDatabase;
};
export function localDatabase() {
  return (globalLocal.siaasLocal ??= new LocalDatabase());
}
// Implements the small query/storage surface consumed by our existing routes.
// The query and storage surface operates entirely on local SQLite and files.
export function localClient() {
  return localDatabase();
}
