import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ollamaURL,
  ollamaStatus,
  requireOllama,
  embedLocal,
  streamLocal,
  verifyLocalChatModel,
  OllamaError,
} from "../src/lib/ollama";
import { isDocumentReady, needsReindex } from "../src/lib/catalog";
const digest = "a".repeat(64);
const profile = `ollama/embeddinggemma:latest@${digest}:retrieval-v1`;
const tags = {
  models: [
    { name: "qwen2.5:1.5b", digest },
    { name: "embeddinggemma:latest", digest },
  ],
};
test("model verification reports unavailable Ollama, timeouts and malformed responses, then recovers", async () => {
  for (const failure of [
    new TypeError("fetch failed"),
    new DOMException("timeout", "TimeoutError"),
  ]) {
    await assert.rejects(
      verifyLocalChatModel("ollama/test:8b", async () => {
        throw failure;
      }),
      (error: unknown) =>
        error instanceof OllamaError &&
        error.status === 503 &&
        /Ollama/.test(error.message),
    );
  }
  for (const [response, status] of [
    [new Response("{}", { status: 503 }), 503],
    [new Response("{}", { status: 404 }), 400],
    [new Response("invalid json"), 502],
    [Response.json(null), 502],
  ] as const) {
    await assert.rejects(
      verifyLocalChatModel("ollama/test:8b", async () => response),
      (error: unknown) =>
        error instanceof OllamaError && error.status === status,
    );
  }
  await verifyLocalChatModel("ollama/test:8b", async () =>
    Response.json({
      capabilities: ["completion", "tools"],
      model_info: { "general.parameter_count": 8e9 },
    }),
  );
});
const fake = (
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) =>
  ((url, init) => Promise.resolve(String(url).endsWith("/api/show") ? Response.json({ capabilities: ["completion"] }) : handler(String(url), init))) as typeof fetch;
test("Ollama accepts only loopback and no remote URL, credentials or extra path", () => {
  assert.equal(ollamaURL("http://localhost:11434"), "http://localhost:11434");
  for (const url of [
    "https://api.openai.com",
    "http://192.168.1.2:11434",
    "http://127.0.0.1:11434/proxy",
    "http://user:pass@localhost:11434",
    "http://localhost:11434/?x=1",
  ])
    assert.throws(() => ollamaURL(url));
});
test("runtime reports actual installed models and missing embedding model without paid fallback", async () => {
  const runtime = await ollamaStatus(fake(() => Response.json(tags)));
  assert.equal(runtime.embeddingProfile, profile);
  assert.equal(runtime.models.filter((m) => m.available).length, 1);
  assert.equal(
    (await ollamaStatus(fake(() => Response.json({ models: [] }))))
      .embeddingReady,
    false,
  );
  assert.equal(
    (
      await ollamaStatus(
        fake(() => {
          throw new Error("offline");
        }),
      )
    ).connected,
    false,
  );
  await assert.rejects(
    requireOllama(
      "openai/gpt-6-luna",
      fake(() => {
        throw new Error("must not call");
      }),
    ),
    /Select/,
  );
  await assert.rejects(
    requireOllama(
      "ollama/qwen2.5:7b",
      fake(() => Response.json(tags)),
    ),
    /non installato/,
  );
});
test("local embedding enforces dimension, count, task prefix, no truncation and model fingerprint", async () => {
  const requests: any[] = [];
  const request = fake((url, init) => {
    assert(new URL(url).hostname === "127.0.0.1");
    assert.equal(init?.redirect, "error");
    if (url.endsWith("/api/tags")) return Response.json(tags);
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    return Response.json({
      embeddings: body.input.map(() => Array(768).fill(0.1)),
    });
  });
  assert.equal(
    (await embedLocal(["test"], "query", profile, request))[0].length,
    768,
  );
  await embedLocal(["documento"], "document", profile, request);
  assert.equal(requests[0].input[0], "task: search result | query: test");
  assert.equal(requests[1].input[0], "title: none | text: documento");
  assert.equal(requests[0].truncate, false);
  assert.equal(requests[0].keep_alive, 0);
  await assert.rejects(
    embedLocal(
      ["test"],
      "query",
      profile,
      fake(() => Response.json({ embeddings: [[1, 2]] })),
    ),
    /Local embedding/,
  );
  await assert.rejects(
    embedLocal(["test"], "query", "old-profile", request),
    /changed/,
  );
});
test("stream handles fragmented UTF-8, final line without newline and real completion metrics", async () => {
  const events = [
    { message: { content: "È pronto. " }, done: false },
    {
      message: { content: "Fine." },
      done: true,
      prompt_eval_count: 27,
      eval_count: 5,
    },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n");
  const bytes = new TextEncoder().encode(events);
  const request = fake((url, init) => {
    assert(url.endsWith("/api/chat"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "qwen2.5:1.5b");
    assert.equal(body.options.num_ctx, 4096);
    assert.equal(body.keep_alive, 0);
    return new Response(
      new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 3)
            c.enqueue(bytes.slice(i, i + 3));
          c.close();
        },
      }),
    );
  });
  const result = [];
  for await (const event of streamLocal(
    "ollama/qwen2.5:1.5b",
    [{ role: "user", content: "test" }],
    request,
  ))
    result.push(event);
  assert.equal(
    result
      .filter((e) => e.type === "delta")
      .map((e) => e.text)
      .join(""),
    "È pronto. Fine.",
  );
  assert.deepEqual(result.at(-1), {
    type: "done",
    inputTokens: 27,
    outputTokens: 5,
  });
});
test("a broken local stream is an error, not a completed response", async () => {
  await assert.rejects(async () => {
    for await (const _ of streamLocal(
      "ollama/qwen2.5:1.5b",
      [],
      fake(
        () => new Response('{"message":{"content":"parziale"},"done":false}\n'),
      ),
    )) {
    }
  }, /interrupted/);
});
test("legacy and changed embedding models require reindexing", () => {
  const doc = {
    status: "ready" as const,
    embedding_model: "text-embedding-3-small",
  };
  assert.equal(needsReindex(doc, profile), true);
  assert.equal(isDocumentReady(doc, profile), false);
  assert.equal(
    isDocumentReady({ ...doc, embedding_model: profile }, profile),
    true,
  );
  assert.equal(
    isDocumentReady({ ...doc, embedding_model: profile }, null),
    false,
  );
  assert.equal(
    needsReindex({ ...doc, embedding_model: profile }, "new-profile"),
    true,
  );
});

test("hosted preview blocks status, embedding and chat without network calls", async () => {
  const oldVercel = process.env.VERCEL;
  const oldRuntime = process.env.SIAAS_RUNTIME;
  const noNetwork = fake(() => {
    throw new Error("Network must not be called");
  });
  try {
    for (const config of [
      { vercel: "1", mode: "local" },
      { vercel: "0", mode: "preview" },
    ]) {
      process.env.VERCEL = config.vercel;
      process.env.SIAAS_RUNTIME = config.mode;
      const state = await ollamaStatus(noNetwork);
      assert.equal(state.mode, "preview");
      assert.equal(state.embeddingReady, false);
      await assert.rejects(requireOllama(undefined, noNetwork), /Coming soon/);
      await assert.rejects(
        embedLocal(["sample"], "document", profile, noNetwork),
        /Coming soon/,
      );
      await assert.rejects(async () => {
        for await (const event of streamLocal(
          "ollama/qwen2.5:1.5b",
          [],
          noNetwork,
        ))
          void event;
      }, /Coming soon/);
    }
  } finally {
    if (oldVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = oldVercel;
    if (oldRuntime === undefined) delete process.env.SIAAS_RUNTIME;
    else process.env.SIAAS_RUNTIME = oldRuntime;
  }
});
