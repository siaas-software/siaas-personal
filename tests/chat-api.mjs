// Run after npm run desktop:build. Exercises the shipped server without access
// to the project's node_modules, using SQLite and a deterministic Ollama fixture.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const directory = await mkdtemp(join(tmpdir(), "siaas-chat-regression-"));
const serverDirectory = join(directory, "server");
const digest = "a".repeat(64);
const calls = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ollama = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  calls.push(req.url);
  if (req.url === "/api/show") {
    const count = { "qwen3:8b": 8e9, "qwen3:7b": 7e9, "plain:14b": 14e9 }[
      body.model
    ];
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({
        capabilities: body.model.startsWith("qwen3:")
          ? ["completion", "tools"]
          : ["completion"],
        model_info: count ? { "general.parameter_count": count } : {},
      }),
    );
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/tags")
    return res.end(
      JSON.stringify({
        models: [
          { name: "qwen2.5:1.5b", digest },
          { name: "qwen2.5-coder:3b", digest },
          { name: "embeddinggemma:latest", digest },
          ...["qwen3:8b", "qwen3:7b", "plain:14b", "unknown:latest"].map(
            (name) => ({ name, digest }),
          ),
        ],
      }),
    );
  if (req.url === "/api/embed")
    return res.end(
      JSON.stringify({
        embeddings: body.input.map(() =>
          Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)),
        ),
      }),
    );
  if (req.url === "/api/chat") {
    if (body.model === "qwen3:8b") {
      assert.deepEqual(body.tools.map((t) => t.function.name).sort(), [
        "create_report",
        "inspect_datasets",
        "query_datasets",
        "read_document",
        "search_documents",
      ]);
      assert.equal(
        body.keep_alive,
        "5m",
        "retain the model between tool calls",
      );
      const outputs = body.messages.filter((m) => m.role === "tool");
      const scenario = body.messages
        .filter((m) => m.role === "user")
        .at(-1)?.content;
      const recover = scenario === "Verifica recupero errore";
      const direct = scenario === "Crea report dai passaggi trovati";
      let next;
      if (outputs.length === 0)
        next = { name: "search_documents", arguments: { query: "SIAAS Personal" } };
      else if (outputs.length === 1) {
        const found = JSON.parse(outputs[0].content);
        assert.equal(
          found.documents.length,
          1,
          "tools must not expose another assistant’s documents",
        );
        assert.equal(found.documents[0].document_id, "doc_1");
        assert.equal(found.matches[0].document_id, "doc_1");
        assert.equal(
          found.matches[0].id,
          undefined,
          "do not expose confusing chunk IDs to the model",
        );
        next = direct
          ? {
              name: "create_report",
              arguments: {
                title: "Report SIAAS Personal",
                markdown: "# Report SIAAS Personal\n" + found.matches[0].content,
              },
            }
          : {
              name: "read_document",
              arguments: recover
                ? {}
                : { document_id: found.documents[0].document_id },
            };
      } else if (recover && outputs.length === 2) {
        assert.match(outputs[1].content, /error|invalid|required|schema/i);
        next = { name: "read_document", arguments: { document_id: "doc_1" } };
      } else if (!direct && outputs.length === (recover ? 3 : 2)) {
        assert.match(outputs.at(-1).content, /SIAAS Personal/);
        next = {
          name: "create_report",
          arguments: {
            title: "Report SIAAS Personal",
            markdown: "# Report SIAAS Personal\nSIAAS è operativo.",
          },
        };
      } else {
        assert.equal(outputs.length, direct ? 2 : recover ? 4 : 3);
        assert.equal(JSON.parse(outputs.at(-1).content).saved, true);
      }
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(
        JSON.stringify({
          model: body.model,
          message: {
            role: "assistant",
            content: next ? "" : "Report creato.",
            ...(next ? { tool_calls: [{ function: next }] } : {}),
          },
          done: false,
        }) + "\n",
      );
      return res.end(
        JSON.stringify({
          model: body.model,
          message: { role: "assistant", content: "" },
          done: true,
          prompt_eval_count: 20,
          eval_count: 10,
        }) + "\n",
      );
    }
    assert.equal(body.tools, undefined, "normal chat must not receive tools");
    res.setHeader("Content-Type", "application/x-ndjson");
    // Delay generation until after the route has returned its HTTP response.
    await pause(120);
    res.write(
      JSON.stringify({ message: { content: "Sì, sono " }, done: false }) + "\n",
    );
    await pause(50);
    // Ollama's final event need not have a trailing newline.
    return res.end(
      JSON.stringify({
        message: { content: "operativo." },
        done: true,
        prompt_eval_count: 269,
        eval_count: 16,
      }),
    );
  }
  res.statusCode = 404;
  res.end("{}");
});
let server, browser;
let logs = "";
try {
  await cp(resolve(".next/standalone"), serverDirectory, {
    recursive: true,
    dereference: true,
  });
  await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const key = "local-chat-regression-key-not-a-user-secret";
  server = spawn(process.execPath, [join(serverDirectory, "server.js")], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_PATH: "",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      SIAAS_RUNTIME: "desktop",
      SIAAS_DESKTOP_DEV: "1",
      VERCEL: "0",
      SIAAS_DATA_DIR: join(directory, "data"),
      SIAAS_DESKTOP_KEY: key,
      SIAAS_DESKTOP_ORIGIN: origin,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  const headers = {
    "Content-Type": "application/json",
    origin,
    "x-siaas-desktop-key": key,
  };
  async function request(path, body) {
    return fetch(origin + path, {
      headers,
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  }
  async function api(path, body) {
    const response = await request(path, body);
    const raw = await response.text();
    assert(response.ok, `${path}: ${response.status} ${raw}\n${logs}`);
    return JSON.parse(raw);
  }
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await request("/")).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) break;
    await pause(200);
  }
  assert(ready, logs);
  const project = await api("/api/projects", { name: "Chat regression" });
  const assistant = await api("/api/assistants", {
    project_id: project.id,
    name: "Planner",
    model_id: "ollama/qwen2.5-coder:3b",
    instructions: "Rispondi in italiano.",
  });
  const conversation = await api("/api/conversations", {
    assistant_id: assistant.id,
  });
  async function chat(question, expectedSources, expectedMessages) {
    const response = await request("/api/chat", {
      conversation_id: conversation.id,
      question,
    });
    const body = await response.text();
    assert.equal(response.status, 200, `${body}\n${logs}`);
    assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
    const events = body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events[0].type, "start");
    assert.equal(events.at(-1).type, "done");
    assert(!events.some((event) => event.type === "error"));
    assert.equal(
      events
        .filter((event) => event.type === "delta")
        .map((event) => event.text)
        .join(""),
      "Sì, sono operativo.",
    );
    assert.equal(
      events.find((event) => event.type === "sources").sources.length,
      expectedSources,
    );
    const saved = await api("/api/conversations/" + conversation.id);
    assert.equal(saved.messages.length, expectedMessages);
    assert(saved.messages.every((message) => message.status === "complete"));
    const reply = saved.messages.at(-1);
    assert.equal(reply.content, "Sì, sono operativo.");
    assert.equal(reply.input_tokens, 269);
    assert.equal(reply.output_tokens, 16);
    assert.equal(reply.sources.length, expectedSources);
  }
  await chat("sei operativo?", 0, 2);
  const doc = await api("/api/documents", {
    assistant_id: assistant.id,
    title: "Testo di prova",
    kind: "text",
    text: "SIAAS Personal è operativo e risponde alle domande tramite un modello locale.",
  });
  await api("/api/documents/" + doc.id + "/process", {});
  await chat("sei operativo con il documento?", 1, 4);
  await chat("confermi?", 1, 6);
  assert.equal(calls.filter((path) => path === "/api/chat").length, 3);
  assert.equal(calls.filter((path) => path === "/api/embed").length, 3);
  let agentFixture;
  for (const [model, enabled] of [
    ["qwen3:8b", true],
    ["qwen3:7b", false],
    ["plain:14b", false],
    ["unknown:latest", false],
  ]) {
    const status = await api(
      "/api/local/models?model=" + encodeURIComponent("ollama/" + model),
    );
    assert.equal(status.enabled, enabled, model);
    const a = await api("/api/assistants", {
      project_id: project.id,
      name: model,
      model_id: "ollama/" + model,
      instructions: "Rispondi in italiano.",
    });
    const c = await api("/api/conversations", { assistant_id: a.id });
    if (enabled) {
      const d = await api("/api/documents", {
        assistant_id: a.id,
        title: "SIAAS Personal",
        kind: "text",
        text: "SIAAS Personal è operativo e conserva i documenti sul PC.",
      });
      await api("/api/documents/" + d.id + "/process", {});
      agentFixture = { assistant: a, conversation: c };
    }
    const response = await request("/api/chat", {
      conversation_id: c.id,
      question: "Cerca nei documenti e crea un report SIAAS Personal.",
      agent_mode: true,
    });
    const raw = await response.text();
    assert.equal(response.status, 200, raw);
    const events = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events[0].agent_mode, enabled);
    assert.equal(events.at(-1).type, "done", raw);
    const saved = await api("/api/conversations/" + c.id);
    const reply = saved.messages.at(-1);
    assert.equal(reply.agent_mode, enabled);
    if (enabled) {
      assert.equal(reply.content, "Report creato.");
      assert.equal(reply.input_tokens, 80);
      assert.equal(reply.output_tokens, 40);
      assert.equal(reply.sources.length, 1);
      assert.equal(reply.artifacts.length, 1);
      assert.deepEqual(
        reply.agent_steps.map((s) => [s.tool, s.status]),
        [
          ["search_documents", "success"],
          ["read_document", "success"],
          ["create_report", "success"],
        ],
      );
      assert(events.some((e) => e.type === "steps"));
      assert(events.some((e) => e.type === "activity"));
      const download = await request(
        `/api/local/reports/${reply.artifacts[0].id}?conversation=${c.id}`,
      );
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-disposition"), /attachment/);
      assert.match(await download.text(), /# Report SIAAS Personal/);
      const other = await request(
        `/api/local/reports/${reply.artifacts[0].id}?conversation=${conversation.id}`,
      );
      assert.equal(other.status, 404);
    } else {
      assert.equal(reply.content, "Sì, sono operativo.");
      assert.equal(reply.artifacts, undefined);
    }
  }
  for (const [question, expectedSteps] of [
    ["Verifica recupero errore", 4],
    ["Crea report dai passaggi trovati", 2],
  ]) {
    const c = await api("/api/conversations", {
      assistant_id: agentFixture.assistant.id,
    });
    const response = await request("/api/chat", {
      conversation_id: c.id,
      question,
    });
    const raw = await response.text();
    const events = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, "done", raw);
    const reply = (await api("/api/conversations/" + c.id)).messages.at(-1);
    assert.equal(reply.artifacts.length, 1);
    assert.equal(reply.agent_steps.length, expectedSteps);
    assert.equal(
      reply.agent_steps.filter((s) => s.status === "error").length,
      question === "Verifica recupero errore" ? 1 : 0,
    );
    assert.equal(reply.agent_steps.at(-1).tool, "create_report");
    assert(
      !JSON.stringify(reply.agent_steps).includes("SIAAS Personal è operativo"),
      "diagnostics must not duplicate document contents",
    );
  }
  const overview = await api("/api/local/overview");
  const agentModel = overview.models.find(m => m.name === "qwen3:8b");
  assert(agentModel.recent.length >= 3, "agent calls are recorded individually");
  assert(agentModel.recent.every(r => r.status === "complete"));
  assert(agentModel.recent.every(r => r.inputTokens === 20 && r.outputTokens === 10));
  assert(overview.models.find(m => m.name === "embeddinggemma:latest").recent.some(r => r.kind === "embedding"));
  if (process.env.SIAAS_TEST_UI === "1") {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
      extraHTTPHeaders: { "x-siaas-desktop-key": key },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Match Electron’s session-level header injection, including downloads.
    await page.context().route("**/api/local/reports/**", (route) =>
      route.continue({
        headers: { ...route.request().headers(), "x-siaas-desktop-key": key },
      }),
    );
    await page.route("**/api/local/hardware", (route) =>
      route.fulfill({
        json: {
          hardware: { ram: 16, gpu: "cpu", vram: 0, disk: 100 },
          cpu: "CPU test",
          gpuName: "Grafica integrata",
          freeRam: 12,
          note: "",
        },
      }),
    );
    const url = `${origin}/?project=${project.id}&assistant=${agentFixture.assistant.id}&conversation=${agentFixture.conversation.id}`;
    await page.goto(url);
    await page
      .getByRole("status")
      .filter({ hasText: "Agente attivo" })
      .waitFor();
    await page.getByText("Attività dell’agente", { exact: true }).click();
    await page
      .getByText("Report salvato e disponibile per il download.", {
        exact: true,
      })
      .waitFor();
    const report = page.getByRole("link", { name: "Report SIAAS Personal · Markdown" });
    await report.waitFor();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      report.click(),
    ]);
    assert.equal(
      download.suggestedFilename(),
      "Report SIAAS Personal.md",
      await readFile(await download.path(), "utf8"),
    );
    assert.match(
      await readFile(await download.path(), "utf8"),
      /# Report SIAAS Personal/,
    );
    await page
      .getByPlaceholder("Scrivi un messaggio…")
      .fill("Cerca nei documenti e crea un report aggiornato.");
    await page.getByRole("button", { name: "Invia domanda" }).click();
    await page
      .getByRole("link", { name: "Report SIAAS Personal · Markdown" })
      .nth(1)
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".chat-messages")?.getAttribute("aria-busy") ===
        "false",
    );
    const persisted = await api(
      "/api/conversations/" + agentFixture.conversation.id,
    );
    assert.equal(persisted.messages.at(-1).status, "complete");
    assert.equal(persisted.messages.at(-1).artifacts.length, 1);
    if (process.env.SIAAS_TEST_SCREENSHOT)
      await page.screenshot({
        path: process.env.SIAAS_TEST_SCREENSHOT,
        fullPage: true,
      });
    await page
      .getByRole("tab", { name: "Configurazione", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Agente attivo" })
      .waitFor();
    const changed = await fetch(
      `${origin}/api/assistants/${agentFixture.assistant.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          ...agentFixture.assistant,
          model_id: "ollama/qwen3:7b",
        }),
      },
    );
    assert.equal(changed.status, 200, await changed.text());
    await page.goto(url);
    await page
      .getByRole("status")
      .filter({ hasText: "Chat normale" })
      .waitFor();
    await page.getByPlaceholder("Scrivi un messaggio…").fill("Confermi?");
    await page.getByRole("button", { name: "Invia domanda" }).click();
    await page.getByText("Sì, sono operativo.", { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".chat-messages")?.getAttribute("aria-busy") ===
        "false",
    );
    assert.equal(
      (
        await api("/api/conversations/" + agentFixture.conversation.id)
      ).messages.at(-1).agent_mode,
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: browser chat submission, agent status, settings, report download and automatic fallback after model change.",
    );
  }
  assert(
    !/Request failed|outside a request scope|Cannot find module/.test(logs),
    logs,
  );
  console.log(
    "PASS: isolated desktop bundle; normal chat and RAG; agent eligibility; three-tool loop; scoped documents; report download; SQLite persistence.",
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
  ollama.closeAllConnections();
  if (ollama.listening) await new Promise((r) => ollama.close(r));
  await rm(directory, { recursive: true, force: true });
}
