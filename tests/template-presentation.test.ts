import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { templateCardStyle } from "../src/lib/template-presentation";
import {
  PROJECT_PALETTES,
  contrastRatio,
  colorForeground,
  projectForeground,
} from "../src/lib/project-colors";
import {
  BUILTIN_TEMPLATES,
  templateBundle,
  templateBundleSchema,
} from "../src/lib/templates";
import { LocalDatabase } from "../src/lib/local/database";
import { importLocalTemplate } from "../src/lib/local/template-project";
import { listTemplates, resolveTemplateColor } from "../src/lib/template-store";
import { LOCAL_USER_ID } from "../src/lib/runtime";

const assignments = {
  "computer-science-study": "sky",
  "production-planning": "slate",
  "personal-finance": "mint",
  "construction-cost-analysis": "peach",
  "technical-documentation": "lavender",
  "materials-procurement": "aqua",
};
for (const [key, paletteKey] of Object.entries(assignments)) {
  test(`${key}: semantic palette controls card, preview, export and new project`, () => {
    const template = { ...BUILTIN_TEMPLATES[key], builtin_key: key };
    const before = structuredClone(template);
    const palette = PROJECT_PALETTES.find((p) => p.id === paletteKey)!;
    assert.equal(template.palette, paletteKey);
    const style = templateCardStyle(template);
    assert.deepEqual(style, {
      backgroundColor: palette.background,
      color: palette.foreground,
      "--muted": palette.foreground,
      "--template-accent": palette.accent,
    });
    assert.ok(contrastRatio(palette.background, palette.foreground) >= 4.5);
    assert.ok(contrastRatio(palette.background, palette.accent) >= 3);
    assert.deepEqual(template, before);
    const { palette: _key, ...legacyOfficial } = template;
    assert.deepEqual(templateCardStyle(legacyOfficial), style);
    assert.equal(resolveTemplateColor(legacyOfficial).palette, paletteKey);
    const bundle = templateBundle({ ...template, color: "#123456" });
    assert.equal(bundle.project.color, palette.background);
    assert.equal(bundle.project.palette, paletteKey);
    assert.deepEqual(templateBundleSchema.parse(bundle), bundle);
    assert.deepEqual(
      templateCardStyle({ ...template, color: "#123456" }),
      style,
    );
    const directory = mkdtempSync(join(tmpdir(), "siaas-semantic-"));
    const db = new LocalDatabase(directory);
    try {
      const { project, assistantIds, documents } = importLocalTemplate(
        db,
        bundle.project,
      );
      assert.equal(project.color, palette.background);
      assert.equal(projectForeground(project.color), palette.foreground);
      assert.equal(project.palette, undefined);
      assert.equal(assistantIds.length, template.assistants.length);
      assert.equal(
        documents.length,
        template.assistants.reduce((n, a) => n + a.sources.length, 0),
      );
      for (const [index, id] of assistantIds.entries()) {
        assert.equal(
          db.get("assistants", id)!.instructions,
          template.assistants[index].instructions,
        );
      }
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("legacy/custom colors survive import/export and get readable card text", () => {
  for (const builtin_key of [
    null,
    "unknown",
    "toString",
    "__proto__",
    "personal-finance",
  ]) {
    for (const color of ["#123456", "#000000", "#FFFFFF", "#abcdef"]) {
      const template = { builtin_key, color };
      const style = templateCardStyle(template);
      assert.equal(style.backgroundColor, color);
      assert.equal(style.color, colorForeground(color));
      assert.ok(contrastRatio(color, String(style.color)) >= 4.5);
      assert.equal(resolveTemplateColor(template).color, color);
      assert.equal(
        templateBundle({ ...template, name: "Legacy", assistants: [] }).project
          .color,
        color,
      );
    }
  }
});

test("all authoritative keys accepted; malformed and unknown keys rejected", () => {
  for (const palette of PROJECT_PALETTES) {
    assert.equal(
      templateBundle({
        name: "Semantic",
        palette: palette.id,
        color: "#123456",
        assistants: [],
      }).project.color,
      palette.background,
    );
  }
  for (const palette of ["unknown", "Sky", "", null, 12, {}, "__proto__"]) {
    assert.throws(() =>
      templateBundle({ name: "Invalid", palette, assistants: [] }),
    );
  }
});

test("upgrade adds construction templates once while preserving saved rows, projects, assistants and Knowledge across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "siaas-upgrade-palettes-"));
  let db = new LocalDatabase(directory);
  try {
    const legacyColors = ["#E9F0FA", "#173D35", "#244C78"];
    for (const [index, key] of Object.keys(assignments).slice(0, 3).entries()) {
      const { palette: _palette, ...template } = BUILTIN_TEMPLATES[key];
      db.put("project_templates", {
        ...template,
        color: legacyColors[index],
        tenant_id: LOCAL_USER_ID,
        builtin_key: key,
        deleted: false,
      });
      importLocalTemplate(db, { ...template, color: legacyColors[index] });
    }
    importLocalTemplate(db, {
      ...BUILTIN_TEMPLATES["personal-finance"],
      palette: undefined,
      color: "#123456",
    });
    // Initialize pre-existing assistant migration state before taking the baseline.
    db.close();
    db = new LocalDatabase(directory);
    const existing = Object.fromEntries(
      (
        ["projects", "assistants", "documents", "knowledge_sources"] as const
      ).map((table) => [table, db.rows(table)]),
    );
    const savedTemplates = db.rows("project_templates");
    const templates = await listTemplates(db, LOCAL_USER_ID);
    assert.equal(templates.length, 6);
    for (const row of savedTemplates)
      assert.deepEqual(db.get("project_templates", row.id), row);
    for (const template of templates) {
      assert.equal(template.color, templateCardStyle(template).backgroundColor);
      assert.equal(
        template.palette,
        assignments[template.builtin_key as keyof typeof assignments],
      );
    }
    const allRows = db.rows("project_templates");
    db.close();
    db = new LocalDatabase(directory);
    assert.deepEqual(await listTemplates(db, LOCAL_USER_ID), templates);
    assert.deepEqual(db.rows("project_templates"), allRows);
    for (const table of [
      "projects",
      "assistants",
      "documents",
      "knowledge_sources",
    ] as const)
      assert.deepEqual(db.rows(table), existing[table]);
    const finance = savedTemplates.find(
      (t) => t.builtin_key === "personal-finance",
    )!;
    await db
      .from("project_templates")
      .update({ color: "#123456" })
      .eq("id", finance.id);
    const custom = (await listTemplates(db, LOCAL_USER_ID)).find(
      (t) => t.id === finance.id,
    )!;
    assert.equal(custom.palette, undefined);
    assert.equal(custom.color, "#123456");
    assert.equal(templateCardStyle(custom).backgroundColor, "#123456");
    assert.equal(importLocalTemplate(db, custom).project.color, "#123456");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
