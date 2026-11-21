import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { templateBundle, templateBundleSchema, materializeTemplateOrchestration, portableTemplateOrchestration } from "../src/lib/templates";
import { listTemplates } from "../src/lib/template-store";
import rc5Builtins from "../src/generated/builtin-templates-rc5.json";
import { BUILTIN_TEMPLATES } from "../src/lib/templates";

test("template round trip keeps configuration and strips personal data at every level", () => {
  const result = templateBundle({ name: "Example", description: "Role", color: "#123456", documents: ["secret"],
    assistants: [{ name: "Writer", description: "Writes", instructions: "Follow this brief", model: "ollama/example", color: "#ABCDEF", documents: ["private"], conversations: ["secret"], id: "personal-id" }] });
  assert.deepEqual(templateBundleSchema.parse(JSON.parse(JSON.stringify(result))), result);
  assert.equal(result.project.assistants[0].instructions, "Follow this brief");
  assert(!/secret|private|personal-id|documents|conversations/.test(JSON.stringify(result)));
  const legacy = templateBundleSchema.parse({ format: "siaas-project-v1", project: { name: "Old", assistants: [{ name: "A", instructions: "Preserve me", model: null }] } });
  assert.equal(legacy.project.color, "#FFFFFF");
  assert.equal(legacy.project.assistants[0].instructions, "Preserve me");
});

test("built-in templates are complete, persist once and respect tombstones across restarts", async () => {
  const path = mkdtempSync(join(tmpdir(), "siaas-templates-"));
  let db = new LocalDatabase(path);
  try {
    const client = () => db;
    const first = await listTemplates(client(), LOCAL_USER_ID);
    assert.equal(first.length, 6);
    assert(first.every((t) => t.assistants.every((a) => a.instructions && a.description && a.model === null)));
    assert.equal((await listTemplates(client(), LOCAL_USER_ID)).length, 6);
    await db.from("project_templates").update({ deleted: true }).eq("id", first[0].id);
    db.close(); db = new LocalDatabase(path);
    assert.equal((await listTemplates(client(), LOCAL_USER_ID)).length, 5);
  } finally { db.close(); rmSync(path, { recursive: true, force: true }); }
});

test("v2 project chat settings remain portable and map only selected local assistants", () => {
  const local = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const configured = materializeTemplateOrchestration({
    enabled: true,
    instructions: "Coordinate without expanding permissions.",
    share_results: true,
    assistant_indices: [1, 0],
    max_steps: 2,
  }, local);
  assert.deepEqual(configured.assistant_ids, [local[1], local[0]]);
  assert.deepEqual(portableTemplateOrchestration(configured, local).assistant_indices, [1, 0]);
  const bundle = templateBundle({
    name: "Portable project",
    assistants: [{ name: "A" }, { name: "B" }],
    orchestration: portableTemplateOrchestration(configured, local),
  });
  assert.equal(bundle.format, "siaas-project-v2");
  assert.deepEqual(templateBundleSchema.parse(bundle), bundle);
  assert(!JSON.stringify(bundle).includes(local[0]));
  assert(!JSON.stringify(bundle).includes(local[1]));
  for (const indices of [[0,0], [2], [-1], [0,1,2]]) {
    const result = templateBundleSchema.safeParse({
      ...bundle, project: { ...bundle.project, orchestration: {
        ...bundle.project.orchestration, assistant_indices: indices,
      } },
    });
    assert.equal(result.success, false, JSON.stringify(indices));
  }
  assert.equal(templateBundleSchema.safeParse({
    format: "siaas-project-v1", project: bundle.project,
  }).success, false);
  assert.equal(templateBundleSchema.safeParse({
    format: "siaas-project-v2", project: {
      name: "Missing configuration", assistants: [{ name: "A" }],
    },
  }).success, false);
  assert.throws(() => portableTemplateOrchestration({
    ...configured, assistant_ids: ["33333333-3333-4333-8333-333333333333"],
  }, local));
});

test("RC5 pristine official seeds upgrade to v2 while edits, tombstones and projects are preserved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "siaas-v2-rc5-upgrade-"));
  const db = new LocalDatabase(dir);
  try {
    for (const [key, preset] of Object.entries(rc5Builtins)) {
      db.put("project_templates", {
        ...preset,
        id: `${LOCAL_USER_ID}:${key}`,
        tenant_id: LOCAL_USER_ID,
        builtin_key: key,
        deleted: key === "materials-procurement",
      });
    }
    const editedKey = "personal-finance";
    const edited = db.get("project_templates", `${LOCAL_USER_ID}:${editedKey}`)!;
    db.put("project_templates", { ...edited, description: "User-edited finance description" }, true);
    const existingProject = db.put("projects", {
      tenant_id: LOCAL_USER_ID, name: "Keep my project",
      orchestration: { enabled: false, assistant_ids: [], instructions: "Keep", share_results: false, max_steps: 3 },
    });
    const before = db.get("projects", existingProject.id);
    const first = await listTemplates(db, LOCAL_USER_ID);
    assert.equal(first.length, 5);
    const upgraded = first.find((item) => item.builtin_key === "computer-science-study")!;
    assert.deepEqual(upgraded.orchestration?.assistant_indices, [0,1,2]);
    assert.equal(upgraded.orchestration?.enabled, false);
    assert.deepEqual(upgraded.assistants, BUILTIN_TEMPLATES["computer-science-study"].assistants);
    const customized = first.find((item) => item.builtin_key === editedKey)!;
    assert.equal(customized.description, "User-edited finance description");
    assert.equal(customized.orchestration, undefined);
    assert.equal(db.get("project_templates", `${LOCAL_USER_ID}:materials-procurement`)?.deleted, true);
    assert.deepEqual(db.get("projects", existingProject.id), before);
    const afterUpgrade = db.rows("project_templates");
    assert.deepEqual(await listTemplates(db, LOCAL_USER_ID), first);
    assert.deepEqual(db.rows("project_templates"), afterUpgrade);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
