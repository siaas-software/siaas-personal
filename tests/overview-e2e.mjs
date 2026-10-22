// Run after npm run desktop:build. Uses a real local SQLite store and the shipped
// server, with deterministic Ollama responses. No external service or GPU needed.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
const directory = await mkdtemp(join(tmpdir(), "siaas-overview-e2e-"));
let offline = false,
  empty = false,
  releaseChat,
  chatStarted;
const started = new Promise((r) => {
  chatStarted = r;
});
const release = new Promise((r) => {
  releaseChat = r;
});
const models = [
  {
    name: "qwen2.5:1.5b",
    digest: "a".repeat(64),
    size: 1e9,
    details: {
      family: "qwen2",
      parameter_size: "1.5B",
      quantization_level: "Q4_K_M",
      format: "gguf",
    },
  },
  { name: "qwen2.5-coder:3b", digest: "b".repeat(64), size: 2e9 },
  { name: "embeddinggemma:latest", digest: "c".repeat(64), size: 6e8 },
  { name: "unassigned:latest", digest: "d".repeat(64), size: 3e9 },
];
const ollama = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  res.setHeader("Content-Type", "application/json");
  if (offline) {
    res.writeHead(503);
    return res.end("{}");
  }
  if (req.url === "/api/tags")
    return res.end(JSON.stringify({ models: empty ? [] : models }));
  if (req.url === "/api/ps")
    return res.end(
      JSON.stringify({
        models: empty
          ? []
          : [
              {
                ...models[0],
                size: 1.4e9,
                size_vram: 8e8,
                context_length: 4096,
              },
            ],
      }),
    );
  if (req.url === "/api/show")
    return res.end(JSON.stringify({ capabilities: ["completion"] }));
  if (req.url === "/api/chat") {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.write(
      JSON.stringify({ message: { content: "Risposta " }, done: false }) + "\n",
    );
    chatStarted();
    await release;
    return res.end(
      JSON.stringify({
        message: { content: "completata." },
        done: true,
        prompt_eval_count: 12,
        eval_count: 6,
        eval_duration: 3e9,
      }),
    );
  }
  res.writeHead(404);
  res.end("{}");
});
let server,
  browser,
  logs = "";
try {
  await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const origin = `http://127.0.0.1:${port}`,
    key = "overview-local-test-key-not-a-user-secret";
  server = spawn(process.execPath, [resolve(".next/standalone/server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      SIAAS_RUNTIME: "desktop",
      SIAAS_DESKTOP_DEV: "1",
      VERCEL: "0",
      SIAAS_DATA_DIR: directory,
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
  async function api(path, body) {
    const result = await fetch(origin + path, {
      headers,
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await result.text();
    assert.equal(result.ok, true, `${path}: ${raw}\n${logs}`);
    return JSON.parse(raw);
  }
  for (let i = 0; i < 80; i++) {
    try {
      await api("/api/workspace");
      break;
    } catch {
      if (i === 79) throw new Error(logs);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.equal(
    (await fetch(origin + "/api/local/overview")).status,
    403,
    "desktop authentication remains required",
  );
  const project = await api("/api/projects", { name: "Eventi" });
  const other = await api("/api/projects", { name: "Studio" });
  const assistant = await api("/api/assistants", {
    project_id: project.id,
    name: "Organizzatore",
    model_id: "ollama/qwen2.5:1.5b",
  });
  await api("/api/assistants", {
    project_id: other.id,
    name: "Tutor",
    model_id: "ollama/qwen2.5:1.5b",
  });
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
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/?assistant=${assistant.id}`);
  await page.getByPlaceholder("Type a message…").fill("Verifica overview");
  await page.getByRole("button", { name: "Send message" }).click();
  await started;
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Overview." }).waitFor();
  const active = page
    .locator(".overview-summary article")
    .filter({ hasText: "Active SIAAS Personal generations" });
  await page.waitForFunction(
    () => document.querySelectorAll(".overview-table tbody tr").length === 4,
  );
  assert.equal(await active.locator("strong").textContent(), "1");
  const current = await api("/api/local/overview");
  assert.equal(current.models[0].assistants.length, 2);
  assert.equal(current.models[0].projects.length, 2);
  assert.equal(current.models[0].state, "in-use");
  assert.ok(current.resources.ramTotal > 0);
  releaseChat();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".overview-summary article")]
        .find((e) => e.textContent.includes("Active SIAAS Personal generations"))
        ?.querySelector("strong")?.textContent === "0",
  );
  assert.match(page.url(), /view=overview/);
  const completed = await api("/api/local/overview");
  assert.equal(completed.models[0].recent[0].tokensPerSecond, 2);
  assert.equal(completed.models[0].recent[0].assistantId, assistant.id);
  assert.equal(completed.models[0].recent[0].projectId, project.id);
  await page.getByRole("button", { name: "qwen2.5:1.5b", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").textContent(), /2 token\/s/);
  assert.match(await page.getByRole("dialog").textContent(), /Organizzatore/);
  await page.keyboard.press("Escape");
  await page.getByLabel("Project", { exact: true }).selectOption(other.id);
  assert.equal(await page.locator(".overview-table tbody tr").count(), 1);
  await page.getByLabel("Project", { exact: true }).selectOption("");
  await page.getByLabel("Search models").fill("embedding");
  assert.equal(await page.locator(".overview-table tbody tr").count(), 1);
  await page.getByLabel("Search models").fill("");
  await page.getByLabel("Status", { exact: true }).selectOption("loaded");
  assert.equal(await page.locator(".overview-table tbody tr").count(), 1);
  await page.getByLabel("Status", { exact: true }).selectOption("all");
  if (process.env.SIAAS_TEST_SCREENSHOT)
    await page.screenshot({
      path: process.env.SIAAS_TEST_SCREENSHOT,
      fullPage: true,
    });
  offline = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByText("Ollama non raggiungibile: l’elenco", { exact: false })
    .waitFor();
  assert.equal(
    await page.locator(".overview-table tbody tr").count(),
    4,
    "retain clearly stale inventory",
  );
  assert.equal((await api("/api/local/overview")).loadedCount, null);
  offline = false;
  empty = true;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page
    .getByText("No installed local models to monitor.", {
      exact: true,
    })
    .waitFor();
  empty = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "qwen2.5:1.5b", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "qwen2.5:1.5b", exact: true }).click();
  await page
    .getByRole("button", { name: "Organizzatore", exact: true })
    .click();
  await page.getByPlaceholder("Type a message…").waitFor();
  assert.match(page.url(), new RegExp(assistant.id));
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.reload();
  await page.getByRole("heading", { name: "Overview." }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "no page-level mobile overflow",
  );
  assert.deepEqual(errors, []);
  assert.doesNotMatch(
    logs,
    /Request failed|Cannot find module|outside a request scope/,
  );
  console.log(
    "PASS: Overview → authenticated API → real SQLite telemetry; live chat, measured metrics, cross-project links, filters, offline/recovery/empty states, navigation during generation and responsive UI.",
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  releaseChat();
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
  ollama.closeAllConnections();
  if (ollama.listening) await new Promise((r) => ollama.close(r));
  await rm(directory, { recursive: true, force: true });
}
