import { test } from "node:test";
import assert from "node:assert/strict";
import { generateProjectAgentsMarkdown } from "../src/lib/agents-md";

test("AGENTS.md is derived on demand, contains no runtime secrets or IDs", () => {
  const md = generateProjectAgentsMarkdown({
    name:"Cost review", description:"Local analysis",
    assistants:[{name:"Analyst",instructions:"Use authorized sheets only."}],
    actions:[{name:"Summarize",markdown:"# Summarize\nOnly verified facts."}],
    permissions:{rules:[{capability:"mcp.write",decision:"ask"}]},
    orchestration:{enabled:false,share_results:false},
  });
  assert.match(md,/AGENTS.md — Cost review/);
  assert.match(md,/mcp.write: ASK/);
  assert.match(md,/Use authorized sheets only/);
  assert.match(md,/Project orchestration: disabled/);
  assert.match(md,/not by this text/);
});
test("invalid project permission input is rejected rather than hidden in markdown", () => {
  assert.throws(() => generateProjectAgentsMarkdown({
    name:"Invalid",assistants:[],permissions:{rules:[{capability:"x",decision:"always"}]},
  }));
});
