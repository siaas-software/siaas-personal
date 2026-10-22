import { test } from "node:test";
import assert from "node:assert/strict";
import { research, boundedJSON } from "../services/morphic/adapter.mjs";
const input = {
  version: 1,
  query: "Public question",
  model: "model:8b",
  maxPages: 2,
  maxSearches: 1,
  timeoutSeconds: 5,
};
const signal = new AbortController().signal;
const read = async (url) => ({
  url,
  title: "Source",
  content: "Verified page content with sufficient text to be useful.",
  fetchedAt: new Date().toISOString(),
  links: [],
});
const fetchSearch = async () =>
  Response.json({
    results: [
      { url: "https://example.org/a" },
      { url: "https://example.org/b" },
      { url: "https://example.org/c" },
    ],
  });
test("real Morphic ToolLoopAgent and Ollama provider execute tools through the versioned adapter", async () => {
  let modelCalls = 0,
    searchCalls = 0;
  const r = await research(input, signal, {
    read,
    fetch: async (url, init) => {
      const u = new URL(url instanceof Request ? url.url : String(url));
      if (u.pathname === "/search") {
        searchCalls++;
        return fetchSearch();
      }
      if (u.pathname === "/api/show")
        return Response.json({ capabilities: ["completion", "tools"] });
      assert.equal(u.pathname, "/api/chat");
      assert.equal(u.hostname, "host.docker.internal");
      const body = JSON.parse(init.body);
      modelCalls++;
      assert.equal(body.model, "model:8b");
      const message =
        modelCalls === 1
          ? {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  function: {
                    name: "search",
                    arguments: { query: "Public question" },
                  },
                },
              ],
            }
          : { role: "assistant", content: "Evidence gathered [1](#S1)." };
      return Response.json({
        model: body.model,
        created_at: new Date().toISOString(),
        message,
        done: true,
        done_reason: "stop",
        prompt_eval_count: 20,
        eval_count: 10,
        total_duration: 100,
      });
    },
  });
  assert.equal(r.status, "complete", JSON.stringify(r));
  assert.equal(modelCalls, 2);
  assert.equal(searchCalls, 1);
  assert.equal(r.evidence.length, 2);
});
test("Morphic refuses Ollama cloud models before inference or search", async () => {
  let calls = 0;
  const result = await research(input, signal, {
    fetch: async (url) => {
      calls++;
      assert.equal(new URL(url).pathname, "/api/show");
      return Response.json({
        capabilities: ["completion", "tools"],
        remote_host: "https://ollama.com",
        remote_model: "cloud",
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "error");
  assert.equal(result.searches, 0);
});
test("Morphic returns page evidence, enforces budgets and prevents arbitrary fetches", async () => {
  let fetches = 0;
  const r = await research(input, signal, {
    read,
    fetch: async (...args) => {
      fetches++;
      return fetchSearch(...args);
    },
    run: async (tools) => {
      assert.deepEqual(
        await tools.fetch.execute({ url: "http://127.0.0.1/" }),
        { error: "Invalid URL" },
      );
      await Promise.all([
        tools.search.execute({ query: "query" }),
        tools.search.execute({ query: "query" }),
      ]);
      await tools.fetch.execute({ url: "https://example.org/c" });
    },
  });
  assert.equal(fetches, 1);
  assert.equal(r.searches, 1);
  assert.equal(r.pages, 2);
  assert.equal(r.evidence.length, 2);
  assert.equal(r.status, "partial");
  assert.equal(
    r.evidence[0].content,
    "Verified page content with sufficient text to be useful.",
  );
});
test("engine snippets are never returned as evidence; errors preserve pages", async () => {
  const r = await research(input, signal, {
    fetch: fetchSearch,
    read,
    run: async (tools) => {
      await tools.search.execute({ query: "query" });
      throw Error("model disconnected");
    },
  });
  assert.equal(r.status, "partial");
  assert.equal(r.evidence.length, 2);
  const empty = await research(input, signal, {
    fetch: fetchSearch,
    read: async () => {
      throw Error("blocked");
    },
    run: async (tools) => {
      await tools.search.execute({ query: "q" });
    },
  });
  assert.equal(empty.evidence.length, 0);
  assert.equal(empty.status, "partial");
});
test("explicit domain restrictions are enforced on results and forwarded query is redacted", async () => {
  let q = "";
  const r = await research(input, signal, {
    read,
    fetch: async (url) => {
      q = new URL(url).searchParams.get("q");
      return Response.json({
        results: [
          { url: "https://example.org/a" },
          { url: "https://evil-example.org/b" },
          { url: "https://sub.example.org/c" },
        ],
      });
    },
    run: async (tools) => {
      await tools.search.execute({
        query: "test alice@example.org",
        include_domains: ["example.org"],
        exclude_domains: ["sub.example.org"],
      });
    },
  });
  assert(!q.includes("alice@"));
  assert.deepEqual(
    r.evidence.map((x) => x.url),
    ["https://example.org/a"],
  );
});
test("oversized service responses and pre-aborted requests terminate without evidence", async () => {
  await assert.rejects(
    boundedJSON(Response.json({ data: "a".repeat(100) }), 20),
  );
  const controller = new AbortController();
  controller.abort();
  const r = await research(input, controller.signal, {
    run: async (tools) => {
      await tools.search.execute({ query: "q" });
    },
  });
  assert.equal(r.status, "error");
  assert.equal(r.searches, 0);
});
