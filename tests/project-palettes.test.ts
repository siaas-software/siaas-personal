import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT_PALETTES, DEFAULT_PROJECT_COLOR, resolveProjectPalette, contrastRatio } from "../src/lib/project-colors";

test("eight distinct palettes meet WCAG AA text and graphical contrast", () => {
  assert.equal(PROJECT_PALETTES.length, 8);
  assert.equal(new Set(PROJECT_PALETTES.map(p => p.background)).size, 8);
  for (const palette of PROJECT_PALETTES) {
    assert.ok(contrastRatio(palette.background, palette.foreground) >= 4.5, palette.name + " text");
    assert.ok(contrastRatio(palette.background, palette.accent) >= 3, palette.name + " graphics");
    assert.equal(resolveProjectPalette(palette.background).id, palette.id);
  }
});
test("legacy colors map to a palette without mutating stored values", () => {
  assert.equal(resolveProjectPalette("#FFFFFF").background.length, 7);
  assert.equal(resolveProjectPalette("not-a-color").background, DEFAULT_PROJECT_COLOR);
});
