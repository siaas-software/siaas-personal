// Real browser -> compiled desktop API -> temporary SQLite; deterministic Ollama.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const dir = await mkdtemp(join(tmpdir(), "siaas-hardware-"));
let pulls = 0;
const installed = ["qwen2.5:1.5b"];
const ollama = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/tags")
    return res.end(
      JSON.stringify({
        models: [
          ...installed.map((name) => ({ name, digest: "b".repeat(64) })),
          { name: "embeddinggemma:latest", digest: "a".repeat(64) },
        ],
      }),
    );
  if (req.url === "/api/pull") {
    pulls++;
    installed.push(body.model);
    return res.end(JSON.stringify({ status: "success" }) + "\n");
  }
  if (req.url === "/api/show")
    return res.end(
      JSON.stringify({
        capabilities: ["completion"],
        details: { parameter_size: "1.5B" },
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
    const prompt = body.messages.at(-1).content;
    const content = prompt.includes("data table")
      ? "| Model | Interval |\n| --- | --- |\n| Test machine | 500 hours [1] |"
      : "Maintenance is required every 500 hours [1].";
    return res.end(
      JSON.stringify({
        message: { content },
        done: true,
        prompt_eval_count: 30,
        eval_count: 15,
      }) + "\n",
    );
  }
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  key = "workbench-test-key-".repeat(4);
const headers = {
  "x-siaas-desktop-key": key,
  origin,
  "Content-Type": "application/json",
};
let logs = "";
const server = spawn(
  process.execPath,
  [resolve(".next/standalone/server.js")],
  {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      VERCEL: "0",
      SIAAS_RUNTIME: "desktop",
      SIAAS_DESKTOP_DEV: "0",
      SIAAS_DESKTOP_KEY: key,
      SIAAS_DESKTOP_ORIGIN: origin,
      SIAAS_DATA_DIR: dir,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
let browser;
async function api(path, method = "GET", body) {
  const r = await fetch(origin + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert(r.ok, `${path}: ${r.status} ${JSON.stringify(data)} ${logs}`);
  return data;
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin, { headers })).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  const p = await api("/api/projects", "POST", {
    name: "Hardware QA",
    description: "",
    color: "#ffffff",
  });
  const a = await api("/api/assistants", "POST", {
    project_id: p.id,
    name: "Existing assistant",
    description: "Keep me",
    instructions: "Preserve instructions.",
    model_id: "ollama/qwen2.5:1.5b",
  });
  const detected = await api("/api/local/hardware");
  assert(Number.isFinite(detected.hardware.ram));
  assert(Number.isFinite(detected.hardware.disk));
  assert((await api("/api/local/model-catalog")).models.length > 100);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({
      extraHTTPHeaders: { "x-siaas-desktop-key": key },
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/?assistant=${a.id}`);
  await page.getByRole("tab", { name: "Models", exact: true }).click();
  await page
    .getByRole("heading", { name: "Find the right model", exact: true })
    .waitFor();
  await page.getByText(/RAM libera al rilevamento/).waitFor();
  assert.equal(
    Number(await page.getByLabel("Total RAM (GB)").inputValue()),
    detected.hardware.ram,
  );
  const finder = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Find the right model",
      exact: true,
    }),
  });
  assert.equal(await finder.locator(".hardware-card").count(), 3);
  assert(!(await finder.innerText()).includes("Qwen"));
  assert.equal(pulls, 0, "Opening Models must not download anything");
  const before = (await api("/api/workspace")).assistants.find(
    (item) => item.id === a.id,
  );
  assert.equal(before.model_id, a.model_id);
  await page.getByLabel("Total RAM (GB)").fill("16");
  await page.getByLabel("Graphics processor").selectOption("cpu");
  await page.getByLabel("Free disk space (GB)").fill("1");
  assert.equal(
    await finder
      .getByRole("heading", { name: "No compatible sizes", exact: true })
      .count(),
    3,
  );
  await page.getByLabel("Free disk space (GB)").fill("100");
  await page.route("**/api/local/model-catalog?refresh=1", (route) =>
    route.fulfill({
      json: {
        updatedAt: "test",
        models: [
          {
            id: "testfamily:7b-q4_K_M",
            name: "Test 7B Q4",
            family: "testfamily",
          },
          { id: "large:14b-q8_0", name: "Large 14B Q8", family: "large" },
        ],
      },
    }),
  );
  await page
    .getByRole("button", { name: "Refresh catalog", exact: true })
    .click();
  await finder.getByRole("heading", { name: "7B", exact: true }).waitFor();
  await finder.getByText(/CPU · slower response/).waitFor();
  await page.getByLabel("Graphics processor").selectOption("dedicated");
  await page.getByLabel("Dedicated VRAM (GB)").fill("8");
  await finder.getByText(/Some entries fit GPU memory/).waitFor();
  await page.getByLabel("Dedicated VRAM (GB)").fill("4");
  await finder.getByText(/CPU · slower response/).waitFor();
  await page.getByLabel("Graphics processor").selectOption("unified");
  await finder.getByText(/Some entries fit GPU memory/).waitFor();
  assert.equal(
    pulls,
    0,
    "Hardware edits and catalog refresh must not download",
  );
  assert.equal(
    (await api("/api/workspace")).assistants.find((item) => item.id === a.id)
      .model_id,
    a.model_id,
  );
  await page.getByLabel("Search models").fill("testfamily");
  const card = page
    .locator(".model-catalog .hardware-card")
    .filter({ hasText: "testfamily:7b-q4_K_M" });
  await card
    .getByRole("button", { name: "Download model", exact: true })
    .click();
  await card.getByRole("button", { name: "Installed", exact: true }).waitFor();
  assert.equal(pulls, 1);
  assert.equal(
    (await api("/api/workspace")).assistants.find((item) => item.id === a.id)
      .model_id,
    a.model_id,
    "Download does not select a model",
  );
  await card
    .getByRole("button", { name: "Use for assistant", exact: true })
    .click();
  await card.getByRole("button", { name: "Selected", exact: true }).waitFor();
  const after = (await api("/api/workspace")).assistants.find(
    (item) => item.id === a.id,
  );
  assert.equal(after.model_id, "ollama/testfamily:7b-q4_K_M");
  assert.equal(after.instructions, before.instructions);
  assert.equal(after.description, before.description);
  // A late automatic response must not overwrite manual edits.
  await page.route("**/api/local/hardware", async (route) => {
    await new Promise((r) => setTimeout(r, 1000));
    await route.fulfill({
      json: {
        ...detected,
        hardware: { ram: 99, gpu: "cpu", vram: 0, disk: 100 },
      },
    });
  });
  await page.reload();
  await page.getByRole("tab", { name: "Models", exact: true }).click();
  await page.getByLabel("Total RAM (GB)").fill("12");
  await page.waitForTimeout(1300);
  assert.equal(await page.getByLabel("Total RAM (GB)").inputValue(), "12");
  assert.equal(
    (await api("/api/workspace")).assistants.find((item) => item.id === a.id)
      .model_id,
    after.model_id,
  );
  await mkdir("test-results/hardware", { recursive: true });
  await page.screenshot({
    path: "test-results/hardware/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "No mobile overflow",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real hardware API/detection, manual edits/late detection, dynamic catalog sizes, RAM/VRAM/disk statuses, explicit installation/selection, preserved assistant configuration, mobile layout and no browser errors. Ollama transfers simulated.",
  );
} finally {
  if (browser) await browser.close();
  server.kill();
  await new Promise((r) => server.once("exit", r));
  await new Promise((r) => ollama.close(r));
  await rm(dir, { recursive: true, force: true });
}
