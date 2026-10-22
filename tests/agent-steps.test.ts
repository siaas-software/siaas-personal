import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAgentTool, agentToolLabel } from "../src/lib/agent-steps";

test("local diagnostics distinguish lookup and validation failures without saving raw content", () => {
  const missing = summarizeAgentTool("read_document", JSON.stringify({ code: "document_not_found", error: "private content" }));
  assert.equal(missing.status, "error");
  assert.match(missing.detail, /Document reference/);
  const validation = summarizeAgentTool("read_document", "Error: invalid arguments including private content", "error");
  assert.equal(validation.status, "error");
  const success = summarizeAgentTool("search_documents", JSON.stringify({ matches: [{ content: "private content" }], documents: [{}] }));
  assert.equal(success.status, "success");
  assert.match(success.detail, /1 passages/);
  assert(!JSON.stringify([missing, validation, success]).includes("private content"));
});

test("research activity uses feature names in English and Italian", () => {
  assert.equal(agentToolLabel("assess_evidence"), "Evidence Evaluation");
  assert.equal(agentToolLabel("assess_evidence", true), "Valutazione delle fonti");
  assert.equal(agentToolLabel("research_web"), "Advanced Web Research");
  assert.equal(agentToolLabel("research_web", true), "Ricerca web avanzata");
});
