// Acceptance test against the real standalone desktop HTTP server and SQLite.
// Only Ollama model discovery is simulated; no personal data or installed app is used.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
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
  expected.push(
    [
      "construction-cost-analysis",
      "Construction Cost Analysis",
      "rgb(252, 237, 228)",
      "rgb(117, 64, 41)",
      "#FCEDE4",
    ],
    [
      "technical-documentation",
      "Technical Documentation",
      "rgb(240, 234, 254)",
      "rgb(75, 50, 124)",
      "#F0EAFE",
    ],
    [
      "materials-procurement",
      "Materials & Procurement",
      "rgb(225, 245, 244)",
      "rgb(25, 88, 91)",
      "#E1F5F4",
    ],
  );
  assert.equal(templates.length, 6);
  const contrast = (a, b) => {
    const luminance = (color) => {
      const [r, g, b] = color
        .match(/\d+/g)
        .slice(0, 3)
        .map(Number)
        .map((n) => {
          const v = n / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
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
        description: getComputedStyle(element.querySelector("p")).color,
      }));
      assert.deepEqual(colors, {
        background,
        text: foreground,
        label: foreground,
        muted: foreground,
        description: foreground,
      });
      assert(
        await card
          .getByRole("button", { name: "Use template", exact: true })
          .isEnabled(),
      );
      for (const text of [
        colors.text,
        colors.label,
        colors.muted,
        colors.description,
      ])
        assert(
          contrast(background, text) >= 4.5,
          `${key}: normal/secondary text`,
        );
      for (const button of await card.locator(".button").all()) {
        for (const state of ["normal", "hover", "focus"]) {
          await page.mouse.move(0, 0);
          await button.evaluate((el) => el.blur());
          if (state === "hover") await button.hover();
          if (state === "focus") {
            await page.keyboard.press("Tab");
            await button.focus();
          }
          await page.waitForTimeout(180);
          const actual = await button.evaluate((el) => {
            const css = getComputedStyle(el);
            return {
              text: css.color,
              background: css.backgroundColor,
              border: css.borderColor,
              outline: css.outlineColor,
              outlineStyle: css.outlineStyle,
            };
          });
          const buttonBackground =
            actual.background === "rgba(0, 0, 0, 0)"
              ? background
              : actual.background;
          assert(
            contrast(buttonBackground, actual.text) >= 4.5,
            `${key}: ${state} button text`,
          );
          assert(
            contrast(background, actual.border) >= 3,
            `${key}: ${state} border`,
          );
          if (state === "focus") {
            assert.notEqual(
              actual.outlineStyle,
              "none",
              `${key}: visible keyboard focus`,
            );
            assert(
              contrast(background, actual.outline) >= 3,
              `${key}: focus outline`,
            );
          }
        }
      }
      const template = templates.find((item) => item.builtin_key === key);
      const bundle = await api(
        "/api/templates/" + encodeURIComponent(template.id),
      );
      assert.equal(bundle.project.color, original);
      assert.equal(bundle.project.palette, template.palette);
      await card
        .getByRole("button", { name: "Use template", exact: true })
        .click();
      const preview = page.getByRole("region", { name: "Template preview" });
      assert.deepEqual(
        await preview.evaluate((el) => ({
          background: getComputedStyle(el).backgroundColor,
          text: getComputedStyle(el).color,
        })),
        { background, text: foreground },
      );
      for (const paragraph of await preview.locator("p").all()) {
        const text = await paragraph.evaluate(
          (el) => getComputedStyle(el).color,
        );
        assert.equal(text, foreground);
        assert(contrast(background, text) >= 4.5);
      }
      assert.equal(
        await page.locator('select[name="template_id"]').inputValue(),
        template.id,
      );
      if (process.env.TEST_ARTIFACT_DIR) {
        await mkdir(process.env.TEST_ARTIFACT_DIR, { recursive: true });
        await page.screenshot({
          path: join(process.env.TEST_ARTIFACT_DIR, `${key}-${width}.png`),
          fullPage: true,
        });
      }
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  }
  // Create each project through the actual modal, then inspect HTTP/SQLite results.
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const [key, name, background, foreground, color] of expected) {
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    const card = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card
      .getByRole("button", { name: "Use template", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await until(async () =>
      (await api("/api/workspace")).projects.some((p) => p.name === name),
    );
    const project = (await api("/api/workspace")).projects.find(
      (p) => p.name === name,
    );
    assert.equal(project.color, color);
    await page.locator("main.project-detail").waitFor();
    await until(
      async () =>
        (await page
          .locator("main.project-detail")
          .evaluate((el) => getComputedStyle(el).backgroundColor)) ===
        background,
    );
    const title = page.locator("main.project-detail h1");
    assert.equal(
      await title.evaluate((el) => getComputedStyle(el).color),
      foreground,
    );
    const exported = await api(`/api/project/export?project=${project.id}`);
    assert.equal(exported.project.color, color);
  }
  const customProject = (await api("/api/workspace")).projects[0];
  await api(`/api/projects/${customProject.id}`, "PATCH", {
    name: customProject.name,
    color: "#123456",
  });
  const beforeRestart = (await api("/api/workspace")).projects;
  await stop();
  await start();
  assert.deepEqual((await api("/api/workspace")).projects, beforeRestart);
  assert.deepEqual(await api("/api/templates"), templates);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: all six cards/previews, normal/hover/focus contrast at 1440/390px, browser project creation, template/project exports and HTTP/SQLite restart persistence.",
  );
} finally {
  await browser?.close();
  await stop();
  ollama.closeAllConnections();
  await new Promise((resolve) => ollama.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
