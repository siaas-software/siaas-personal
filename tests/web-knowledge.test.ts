import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { saveWebKnowledge } from "../src/lib/local/web-knowledge";
import { removeLocalDocument } from "../src/lib/local/knowledge";
import { markdownBlocks } from "../src/lib/chat-markdown";
import { SHORTCUT_ACTIONS, shortcutPrompt } from "../src/lib/shortcuts";
const profile =
  "ollama/embeddinggemma:latest@" + "a".repeat(64) + ":retrieval-v1";
const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const reader = async (url: string) => ({
  url,
  title: "Machine handbook",
  content: "Scheduled maintenance is required every 500 hours.",
  links: [],
  fetchedAt: new Date().toISOString(),
});
test("web knowledge persists, indexes, cites, isolates, refreshes and removes", async () => {
  const root = mkdtempSync(join(tmpdir(), "siaas-web-"));
  let db = new LocalDatabase(root);
  try {
    const p = db.put("projects", { tenant_id: LOCAL_USER_ID, name: "Test" });
    const a = db.put("assistants", {
      tenant_id: LOCAL_USER_ID,
      project_id: p.id,
      name: "A",
    });
    const b = db.put("assistants", {
      tenant_id: LOCAL_USER_ID,
      project_id: p.id,
      name: "B",
    });
    const doc = await saveWebKnowledge(
      db,
      a.id,
      { url: "https://example.com/handbook#section" },
      reader,
    );
    assert.equal(doc.source_url, "https://example.com/handbook");
    assert.equal(db.get("documents", doc.id)?.status, "queued");
    await assert.rejects(
      saveWebKnowledge(db, a.id, { url: doc.source_url }, reader),
      /already/,
    );
    await assert.rejects(
      saveWebKnowledge(db, b.id, { documentId: doc.id }, reader),
      /not found/,
    );
    const token = await db.rpc("claim_document_local", {
      target_document: doc.id,
      target_profile: profile,
    });
    assert(!token.error);
    await assert.rejects(
      saveWebKnowledge(db, a.id, { documentId: doc.id }, reader),
      /being indexed/,
    );
    const result = await db.rpc("complete_document_local", {
      target_document: doc.id,
      target_profile: profile,
      token: token.data,
      chunks: [{ content: "Maintenance every 500 hours.", embedding: vector }],
    });
    assert(!result.error);
    const lookup = (assistant: string) =>
      db.rpc("match_documents_local", {
        target_assistant: assistant,
        target_profile: profile,
        query_embedding: vector,
        match_count: 3,
        match_threshold: 0.25,
      });
    const hits = await lookup(a.id);
    assert.equal(hits.data[0].url, doc.source_url);
    assert(hits.data[0].fetched_at);
    assert.equal((await lookup(b.id)).data.length, 0);
    await assert.rejects(
      saveWebKnowledge(db, a.id, { documentId: doc.id }, async () => {
        throw new Error("offline");
      }),
      /offline/,
    );
    assert.equal(db.get("documents", doc.id)?.status, "ready");
    assert.equal((await lookup(a.id)).data.length, 1);
    db.close();
    db = new LocalDatabase(root);
    assert.equal(db.get("documents", doc.id)?.source_url, doc.source_url);
    await saveWebKnowledge(db, a.id, { documentId: doc.id }, reader);
    assert.equal(db.get("documents", doc.id)?.status, "queued");
    assert.equal((await lookup(a.id)).data.length, 0);
    const manifest = JSON.parse(
      readFileSync(join(db.assistantDirectory(a.id), "sources.json"), "utf8"),
    );
    assert.equal(manifest.documents[0].source_url, doc.source_url);
    removeLocalDocument(db, doc.id, false);
    assert.equal(db.get("documents", doc.id), null);
    let called = false;
    for (const url of [
      "file:///etc/passwd",
      "http://localhost/a",
      "https://user:password@example.com/",
    ])
      await assert.rejects(
        saveWebKnowledge(db, a.id, { url }, async (...args) => {
          called = true;
          return reader(args[0]);
        }),
        /HTTP/,
      );
    assert.equal(called, false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("tables render structured cells, escape pipes and leave code fences intact", () => {
  const blocks = markdownBlocks(
    "Result\n\n| Name | Value |\n| --- | ---: |\n| A \\| B | **500** |\n\nDone",
  );
  assert.deepEqual(blocks[1], {
    headers: ["Name", "Value"],
    rows: [["A | B", "**500**"]],
  });
  assert.deepEqual(
    markdownBlocks("```md\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```"),
    [{ text: "```md\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```" }],
  );
});
test("all Shortcut prompts fit the chat limit, with user-specified table requirements", () => {
  for (const a of SHORTCUT_ACTIONS)
    assert(shortcutPrompt(a.id, "x".repeat(900)).length <= 1800);
  assert.match(
    shortcutPrompt("table", "Columns: model, interval, source"),
    /Columns: model, interval, source/,
  );
});
