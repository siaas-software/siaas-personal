import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import {
  connectFolder,
  disconnectFolder,
  readLinkedDocument,
  refreshSource,
  removeLocalDocument,
  saveImportedFile,
  scanFolder,
} from "../src/lib/local/knowledge";
const profile =
  "ollama/embeddinggemma:latest@" + "a".repeat(64) + ":retrieval-v1";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "siaas-knowledge-")),
    db = new LocalDatabase(join(root, "data"));
  const project = db.put("projects", {
    tenant_id: LOCAL_USER_ID,
    name: "Project",
  });
  const assistant = db.put("assistants", {
    tenant_id: LOCAL_USER_ID,
    project_id: project.id,
    name: "Assistant",
  });
  const folder = join(root, "manuals");
  mkdirSync(folder);
  return {
    root,
    db,
    project,
    assistant,
    folder,
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function draft(f: ReturnType<typeof fixture>, title: string, text: string) {
  const id = randomUUID();
  return f.db.put("documents", {
    id,
    tenant_id: LOCAL_USER_ID,
    assistant_id: f.assistant.id,
    title,
    kind: "txt",
    byte_size: Buffer.byteLength(text),
    storage_path: f.db.managedPath(f.assistant.id, id, title, "txt"),
  });
}
async function ready(db: LocalDatabase, id: string) {
  const { data: token } = await db.rpc("claim_document_local", {
    target_document: id,
    target_profile: profile,
  });
  assert.equal(
    (
      await db.rpc("complete_document_local", {
        target_document: id,
        target_profile: profile,
        token,
        chunks: [
          {
            content: "Indexed knowledge",
            embedding: Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)),
          },
        ],
      })
    ).error,
    null,
  );
}
test("managed copies retain originals, avoid collisions, deduplicate content and distinguish removal from deletion", () => {
  const f = fixture();
  try {
    const original = join(f.folder, "notes.txt");
    writeFileSync(original, "first");
    const one = draft(f, "notes.txt", "first");
    saveImportedFile(f.db, one.id, readFileSync(original));
    const two = draft(f, "notes.txt", "second");
    saveImportedFile(f.db, two.id, Buffer.from("second"));
    assert.notEqual(one.storage_path, two.storage_path);
    assert.match(
      one.storage_path,
      new RegExp(
        `projects/${f.project.id}/assistants/${f.assistant.id}/documents/`,
      ),
    );
    const duplicate = draft(f, "renamed.txt", "first");
    assert.deepEqual(
      saveImportedFile(f.db, duplicate.id, Buffer.from("first")),
      { id: one.id, duplicate: true },
    );
    assert.equal(f.db.get("documents", duplicate.id), null);
    removeLocalDocument(f.db, one.id, false);
    assert(existsSync(f.db.filePath(one.storage_path)));
    removeLocalDocument(f.db, two.id, true);
    assert(!existsSync(f.db.filePath(two.storage_path)));
    assert.equal(readFileSync(original, "utf8"), "first");
    assert.throws(() => f.db.filePath("projects/../../secret"));
  } finally {
    f.close();
  }
});
test("legacy files migrate on restart, preserving IDs, chunks and download links", async () => {
  const f = fixture();
  try {
    const id = randomUUID(),
      oldPath = `${LOCAL_USER_ID}/${f.assistant.id}/${id}.txt`;
    f.db.put("documents", {
      id,
      tenant_id: LOCAL_USER_ID,
      assistant_id: f.assistant.id,
      title: "Manual.txt",
      kind: "txt",
      storage_path: oldPath,
    });
    f.db.saveFile(oldPath, Buffer.from("legacy bytes"));
    await ready(f.db, id);
    const reopened = new LocalDatabase(f.db.directory);
    try {
      const doc = reopened.get("documents", id)!;
      assert(doc.storage_path.startsWith("projects/"));
      assert.equal(
        readFileSync(reopened.filePath(doc.storage_path), "utf8"),
        "legacy bytes",
      );
      assert.equal(doc.status, "ready");
      assert.equal(reopened.rows("document_chunks").length, 1);
      assert.equal(
        (
          await reopened.storage
            .from("documents")
            .fileUrl(doc.storage_path)
        ).data.url,
        `/api/local/files/${id}`,
      );
      assert(
        existsSync(
          join(reopened.assistantDirectory(f.assistant.id), "sources.json"),
        ),
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});
test("folder refresh detects additions/changes/deletions, rejects stale indexing, and disconnect preserves originals", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.folder, "a.txt"), "one");
    mkdirSync(join(f.folder, "sub"));
    writeFileSync(join(f.folder, "sub", "b.md"), "two");
    assert.equal(scanFolder(f.db, f.folder, false).files.length, 1);
    const linked = connectFolder(f.db, f.assistant.id, f.folder, true),
      sourceId = linked.source!.id;
    assert.equal(linked.queued.length, 2);
    const doc = f.db.rows("documents").find((d) => d.title === "a.txt")!;
    assert.equal(doc.storage_path, null);
    assert.equal(readLinkedDocument(f.db, doc).toString(), "one");
    await ready(f.db, doc.id);
    assert.equal(refreshSource(f.db, sourceId).queued.includes(doc.id), false);
    writeFileSync(join(f.folder, "a.txt"), "changed");
    assert.throws(() => readLinkedDocument(f.db, doc), /cambiato/);
    refreshSource(f.db, sourceId);
    assert.equal(f.db.get("documents", doc.id)!.status, "queued");
    assert.equal(f.db.rows("document_chunks").length, 0);
    const claim = await f.db.rpc("claim_document_local", {
      target_document: doc.id,
      target_profile: profile,
    });
    writeFileSync(join(f.folder, "a.txt"), "changed again");
    refreshSource(f.db, sourceId);
    assert(
      (
        await f.db.rpc("complete_document_local", {
          target_document: doc.id,
          target_profile: profile,
          token: claim.data,
          chunks: [],
        })
      ).error,
    );
    rmSync(join(f.folder, "sub", "b.md"));
    writeFileSync(join(f.folder, "new.md"), "new");
    assert.equal(refreshSource(f.db, sourceId).removed, 1);
    disconnectFolder(f.db, sourceId);
    assert.equal(f.db.rows("documents").length, 0);
    assert.equal(
      readFileSync(join(f.folder, "a.txt"), "utf8"),
      "changed again",
    );
  } finally {
    f.close();
  }
});
test("unavailable folders stop contributing; reconnect, exclusions and assistant isolation are preserved", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.folder, "a.txt"), "one");
    const source = connectFolder(f.db, f.assistant.id, f.folder, false).source!;
    const other = f.db.put("assistants", {
      tenant_id: LOCAL_USER_ID,
      project_id: f.project.id,
      name: "Other",
    });
    connectFolder(f.db, other.id, f.folder, false);
    const doc = f.db
      .rows("documents")
      .find((d) => d.assistant_id === f.assistant.id)!;
    await ready(f.db, doc.id);
    renameSync(f.folder, f.folder + "-moved");
    assert.equal(refreshSource(f.db, source.id).source!.status, "unavailable");
    assert.equal(f.db.get("documents", doc.id)!.status, "error");
    assert.equal(f.db.rows("document_chunks").length, 0);
    connectFolder(f.db, f.assistant.id, f.folder + "-moved", false, source.id);
    assert.equal(f.db.get("documents", doc.id)!.status, "queued");
    removeLocalDocument(f.db, doc.id, true);
    refreshSource(f.db, source.id);
    assert.equal(
      f.db.rows("documents").filter((d) => d.assistant_id === f.assistant.id)
        .length,
      0,
    );
    assert.equal(
      f.db.rows("documents").filter((d) => d.assistant_id === other.id).length,
      1,
    );
    assert(existsSync(join(f.folder + "-moved", "a.txt")));
  } finally {
    f.close();
  }
});
test("folder boundaries reject overlap, managed data, traversal and symbolic links", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.folder, "sub"));
    writeFileSync(join(f.folder, "a.txt"), "one");
    const secret = join(f.root, "outside.txt");
    writeFileSync(secret, "secret");
    symlinkSync(secret, join(f.folder, "shortcut.txt"));
    assert.equal(scanFolder(f.db, f.folder, true).files.length, 1);
    const source = connectFolder(f.db, f.assistant.id, f.folder, true).source!;
    assert.throws(
      () => connectFolder(f.db, f.assistant.id, join(f.folder, "sub"), false),
      /già collegata/,
    );
    assert.throws(() => scanFolder(f.db, f.db.directory, true), /esterna/);
    const doc = f.db.rows("documents")[0];
    assert.throws(
      () =>
        readLinkedDocument(f.db, { ...doc, relative_path: "../outside.txt" }),
      /non valido/,
    );
    rmSync(join(f.folder, "a.txt"));
    symlinkSync(secret, join(f.folder, "a.txt"));
    assert.throws(() => readLinkedDocument(f.db, doc), /simbolici/);
    disconnectFolder(f.db, source.id);
    assert.equal(readFileSync(secret, "utf8"), "secret");
  } finally {
    f.close();
  }
});
