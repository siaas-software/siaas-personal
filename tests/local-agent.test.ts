import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { createLocalAgentTools } from "../src/lib/local/agent";

test("agent tools isolate documents and persist reports before announcing success", async () => {
  const path = mkdtempSync(join(tmpdir(), "siaas-agent-"));
  const db = new LocalDatabase(path);
  try {
    const project = db.put("projects", {
      tenant_id: LOCAL_USER_ID,
      name: "Test",
    });
    const assistants = ["A", "B"].map((name) =>
      db.put("assistants", {
        tenant_id: LOCAL_USER_ID,
        project_id: project.id,
        name,
      }),
    );
    const docs = assistants.map((a) => {
      const d = db.put("documents", {
        tenant_id: LOCAL_USER_ID,
        assistant_id: a.id,
        title: a.name,
        status: "ready",
      });
      db.put("document_chunks", {
        tenant_id: LOCAL_USER_ID,
        assistant_id: a.id,
        document_id: d.id,
        position: 0,
        content: `Document ${a.name}`,
      });
      return d;
    });
    const conversation = db.put("conversations", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: assistants[0].id,
    });
    const message = db.put("messages", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: assistants[0].id,
      conversation_id: conversation.id,
      role: "assistant",
    });
    const abort = new AbortController();
    const scoped = createLocalAgentTools({
      db,
      assistantId: assistants[0].id,
      embeddingProfile: null,
      signal: abort.signal,
      emit() {},
      async saveArtifacts(artifacts) {
        db.put(
          "messages",
          { ...db.get("messages", message.id), artifacts },
          true,
        );
      },
    });
    const catalog = JSON.parse(
      await scoped.tools[0].invoke({ query: "Document" }),
    );
    assert.deepEqual(catalog.documents, [{ document_id: "doc_1", title: "A" }]);
    assert.match(
      await scoped.tools[1].invoke({ document_id: docs[1].id, start_chunk: 0 }),
      /non disponibile/,
    );
    assert.match(
      await scoped.tools[1].invoke({ document_id: docs[0].id, start_chunk: 0 }),
      /Document A/,
    );
    assert.match(
      await scoped.tools[1].invoke({ document_id: "doc_1" }),
      /Document A/,
    );
    const missing = JSON.parse(
      await scoped.tools[1].invoke({ document_id: "doc_99" }),
    );
    assert.equal(missing.code, "document_not_found");
    assert.deepEqual(missing.documents, catalog.documents);
    assert(!JSON.stringify(missing).includes(docs[1].id));
    const empty = JSON.parse(
      await scoped.tools[1].invoke({ document_id: "doc_1", start_chunk: 3 }),
    );
    assert.equal(empty.code, "empty_document_range");
    const saved = JSON.parse(
      await scoped.tools[2].invoke({ title: "Report", markdown: "# Result" }),
    );
    assert.equal(saved.saved, true);
    const reopened = new LocalDatabase(path);
    assert.equal(
      reopened.get("messages", message.id)?.artifacts[0].content,
      "# Result",
    );
    reopened.close();
    await assert.rejects(
      scoped.tools[2].invoke({
        title: "Too large",
        markdown: "x".repeat(32001),
      }),
    );
    abort.abort();
    await assert.rejects(
      scoped.tools[2].invoke({ title: "Aborted", markdown: "No" }),
    );
    assert.equal(scoped.artifacts.length, 1);
  } finally {
    db.close();
    rmSync(path, { recursive: true, force: true });
  }
});
