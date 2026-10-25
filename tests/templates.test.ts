import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { templateBundle, templateBundleSchema } from "../src/lib/templates";
import { listTemplates } from "../src/lib/template-store";

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
    assert.equal(first.length, 5);
    assert(first.every((t) => t.assistants.every((a) => a.instructions && a.description && a.model === null)));
    assert.equal((await listTemplates(client(), LOCAL_USER_ID)).length, 5);
    await db.from("project_templates").update({ deleted: true }).eq("id", first[0].id);
    db.close(); db = new LocalDatabase(path);
    assert.equal((await listTemplates(client(), LOCAL_USER_ID)).length, 4);
  } finally { db.close(); rmSync(path, { recursive: true, force: true }); }
});
