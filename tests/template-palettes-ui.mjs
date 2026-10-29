// Acceptance test against the real standalone desktop HTTP server and SQLite.
// Only Ollama model discovery is simulated; no personal data or installed app is used.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const directory = await mkdtemp(join(tmpdir(), "siaas-template-palettes-"));
const ollama = createServer((req, res) => {
  if (req.url === "/api/show") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ capabilities: ["completion"] }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      models: [
        { name: "qwen2.5:1.5b", digest: "a".repeat(64) },
        { name: "qwen2.5-coder:3b", digest: "c".repeat(64) },
        { name: "embeddinggemma:latest", digest: "b".repeat(64) },
      ],
    }),
  );
});
await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
const key = "isolated-template-palettes-key-000000";
const headers = {
  "Content-Type": "application/json",
  origin,
  "x-siaas-desktop-key": key,
};
let server,
  browser,
  logs = "";
async function request(path, method = "GET", body) {
  return fetch(origin + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function api(path, method = "GET", body) {
  const r = await request(path, method, body);
  const text = await r.text();
  assert(r.ok, `${method} ${path}: ${r.status} ${text}\n${logs}`);
  return JSON.parse(text);
}
async function until(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Condition timed out");
}
async function start() {
  server = spawn(process.execPath, [resolve(".next/standalone/server.js")], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      SIAAS_RUNTIME: "desktop",
      SIAAS_DESKTOP_DEV: "1",
      SIAAS_DESKTOP_KEY: key,
      SIAAS_DESKTOP_ORIGIN: origin,
      SIAAS_DATA_DIR: join(directory, "data"),
      VERCEL: "0",
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  await until(async () => {
    try {
      return (await request("/")).ok;
    } catch {
      return false;
    }
  });
}
async function stop() {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
}
try {
  await start();
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    extraHTTPHeaders: { "x-siaas-desktop-key": key },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("heading", { name: "Templates." }).waitFor();
  const templates = await api("/api/templates");
  const expected = [
    [
      "computer-science-study",
      "Computer Science Study",
      "rgb(233, 240, 250)",
      "rgb(28, 65, 108)",
      "#E9F0FA",
    ],
    [
      "production-planning",
      "Production Planning",
      "rgb(233, 237, 241)",
      "rgb(52, 68, 83)",
      "#E9EDF1",
    ],
    [
      "personal-finance",
      "Personal Finance",
      "rgb(229, 247, 238)",
      "rgb(23, 75, 53)",
      "#E5F7EE",
    ],
  ];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const [key, name, background, foreground, original] of expected) {
      const card = page
        .locator("article")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
      const colors = await card.evaluate((element) => ({
        background: getComputedStyle(element).backgroundColor,
        text: getComputedStyle(element).color,
        label: getComputedStyle(element.querySelector(".eyebrow")).color,
        muted: getComputedStyle(element.querySelector(".muted")).color,
      }));
      assert.deepEqual(colors, {
        background,
        text: foreground,
        label: foreground,
        muted: foreground,
      });
      assert(
        await card
          .getByRole("button", { name: "Use template", exact: true })
          .isEnabled(),
      );
      const template = templates.find((item) => item.builtin_key === key);
      const bundle = await api(
        "/api/templates/" + encodeURIComponent(template.id),
      );
      assert.equal(bundle.project.color, original);
    }
  }
  for (const [key, , , , color] of expected) {
    const project = await api("/api/projects", "POST", { template_id: key });
    assert.equal(project.color, color);
  }
  const finance = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Personal Finance", exact: true }),
  });
  await finance
    .getByRole("button", { name: "Use template", exact: true })
    .click();
  assert.match(
    await page.locator('select[name="template_id"]').inputValue(),
    /personal-finance/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: rendered Sky/Slate/Mint backgrounds, text and secondary labels at desktop/mobile widths; aligned exports, instantiated project colors and Use template selection.",
  );
} finally {
  await browser?.close();
  await stop();
  ollama.closeAllConnections();
  await new Promise((resolve) => ollama.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
