import { test } from "node:test";
import assert from "node:assert/strict";
import { agentEligibility } from "../src/lib/agent-policy";
import { requireOllama } from "../src/lib/ollama";

test("local tool-capable models qualify regardless of parameter count", () => {
  for (const parameter_size of ["1.5B", "3B", "7B", "7.5B", "7.99B", "8B", "14B", "8000M", "0.01T", "8x7B"]) {
    const status = agentEligibility({
      details: { parameter_size },
      capabilities: ["completion", "tools"],
    });
    assert.equal(status.enabled, true, parameter_size);
    assert.equal(status.reason, "ready", parameter_size);
    assert.equal(status.supportsTools, true, parameter_size);
  }
  const gemma = agentEligibility({
    model_info: { "general.parameter_count": 7_518_069_290 },
    capabilities: ["completion", "vision", "audio", "tools", "thinking"],
  });
  assert.equal(gemma.enabled, true);
  assert.equal(gemma.parameterCount, 7_518_069_290);
  assert.equal(gemma.reason, "ready");

  const unknownSize = agentEligibility({ capabilities: ["completion", "tools"] });
  assert.equal(unknownSize.enabled, true);
  assert.equal(unknownSize.parameterCount, null);
  assert.equal(
    agentEligibility({
      details: { parameter_size: "8B" },
      model_info: { "general.parameter_count": 7_999_999_999 },
      capabilities: ["completion", "tools"],
    }).enabled,
    true,
  );
  assert.equal(
    agentEligibility({ capabilities: ["completion", "tools"], remote_model: "cloud" }).reason,
    "not-local",
  );
  assert.equal(
    agentEligibility({ capabilities: ["completion", "tools"], remote_host: "example.com" }).enabled,
    false,
  );
  for (const capabilities of [
    ["completion"],
    ["completion", "vision"],
    [],
    undefined,
  ]) {
    const status = agentEligibility({ capabilities });
    assert.equal(status.enabled, false);
    assert.equal(status.reason, capabilities?.includes("completion") ? "no-tools" : "not-local");
  }
  assert.equal(
    agentEligibility({ capabilities: ["tools"] }).enabled,
    false,
    "tools without completion are not a local chat model",
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
