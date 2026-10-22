// Real compiled desktop HTTP + SQLite; Ollama is a deterministic local fixture.
// Run after npm run desktop:build. No real-model quality or Docker claim.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "siaas-actions-api-"));
const calls = [];
let behavior = "normal",
  revision = 1;
const markdown = () =>
  `# My summary\n\n## Purpose\nSummarize the user's supplied notes.\n\n## Instructions\n1. Read the provided notes.\n2. Extract key facts and cite available sources.\n3. Include the marker ACTION_MARKDOWN_REVISION_${revision}.\n\n## Expected Output\nProvide a concise English summary in chat.\n\n## Constraints\nIf information is missing, ask the user. Respect existing assistant restrictions.`;
const ollama = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  res.setHeader("Content-Type", "application/json");
  if (behavior === "offline") {
    res.statusCode = 503;
    return res.end("{}");
  }
  if (req.url === "/api/tags")
    return res.end(
      JSON.stringify({
        models:
          behavior === "missing-model"
            ? []
            : ["test:3b", "test:8b"].map((name) => ({
                name,
                digest: "a".repeat(64),
              })),
      }),
    );
  if (req.url === "/api/show" && behavior === "unavailable-model") {
    res.statusCode = 503;
    return res.end("{}");
  }
  if (req.url === "/api/show")
    return res.end(
      JSON.stringify({
        capabilities:
          body.model === "test:8b" ? ["completion", "tools"] : ["completion"],
        model_info: {
          "general.parameter_count": body.model === "test:8b" ? 8e9 : 3e9,
        },
      }),
    );
  if (req.url === "/api/chat") {
    calls.push(body);
    if (body.format) {
      if (behavior === "invalid")
        return res.end(
          JSON.stringify({ done: true, message: { content: "not JSON" } }),
        );
      let content;
      if (body.format.properties.scope)
        content = {
          scope:
            behavior === "off-topic"
              ? "off_topic"
              : behavior === "unsupported"
                ? "unsupported"
                : "action",
        };
      else if (body.format.properties.english)
        content = {
          english: behavior !== "non-english",
          compatible: true,
          withinScope: true,
        };
      else
        content = {
          reply: "Review the proposed instructions.",
          markdown: markdown(),
          language: "en",
        };
      return res.end(
        JSON.stringify({
          done: true,
          message: { role: "assistant", content: JSON.stringify(content) },
        }),
      );
    }
    // Both normal streaming and the existing LangChain tool-capable path.
    res.setHeader("Content-Type", "application/x-ndjson");
    res.write(
      JSON.stringify({
        model: body.model,
        message: {
          role: "assistant",
          content: "Fixture response from the selected assistant.",
        },
        done: false,
      }) + "\n",
    );
    return res.end(
      JSON.stringify({
        model: body.model,
        message: { role: "assistant", content: "" },
        done: true,
        prompt_eval_count: 12,
        eval_count: 9,
      }) + "\n",
    );
  }
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
const ollamaURL = `http://127.0.0.1:${ollama.address().port}`;
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  key = "actions-test-key-".repeat(4);
const headers = {
  "Content-Type": "application/json",
  "x-siaas-desktop-key": key,
  origin,
};
let server,
  logs = "";
async function start() {
  server = spawn(process.execPath, [resolve(".next/standalone/server.js")], {
    cwd: resolve(".next/standalone"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL: "0",
      SIAAS_RUNTIME: "desktop",
      SIAAS_DATA_DIR: directory,
      SIAAS_DESKTOP_KEY: key,
      SIAAS_DESKTOP_ORIGIN: origin,
      OLLAMA_BASE_URL: ollamaURL,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await api("/api/actions")).status === 200) return;
    } catch {}
    if (server.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(logs);
}
async function stop() {
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill();
    await exited;
  }
}
async function api(path, method = "GET", body, overrides) {
  const response = await fetch(origin + path, {
    method,
    headers: { ...headers, ...overrides },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function draft(extra = {}) {
  return api("/api/actions/builder", "POST", {
    name: "My summary",
    modelId: "ollama/test:3b",
    messages: [
      { role: "user", content: "Create an Action to summarize my notes" },
    ],
    ...extra,
  });
}
async function chat(conversation, question, action) {
  const response = await fetch(origin + "/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversation_id: conversation,
      question,
      ...(action ? { action_id: action } : {}),
    }),
  });
  assert.equal(response.status, 200);
  const output = await response.text();
  assert.match(output, /"type":"done"/, output);
  assert.doesNotMatch(output, /"type":"error"/, output);
  return calls.filter((call) => !call.format).at(-1);
}
try {
  await start();
  assert.equal((await fetch(origin + "/api/actions")).status, 403);
  assert.equal(
    (
      await api(
        "/api/actions",
        "POST",
        {},
        { origin: "https://untrusted.example" },
      )
    ).status,
    403,
  );
  const builtins = (await api("/api/actions")).body;
  assert.deepEqual(
    builtins.map((a) => a.id),
    ["builtin:mindmap", "builtin:report", "builtin:flashcards", "builtin:quiz"],
  );
  for (const action of builtins) {
    assert.equal(
      (await api(`/api/actions/${action.id}`, "DELETE", { confirmed: true }))
        .status,
      403,
    );
    assert.equal(
      (await api(`/api/actions/${action.id}`, "PUT", {})).status,
      403,
    );
    assert.equal((await draft({ actionId: action.id })).status, 403);
  }
  assert.equal((await draft({ name: " " })).status, 400);
  assert.equal((await draft({ name: "report" })).status, 409);
  assert.equal((await api("/api/actions/models")).body.modelId, null);
  const blocked = await draft();
  assert.equal(blocked.status, 503);
  assert.match(blocked.body.error, /Actions.*Models/);
  assert.equal(
    (
      await api("/api/actions/models", "PUT", {
        modelId: "ollama/not-installed:3b",
      })
    ).status,
    503,
  );
  assert.equal(
    (await api("/api/actions/models", "PUT", { modelId: "openai/gpt" })).status,
    400,
  );
  assert.equal(
    (await api("/api/actions/models", "PUT", { modelId: "ollama/test:3b" }))
      .status,
    200,
  );
  // Client model overrides cannot bypass the saved Builder choice.
  let generated = await draft({ modelId: "ollama/test:8b" });
  assert(calls.filter((c) => c.format).every((c) => c.model === "test:3b"));
  assert.equal(generated.status, 200, JSON.stringify(generated));
  assert.equal(
    (await api("/api/actions")).body.length,
    4,
    "preview/cancellation creates no Action",
  );
  assert.equal(
    (
      await api("/api/actions", "POST", {
        preview: generated.body.preview,
        confirmed: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("/api/actions", "POST", {
        preview: generated.body.preview + "x",
        confirmed: true,
      })
    ).status,
    409,
  );
  const saved = await api("/api/actions", "POST", {
    preview: generated.body.preview,
    confirmed: true,
  });
  assert.equal(saved.status, 201, JSON.stringify(saved));
  const id = saved.body.id;
  await api("/api/actions/models", "PUT", { modelId: null });
  assert.equal((await draft({ actionId: id })).status, 503);
  assert.equal(
    (await api(`/api/actions/${id}`)).body.markdown,
    saved.body.markdown,
  );
  await api("/api/actions/models", "PUT", { modelId: "ollama/test:3b" });
  assert.equal(
    (
      await api("/api/actions", "POST", {
        preview: generated.body.preview,
        confirmed: true,
      })
    ).status,
    409,
  );
  revision = 2;
  generated = await draft({ actionId: id, draft: saved.body.markdown });
  assert.equal(
    (await api(`/api/actions/${id}`)).body.markdown,
    saved.body.markdown,
    "cancel edit leaves original intact",
  );
  const edited = await api(`/api/actions/${id}`, "PUT", {
    preview: generated.body.preview,
    confirmed: true,
  });
  assert.equal(edited.status, 200, JSON.stringify(edited));
  assert.match(edited.body.markdown, /REVISION_2/);
  assert.equal(
    (
      await api(`/api/actions/${id}`, "PUT", {
        preview: generated.body.preview,
        confirmed: true,
      })
    ).status,
    409,
    "stale edit rejected",
  );
  await stop();
  await start();
  assert.equal(
    (await api(`/api/actions/${id}`)).body.markdown,
    edited.body.markdown,
  );
  assert.equal((await api("/api/actions")).body.length, 5);
  assert.equal(
    (await api("/api/actions/models")).body.modelId,
    "ollama/test:3b",
  );
  assert.equal((await api("/api/actions/models")).body.ready, true);
  for (const mode of [
    "off-topic",
    "unsupported",
    "invalid",
    "non-english",
    "offline",
    "missing-model",
    "unavailable-model",
  ]) {
    behavior = mode;
    if (["offline", "missing-model", "unavailable-model"].includes(mode)) {
      const status = (await api("/api/actions/models")).body;
      assert.equal(status.ready, false);
      assert.equal(status.modelId, "ollama/test:3b");
      assert.equal(
        (
          await api(`/api/actions/${id}`, "PUT", {
            preview: generated.body.preview,
            confirmed: true,
          })
        ).status,
        503,
      );
      assert.equal(
        (
          await api("/api/actions", "POST", {
            preview: generated.body.preview,
            confirmed: true,
          })
        ).status,
        503,
      );
    }
    const result = await draft({ name: "Another Action" });
    if (["off-topic", "unsupported"].includes(mode)) {
      assert.equal(result.status, 200);
      assert.equal(result.body.preview, null);
      assert.equal(result.body.markdown, null);
    } else assert(result.status >= 400, JSON.stringify(result));
    assert.equal((await api("/api/actions")).body.length, 5);
  }
  behavior = "normal";
  const project = (
    await api("/api/projects", "POST", { name: "Actions regression" })
  ).body;
  for (const model of ["test:3b", "test:8b"]) {
    const assistantResult = await api("/api/assistants", "POST", {
      project_id: project.id,
      name: model,
      instructions: "PRESERVE_ASSISTANT_INSTRUCTIONS",
      model_id: `ollama/${model}`,
    });
    assert.equal(assistantResult.status, 201, JSON.stringify(assistantResult));
    const assistant = assistantResult.body;
    assert.equal(
      (await api("/api/actions/models", "PUT", { modelId: "ollama/test:8b" }))
        .status,
      200,
    );
    assert.equal(
      (await api("/api/workspace")).body.assistants.find(
        (a) => a.id === assistant.id,
      ).model_id,
      `ollama/${model}`,
    );
    if (model === "test:8b")
      await api("/api/actions/models", "PUT", { modelId: null });
    const conversation = (
      await api("/api/conversations", "POST", { assistant_id: assistant.id })
    ).body;
    await chat(conversation.id, "Earlier conversation context.");
    const actionCall = await chat(
      conversation.id,
      "Summarize this current request",
      id,
    );
    assert.equal(actionCall.model, model);
    assert(
      actionCall.messages.some(
        (m) =>
          m.role === "system" &&
          m.content.includes("PRESERVE_ASSISTANT_INSTRUCTIONS"),
      ),
    );
    assert(
      actionCall.messages.some((m) =>
        m.content.includes("Earlier conversation context."),
      ),
    );
    const last = actionCall.messages
      .filter((m) => m.role === "user")
      .at(-1).content;
    assert(last.includes(JSON.stringify(edited.body.markdown)));
    assert.match(last, /Summarize this current request/);
    if (model === "test:8b")
      assert.deepEqual(
        actionCall.tools.map((tool) => tool.function.name).sort(),
        ["create_report", "read_document", "search_documents"],
      );
    else assert.equal(actionCall.tools, undefined);
    const nextCall = await chat(conversation.id, "Unrelated next request");
    assert(
      !JSON.stringify(nextCall.messages).includes("ACTION_MARKDOWN_REVISION_2"),
      "Action body must not leak to later LLM requests",
    );
    const history = (await api(`/api/conversations/${conversation.id}`)).body
      .messages;
    const user = history.find((m) => m.action_id === id);
    assert.equal(user.content, "Summarize this current request");
    assert.equal(user.action_name, "My summary");
    assert(!JSON.stringify(history).includes("ACTION_MARKDOWN_REVISION_2"));
    assert.equal(
      (await api("/api/workspace")).body.assistants.find(
        (a) => a.id === assistant.id,
      ).instructions,
      "PRESERVE_ASSISTANT_INSTRUCTIONS",
    );
    const builtinCall = await chat(
      conversation.id,
      "Use my knowledge",
      "builtin:report",
    );
    assert(
      builtinCall.messages
        .at(-1)
        .content.includes(JSON.stringify(builtins[1].markdown)),
    );
  }
  assert.equal(
    (await api(`/api/actions/${id}`, "DELETE", { confirmed: false })).status,
    400,
  );
  assert.equal(
    (await api(`/api/actions/${id}`, "DELETE", { confirmed: true })).status,
    200,
  );
  assert.equal((await api(`/api/actions/${id}`)).status, 404);
  console.log(
    "PASS: compiled desktop API, built-in protections, real SQLite CRUD/restart, preview confirmation/tampering/conflicts, builder error/scope gates with mock Ollama, exact Markdown in plain and agent chat, preserved instructions/context/model/tools, no later-turn instruction replay, deletion and origin protection.",
  );
} finally {
  await stop();
  await new Promise((r) => ollama.close(r));
  await rm(directory, { recursive: true, force: true });
}
