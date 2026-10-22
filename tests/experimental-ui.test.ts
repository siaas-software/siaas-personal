import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExperimentalFeaturesPanel } from "../src/components/experimental-features";
import { ResearchSettingsFields } from "../src/components/research-settings";

test("both switches fail closed before Docker status is known; refresh and platform instructions remain available", () => {
  const html = renderToStaticMarkup(createElement(ExperimentalFeaturesPanel));
  const switches = html.match(/<input[^>]*role="switch"[^>]*>/g) || [];
  assert.equal(switches.length, 2);
  for (const input of switches) {
    assert(input.includes('disabled=""'));
    assert(!input.includes('checked=""'));
  }
  assert(html.includes("Refresh Status"));
  assert(html.includes("Windows:"));
  assert(html.includes("macOS:"));
  assert(html.includes("Linux:"));
});
test("assistant panel always shows sites, has no exclusive mode selector and disables new Beta opt-in until ready", () => {
  const html = renderToStaticMarkup(createElement(ResearchSettingsFields));
  assert(!html.includes("Research mode"));
  assert(!html.includes('value="documents"'));
  assert(html.includes("Add website"));
  assert(html.includes("Maximum pages"));
  assert.match(html, /<input[^>]*role="switch"[^>]*disabled/);
});
