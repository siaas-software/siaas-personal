import { test } from "node:test";
import assert from "node:assert/strict";
import { agentEligibility } from "../src/lib/agent-policy";
import { requireOllama } from "../src/lib/ollama";

test("agent threshold uses parameter metadata, not tags or quantized file size", () => {
  for (const [parameter_size, enabled] of [
    ["1.5B", false],
    ["7B", false],
    ["7.99B", false],
    ["8B", true],
    ["14B", true],
    ["8000M", true],
    ["0.01T", true],
    ["8x7B", false],
  ] as const) {
    assert.equal(
      agentEligibility({
        details: { parameter_size },
        capabilities: ["completion", "tools"],
      }).enabled,
      enabled,
      parameter_size,
    );
  }
  assert.equal(
    agentEligibility({ capabilities: ["completion", "tools"] }).reason,
    "unknown-size",
  );
  assert.equal(
    agentEligibility({
      details: { parameter_size: "8B" },
      model_info: { "general.parameter_count": 7_999_999_999 },
      capabilities: ["completion", "tools"],
    }).enabled,
    false,
  );
  assert.equal(
    agentEligibility({
      model_info: { "general.parameter_count": 8e9 },
      capabilities: ["completion", "tools"],
    }).enabled,
    true,
  );
  assert.equal(
    agentEligibility({
      details: { parameter_size: "14B" },
      capabilities: ["completion"],
    }).reason,
    "no-tools",
  );
  assert.equal(
    agentEligibility({
      details: { parameter_size: "8B" },
      capabilities: ["completion", "tools"],
      remote_model: "cloud",
    }).enabled,
    false,
  );
});

test("chat works without embeddings; indexing still requires its embedding model", async () => {
  const request = (async (url) =>
    Response.json(
      String(url).endsWith("/api/show")
        ? { capabilities: ["completion"], details: { parameter_size: "1.5B" } }
        : { models: [{ name: "qwen2.5:1.5b", digest: "a".repeat(64) }] },
    )) as typeof fetch;
  const result = await requireOllama("ollama/qwen2.5:1.5b", request);
  assert.equal(result.embeddingProfile, null);
  assert.equal(result.agent.enabled, false);
  await assert.rejects(requireOllama(undefined, request), /embeddinggemma/);
});
