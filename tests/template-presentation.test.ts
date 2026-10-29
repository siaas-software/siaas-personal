import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { templateCardStyle } from "../src/lib/template-presentation";
import { contrastRatio, projectForeground } from "../src/lib/project-colors";
import { BUILTIN_TEMPLATES, templateBundle } from "../src/lib/templates";
import { LocalDatabase } from "../src/lib/local/database";
import { importLocalTemplate } from "../src/lib/local/template-project";
import { listTemplates } from "../src/lib/template-store";
import { LOCAL_USER_ID } from "../src/lib/runtime";

// Verified against siaas-public-site@9e4995a and siaas-templates@82b9d41.
const cases = [
  ["computer-science-study", "#E9F0FA", "#E9F0FA", "#1C416C"],
  ["production-planning", "#173D35", "#E9EDF1", "#344453"],
  ["personal-finance", "#244C78", "#E5F7EE", "#174B35"],
] as const;

for (const [key, original, background, foreground] of cases) {
  test(`${key} uses the approved card palette without changing the bundle`, () => {
    const template = { ...BUILTIN_TEMPLATES[key], builtin_key: key };
    const before = structuredClone(template);
    assert.equal(template.color, original);
    const style = templateCardStyle(template);
    assert.deepEqual(style, {
      backgroundColor: background,
      color: foreground,
      "--muted": foreground,
    });
    assert.ok(contrastRatio(background, foreground) >= 4.5);
    assert.deepEqual(template, before);
    assert.equal(templateBundle(template).project.color, original);
    // Persisted built-ins are identified by their key, not a current seed color.
    assert.deepEqual(
      templateCardStyle({ ...template, color: "#123456" }),
      style,
    );
  });
}

test("custom and unknown templates retain their existing color behavior", () => {
  for (const builtin_key of [null, "unknown", "toString", "__proto__"]) {
    for (const color of ["#123456", "#244C78", "#E9F0FA"]) {
      assert.deepEqual(templateCardStyle({ builtin_key, color }), {
        backgroundColor: color,
        color: projectForeground(color),
      });
    }
  }
});

test("card presentation preserves persisted templates and projects across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "siaas-card-palettes-"));
  let db = new LocalDatabase(directory);
  try {
    const templates = await listTemplates(db, LOCAL_USER_ID);
    const projects = templates.map((template) => {
      templateCardStyle(template);
      const { project } = importLocalTemplate(db, template);
      assert.equal(project.color, template.color);
      return project;
    });
    db.close();
    db = new LocalDatabase(directory);
    assert.deepEqual(await listTemplates(db, LOCAL_USER_ID), templates);
    for (const project of projects) {
      assert.equal(db.get("projects", project.id)?.color, project.color);
    }
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
