import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import {
  importLocalTemplate,
  localAssistantSources,
} from "../src/lib/local/template-project";
import { processWebSource } from "../src/lib/local/web-ingestion";
import { setWebSourceEnabled } from "../src/lib/local/web-knowledge";
import { removeLocalDocument } from "../src/lib/local/knowledge";
import { templateBundleSchema, BUILTIN_TEMPLATES } from "../src/lib/templates";
import { exportProjectBundle } from "../src/lib/export-bundle";
import { listTemplates } from "../src/lib/template-store";
import { LOCAL_USER_ID } from "../src/lib/runtime";
const profile =
  "ollama/embeddinggemma:latest@" + "a".repeat(64) + ":retrieval-v1";
const vector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const input = {
  name: "Portable",
  color: "#E9F0FA",
  assistants: [
    {
      name: "Tutor",
      description: "",
      instructions: "Teach",
      model: "old-model",
      color: "#123456",
      sources: [
        "https://example.com/lesson#one",
        "https://example.com/lesson#two",
      ],
      files: ["private.pdf"],
      local_path: "/private",
      listing: { private: true },
    },
  ],
};

test("v1 export strips local data, models and assistant colors; legacy v1 stays valid", () => {
  const exported = JSON.parse(exportProjectBundle(input).content);
  assert.equal(exported.format, "siaas-project-v1");
  assert.deepEqual(Object.keys(exported).sort(), ["format", "project"]);
  assert.deepEqual(exported.project.assistants[0], {
    name: "Tutor",
    description: "",
    instructions: "Teach",
    sources: ["https://example.com/lesson"],
    model: null,
  });
  assert(!JSON.stringify(exported).includes("private"));
  const legacy = templateBundleSchema.parse({
    format: "siaas-project-v1",
    listing: {},
    project: {
      name: "Old",
      assistants: [{ name: "A", color: "bad-old-color", model: "old" }],
    },
  });
  assert.deepEqual(legacy.project.assistants[0].sources, []);
  assert.equal(legacy.project.assistants[0].model, null);
  for (const url of [
    "file:///secret.pdf",
    "http://localhost/",
    "http://127.0.0.1/",
    "http://192.168.1.1/",
    "https://me:secret@example.com/",
  ])
    assert.throws(() =>
      templateBundleSchema.parse({
        format: "siaas-project-v1",
        project: { ...input, assistants: [{ name: "A", sources: [url] }] },
      }),
    );
});

test("offline template import persists sources, isolates assistants, retries and replaces indexes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "siaas-portable-"));
  let db = new LocalDatabase(dir);
  try {
    const imported = importLocalTemplate(db, input);
    const id = imported.documents[0],
      assistant = imported.assistantIds[0];
    assert.equal(imported.documents.length, 1);
    assert.equal(db.get("assistants", assistant)?.model_id, null);
    assert.equal(db.get("documents", id)?.enabled, true);
    const offline = await processWebSource(db, id, false, {
      read: async () => {
        throw Error("offline");
      },
    });
    assert.equal(offline.status, "queued");
    assert.equal(
      db.get("documents", id)?.source_url,
      "https://example.com/lesson",
    );
    db.close();
    db = new LocalDatabase(dir);
    assert.equal(db.get("documents", id)?.status, "queued");
    const other = importLocalTemplate(db, input);
    assert.notEqual(other.assistantIds[0], assistant);
    let revision = "First";
    const deps = {
      read: async (url: string) => ({
        url,
        title: "Lesson",
        content: `${revision} lesson. `.repeat(30),
        links: [],
        fetchedAt: new Date().toISOString(),
      }),
      runtime: async () => ({ embeddingProfile: profile }),
      embed: async (texts: string[]) => texts.map(() => vector),
    };
    assert.equal((await processWebSource(db, id, false, deps)).status, "ready");
    const lookup = (a: string) =>
      db.rpc("match_documents_local", {
        target_assistant: a,
        target_profile: profile,
        query_embedding: vector,
      });
    assert.equal((await lookup(assistant)).data.length, 1);
    assert.equal((await lookup(other.assistantIds[0])).data.length, 0);
    setWebSourceEnabled(db, assistant, id, false);
    assert.equal((await lookup(assistant)).data.length, 0);
    assert.deepEqual(localAssistantSources(db, assistant), [
      "https://example.com/lesson",
    ]);
    assert.throws(
      () => setWebSourceEnabled(db, other.assistantIds[0], id, true),
      /not found/,
    );
    setWebSourceEnabled(db, assistant, id, true);
    revision = "Updated";
    assert.equal((await processWebSource(db, id, true, deps)).status, "ready");
    assert.equal(
      db.rows("document_chunks").filter((c) => c.document_id === id).length,
      1,
    );
    assert.match((await lookup(assistant)).data[0].content, /Updated/);
    const before = db.rows("documents").length;
    assert.throws(
      () => importLocalTemplate(db, input, imported.project.id),
      /empty project/,
    );
    assert.equal(db.rows("documents").length, before);
    removeLocalDocument(db, id, false);
    assert.equal(
      db.rows("document_chunks").filter((c) => c.document_id === id).length,
      0,
    );
    assert.equal((await lookup(assistant)).data.length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new built-ins replace retired catalog entries without changing existing projects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "siaas-presets-"));
  const db = new LocalDatabase(dir);
  try {
    assert.deepEqual(Object.keys(BUILTIN_TEMPLATES), [
      "computer-science-study",
      "home-gardening",
      "software-engineering",
    ]);
    const old = db.put("project_templates", {
      tenant_id: LOCAL_USER_ID,
      builtin_key: "event-planner",
      name: "Event Planner",
      assistants: [],
      deleted: false,
    });
    const project = importLocalTemplate(
      db,
      { name: "Existing", assistants: [{ name: "Keep" }] },
      undefined,
      old.id,
    );
    const rows = await listTemplates(
      db,
      LOCAL_USER_ID,
    );
    assert.equal(rows.length, 3);
    assert.equal(db.get("projects", project.project.id)?.template_id, old.id);
    for (const row of rows) {
      assert.equal(row.assistants.length, 3);
      assert(row.assistants.every((a) => a.sources.length === 1));
      const imported = importLocalTemplate(db, row);
      assert.equal(imported.documents.length, 3);
      const manifest = JSON.parse(
        readFileSync(
          join(db.assistantDirectory(imported.assistantIds[0]), "sources.json"),
          "utf8",
        ),
      );
      assert.equal(
        manifest.documents[0].source_url,
        row.assistants[0].sources[0],
      );
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
