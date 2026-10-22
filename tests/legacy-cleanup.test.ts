import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { templateBundle, templateBundleSchema } from "../src/lib/templates";
import { removeEmptyLegacyDirectories } from "../src/lib/local/legacy-cleanup";

test("startup removes only empty legacy folders, preserves personal records and never recreates removed folders", () => {
  const root = mkdtempSync(join(tmpdir(), "siaas-legacy-"));
  let db = new LocalDatabase(root);
  try {
    const p = db.put("projects", {
      tenant_id: LOCAL_USER_ID,
      name: "Existing",
      color: "#123456",
      legacy_setting: "keep",
    });
    const a = db.put("assistants", {
      tenant_id: LOCAL_USER_ID,
      project_id: p.id,
      name: "Assistant",
      instructions: "Keep",
      skills: ["old"],
      model_id: "ollama/qwen2.5:1.5b",
    });
    const c = db.put("conversations", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: a.id,
      title: "Existing chat",
    });
    const m = db.put("messages", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: a.id,
      conversation_id: c.id,
      content: "Personal conversation",
      role: "user",
    });
    const d = db.put("documents", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: a.id,
      title: "Personal document",
      kind: "txt",
      raw_text: "Preserve",
      skills: "ordinary document metadata",
    });
    db.put("document_chunks", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: a.id,
      document_id: d.id,
      content: "Indexed text",
      embedding_local: [1, 0],
    });
    const assistantLegacy = join(db.assistantDirectory(a.id), "skills");
    mkdirSync(assistantLegacy, { recursive: true });
    mkdirSync(join(root, "skills"));
    mkdirSync(join(root, "supabase"));
    writeFileSync(join(root, "supabase", "personal.txt"), "Unknown content");
    const before = Object.fromEntries(
      [
        "projects",
        "assistants",
        "conversations",
        "messages",
        "documents",
        "document_chunks",
      ].map((t) => [t, db.rows(t as "projects")]),
    );
    db.close();
    db = new LocalDatabase(root);
    assert(!existsSync(join(root, "skills")));
    assert(!existsSync(assistantLegacy));
    assert.equal(
      readFileSync(join(root, "supabase", "personal.txt"), "utf8"),
      "Unknown content",
    );
    for (const [table, rows] of Object.entries(before))
      assert.deepEqual(db.rows(table as "projects"), rows);
    assert.equal(db.get("messages", m.id)?.content, "Personal conversation");
    db.close();
    db = new LocalDatabase(root);
    assert(!existsSync(join(root, "skills")));
    assert(!existsSync(assistantLegacy));
    const bundle = templateBundleSchema.parse({
      format: "siaas-project-v1",
      project: {
        name: p.name,
        color: p.color,
        skills: ["legacy"],
        assistants: [
          { name: a.name, instructions: a.instructions, skills: ["legacy"] },
        ],
      },
    });
    assert.deepEqual(templateBundle(bundle.project), bundle);
    assert(!JSON.stringify(bundle).includes("skills"));
    assert.equal(bundle.project.assistants[0].instructions, "Keep");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup protects empty knowledge folders, aliases, symlink ancestors and unknown subdirectories", () => {
  const root = mkdtempSync(join(tmpdir(), "siaas-protect-"));
  try {
    const candidate = join(root, "skills");
    mkdirSync(candidate);
    removeEmptyLegacyDirectories(root, [], [candidate]);
    assert(existsSync(candidate));
    // A folder containing a linked source is also protected, even when temporarily missing.
    removeEmptyLegacyDirectories(root, [], [join(candidate, "offline")]);
    assert(existsSync(candidate));
    const alias = join(root, "source-alias");
    symlinkSync(candidate, alias, "dir");
    removeEmptyLegacyDirectories(root, [], [alias]);
    assert(existsSync(candidate));
    mkdirSync(join(candidate, "unknown-empty"));
    removeEmptyLegacyDirectories(root, [], []);
    assert(existsSync(candidate));
    const p = "11111111-1111-4111-8111-111111111111",
      a = "22222222-2222-4222-8222-222222222222";
    const outside = join(root, "knowledge-source");
    mkdirSync(join(outside, p, "assistants", a, "skills"), { recursive: true });
    symlinkSync(outside, join(root, "projects"), "dir");
    removeEmptyLegacyDirectories(root, [{ id: a, project_id: p }], []);
    assert(existsSync(join(outside, p, "assistants", a, "skills")));
    symlinkSync(candidate, join(root, "supabase"), "dir");
    removeEmptyLegacyDirectories(root, [], []);
    assert(existsSync(join(root, "supabase")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
