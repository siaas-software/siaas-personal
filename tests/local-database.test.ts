import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
const profile =
  "ollama/embeddinggemma:latest@" + "a".repeat(64) + ":retrieval-v1";
const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "siaas-db-"));
  const db = new LocalDatabase(path);
  return {
    db,
    path,
    project: db.put("projects", { tenant_id: LOCAL_USER_ID, name: "Test project" }),
    clean() {
      db.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
test("local data persists across restarts; updating assistant never cascades away its documents", async () => {
  const f = fixture();
  try {
    const { data: a, error } = await f.db
      .from("assistants")
      .insert({ tenant_id: LOCAL_USER_ID, project_id: f.project.id, name: "A" })
      .select()
      .single();
    assert.equal(error, null);
    const { data: d } = await f.db
      .from("documents")
      .insert({
        tenant_id: LOCAL_USER_ID,
        assistant_id: a.id,
        title: "Notes",
        kind: "text",
        raw_text: "Stored locally",
      })
      .select()
      .single();
    await f.db.from("assistants").update({ name: "Renamed" }).eq("id", a.id);
    assert(f.db.get("documents", d.id));
    const second = new LocalDatabase(f.path);
    assert.equal(second.get("assistants", a.id)?.name, "Renamed");
    assert.equal(second.get("documents", d.id)?.raw_text, "Stored locally");
    second.close();
    const failed = await f.db
      .from("documents")
      .insert({
        tenant_id: LOCAL_USER_ID,
        assistant_id: randomUUID(),
        title: "Orphan",
      });
    assert(failed.error);
  } finally {
    f.clean();
  }
});
test("retrieval isolates assistants and model versions; failed reindex preserves chunks atomically", async () => {
  const f = fixture();
  try {
    const a = f.db.put("assistants", { tenant_id: LOCAL_USER_ID, project_id: f.project.id, name: "A" });
    const b = f.db.put("assistants", { tenant_id: LOCAL_USER_ID, project_id: f.project.id, name: "B" });
    const d = f.db.put("documents", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: a.id,
      title: "Manual",
      kind: "text",
    });
    const claim = await f.db.rpc("claim_document_local", {
      target_document: d.id,
      target_profile: profile,
    });
    assert(claim.data);
    assert.equal(
      (
        await f.db.rpc("claim_document_local", {
          target_document: d.id,
          target_profile: profile,
        })
      ).data,
      null,
    );
    assert.equal(
      (
        await f.db.rpc("complete_document_local", {
          target_document: d.id,
          token: claim.data,
          target_profile: profile,
          chunks: [{ content: "Only A sees this", embedding: vector }],
        })
      ).error,
      null,
    );
    const search = (assistant: string, p = profile) =>
      f.db.rpc("match_documents_local", {
        target_assistant: assistant,
        target_profile: p,
        query_embedding: vector,
      });
    assert.equal((await search(a.id)).data.length, 1);
    assert.equal((await search(b.id)).data.length, 0);
    const next = profile.replace("a".repeat(64), "b".repeat(64));
    assert.equal((await search(a.id, next)).data.length, 0);
    const again = await f.db.rpc("claim_document_local", {
      target_document: d.id,
      target_profile: next,
    });
    const failed = await f.db.rpc("complete_document_local", {
      target_document: d.id,
      token: again.data,
      target_profile: next,
      chunks: [{ content: "Bad", embedding: [1, 2] }],
    });
    assert(failed.error);
    assert.equal(f.db.rows("document_chunks")[0].content, "Only A sees this");
    await f.db.from("documents").delete().eq("id", d.id);
    assert.equal(f.db.rows("document_chunks").length, 0);
  } finally {
    f.clean();
  }
});
test("conversation leases reject duplicates; stale responses recover and files cannot escape local storage", async () => {
  const f = fixture();
  try {
    const a = f.db.put("assistants", { tenant_id: LOCAL_USER_ID, project_id: f.project.id, name: "A" });
    const c = f.db.put("conversations", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: a.id,
    });
    const args = { target_conversation: c.id };
    assert((await f.db.rpc("claim_conversation", args)).data);
    assert.equal((await f.db.rpc("claim_conversation", args)).data, null);
    const m = f.db.put("messages", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: a.id,
      conversation_id: c.id,
      role: "assistant",
      status: "pending",
    });
    await f.db
      .from("conversations")
      .update({ lease_until: "2000-01-01" })
      .eq("id", c.id);
    assert((await f.db.rpc("claim_conversation", args)).data);
    assert.equal(f.db.get("messages", m.id)?.status, "error");
    assert.throws(() => f.db.filePath("../../secret"));
    const path = `${LOCAL_USER_ID}/${a.id}/${randomUUID()}.txt`;
    f.db.saveFile(path, Buffer.from("Original file"));
    assert.equal(
      await (await f.db.storage.from("documents").download(path)).data?.text(),
      "Original file",
    );
    assert.throws(() => f.db.saveFile(path, Buffer.from("Overwrite")));
  } finally {
    f.clean();
  }
});
