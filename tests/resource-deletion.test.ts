import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { removeAssistantFiles, removeProjectFiles } from "../src/lib/delete-resource";

test("deleting assistants/projects removes uploaded files and cascades only their own data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "siaas-delete-"));
  const db = new LocalDatabase(directory);
  const client = db;
  const tenant_id = LOCAL_USER_ID;
  try {
    const project = db.put("projects", { tenant_id, name: "Delete" });
    const other = db.put("projects", { tenant_id, name: "Keep" });
    const makeAssistant = (project_id: string) => {
      const a = db.put("assistants", { tenant_id, project_id, name: "Assistant" });
      const storage_path = `${tenant_id}/${a.id}/${randomUUID()}.txt`;
      const d = db.put("documents", { tenant_id, assistant_id: a.id, storage_path });
      db.saveFile(storage_path, Buffer.from("Private"));
      db.put("document_chunks", { tenant_id, assistant_id: a.id, document_id: d.id, content: "Private" });
      const c = db.put("conversations", { tenant_id, assistant_id: a.id });
      db.put("messages", { tenant_id, assistant_id: a.id, conversation_id: c.id, content: "Private" });
      return { a, d, c, file: db.filePath(storage_path) };
    };
    const first = makeAssistant(project.id), sibling = makeAssistant(project.id), preserved = makeAssistant(other.id);
    // More than one storage page must be cleaned up as well.
    for (let i = 0; i < 101; i++) {
      const storage_path = `${tenant_id}/${first.a.id}/${randomUUID()}.txt`;
      db.put("documents", { tenant_id, assistant_id: first.a.id, storage_path });
      db.saveFile(storage_path, Buffer.from("Private"));
    }
    const files = db.rows("documents").filter(d => d.assistant_id === first.a.id).map(d => db.filePath(d.storage_path));
    await removeAssistantFiles(client, tenant_id, first.a.id);
    assert.equal((await db.from("assistants").delete().eq("id", first.a.id)).error, null);
    assert(files.every(path => !existsSync(path)));
    assert(!db.get("documents", first.d.id)); assert(!db.get("conversations", first.c.id));
    assert(db.get("assistants", sibling.a.id)); assert(existsSync(sibling.file));
    await removeProjectFiles(client, tenant_id, project.id);
    assert.equal((await db.from("projects").delete().eq("id", project.id)).error, null);
    assert(!existsSync(sibling.file));
    assert.equal(db.rows("assistants").length, 1);
    assert.equal(db.rows("document_chunks").length, 1);
    assert.equal(db.rows("messages").length, 1);
    assert(db.get("projects", other.id)); assert(existsSync(preserved.file));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
