import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOllamaLibrary, modelCatalog } from "../src/lib/model-catalog";
import { isLocalModelName, isLocalModelId } from "../src/lib/model-name";
import { ollamaStatus, requireOllama, verifyLocalChatModel } from "../src/lib/ollama";
import { desktopAssistantSchema } from "../src/lib/validation";

test("catalog includes local variants and ignores embeddings, cloud-only cards and unexpected HTML", async () => {
  const local = Array.from({ length: 20 }, (_, i) => `<a href="/library/model-${i}"><span>3b</span><span>7b</span></a>`).join("");
  const html = local + '<a href="/library/embed"><span>embedding</span><span>3b</span></a><a href="/library/remote"><span>cloud</span></a>';
  const parsed = parseOllamaLibrary(html);
  assert.equal(parsed.length, 40);
  assert.equal(parsed[0].id, "model-0:3b");
  assert.throws(() => parseOllamaLibrary('<html>Sign in</html>'));
  assert((await modelCatalog()).models.length > 100);
});
test("model IDs accept local tags and namespaces, reject URLs, registries, traversal and cloud", () => {
  for (const name of ["qwen2.5-coder:3b", "user/custom:latest", "llama3.2:1b-instruct-q4_K_M"]) {
    assert(isLocalModelName(name)); assert(isLocalModelId(`ollama/${name}`));
    assert.equal(desktopAssistantSchema.parse({ name: "Coder", model_id: `ollama/${name}` }).model_id, `ollama/${name}`);
  }
  for (const name of ["https://example.com/model", "../model", "evil.com/model", "gpt-oss:120b-cloud", "model:cloud", "model name"]) assert(!isLocalModelName(name), name);
});
test("installed models outside recommendations can be selected and used; cloud aliases and embedding models are refused", async () => {
  const digest = "a".repeat(64);
  const fake = (async (url: string | URL | Request) => Response.json(String(url).endsWith('/api/show') ? { capabilities: ["completion"] } : {
    models: [{ name: "qwen2.5-coder:3b", digest }, { name: "embeddinggemma:latest", digest }, { name: "alias:latest", digest, remote_model: "remote", remote_host: "https://ollama.com" }],
  })) as typeof fetch;
  const runtime = await ollamaStatus(fake);
  assert(runtime.models.some(m => m.id === "ollama/qwen2.5-coder:3b" && m.available));
  assert(!runtime.models.some(m => m.id === "ollama/alias:latest"));
  await requireOllama("ollama/qwen2.5-coder:3b", fake);
  for (const body of [{ capabilities: ["embedding"] }, { capabilities: ["completion"], remote_model: "cloud-alias" }, { capabilities: ["completion"], remote_host: "https://ollama.com" }]) {
    await assert.rejects(verifyLocalChatModel("ollama/alias:latest", (async () => Response.json(body)) as typeof fetch), /local chat model/);
  }
});
