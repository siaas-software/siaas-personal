// Run after npm run desktop:build. Only temporary server/profile data is used.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import vm from "node:vm";
import packaging from "../electron-builder.cjs";

const files = [
  "THIRD_PARTY_NOTICES.md",
  "LICENSE",
  "services/laya/LICENSE",
  "services/morphic/LICENSE",
  "services/morphic/NOTICE",
];
for (const file of files) {
  assert.equal(
    await readFile(join(".next/standalone", file), "utf8"),
    await readFile(file, "utf8"),
    `Standalone includes ${file}`,
  );
  assert(packaging.files.includes(file), `Electron asar includes ${file}`);
  const prepare = await readFile("scripts/prepare-package.mjs", "utf8");
  assert(
    prepare.includes(`await cp("${file}", ".desktop/app/${file}")`),
    `Packaging copies ${file}`,
  );
}

// Exercise the existing Electron navigation handlers without opening a real browser.
const main = await readFile("desktop/main.cjs", "utf8");
const handlers = {},
  opened = [];
vm.runInNewContext(
  main.slice(
    main.indexOf("  const allowed = new Set("),
    main.indexOf("  ollama = new OllamaManager("),
  ),
  {
    URL,
    origin: "http://127.0.0.1:12345",
    shell: { openExternal: (url) => opened.push(url) },
    win: {
      webContents: {
        setWindowOpenHandler: (fn) => (handlers.popup = fn),
        on: (event, fn) => (handlers[event] = fn),
      },
    },
  },
);
for (const url of [
  "https://github.com/siaas-software/siaas-personal",
  "https://github.com/NandhaKishorM/laya",
  "https://github.com/miurla/morphic",
]) {
  assert.equal(handlers.popup({ url }).action, "deny");
  assert.equal(opened.at(-1), url);
}
for (const url of [
  "file:///tmp/secret",
  "javascript:alert(1)",
  "http://github.com/miurla/morphic",
  "https://github.com.evil.test/",
  "invalid",
])
  handlers.popup({ url });
assert.equal(opened.length, 3, "Unsafe URLs must not reach shell.openExternal");
let prevented = false;
handlers["will-navigate"](
  {
    preventDefault() {
      prevented = true;
    },
  },
  "https://github.com/miurla/morphic",
);
assert(prevented, "External navigation cannot replace the app");

const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  key = "offline-license-test-".repeat(4);
const dir = await mkdtemp(join(tmpdir(), "siaas-licenses-"));
let logs = "";
let browser;
const server = spawn(
  process.execPath,
  [resolve(".next/standalone/server.js")],
  {
    cwd: resolve(".next/standalone"),
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      VERCEL: "0",
      SIAAS_RUNTIME: "desktop",
      SIAAS_DESKTOP_ORIGIN: origin,
      SIAAS_DESKTOP_KEY: key,
      SIAAS_DATA_DIR: dir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (data) => (logs += data));
server.stderr.on("data", (data) => (logs += data));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(origin);
      ready = true;
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, logs);
  assert.equal((await fetch(`${origin}/api/licenses`)).status, 403);
  const headers = { "x-siaas-desktop-key": key };
  const response = await fetch(`${origin}/api/licenses`, { headers });
  assert.equal(response.status, 200, logs);
  const documents = await response.json();
  assert.equal(documents.length, files.length);
  for (const [index, file] of files.entries())
    assert.equal(documents[index].content, await readFile(file, "utf8"));
  const page = await (await fetch(origin, { headers })).text();
  assert(page.includes("SIAAS"));
  if (process.argv.includes("--ui")) {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH,
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
      extraHTTPHeaders: headers,
      viewport: { width: 1440, height: 1000 },
    });
    // No Internet: allow only the compiled local application.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("heading", { name: "About", exact: true }).waitFor();
    const open = page.getByRole("button", {
      name: "View Third-Party Notices",
      exact: true,
    });
    await open.click();
    const reader = page.getByRole("dialog", { name: "Licenses & Notices" });
    await reader.waitFor();
    await reader
      .locator("pre")
      .filter({ hasText: "# Third-party notices" })
      .waitFor();
    const ids = ["notices", "siaas", "laya", "morphic", "morphic-notice"];
    for (const [index, id] of ids.entries()) {
      await reader.getByLabel("Document", { exact: true }).selectOption(id);
      assert.equal(
        await reader.locator("pre").textContent(),
        documents[index].content,
      );
    }
    await page.keyboard.press("Escape");
    await reader.waitFor({ state: "hidden" });
    assert(
      await open.evaluate((element) => document.activeElement === element),
      "Closing restores focus",
    );
    await page
      .getByRole("button", {
        name: "View License — SIAAS Personal",
        exact: true,
      })
      .click();
    await reader.locator("pre").filter({ hasText: "MIT License" }).waitFor();
    await reader.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await open.click();
    assert(
      await reader.evaluate(
        (element) => element.getBoundingClientRect().right <= innerWidth,
      ),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.keyboard.press("Escape");
    await page.goto(`${origin}/?lang=it`);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("heading", { name: "Informazioni", exact: true })
      .waitFor();
    await page
      .getByRole("button", {
        name: "Visualizza avvisi di terze parti",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .locator("pre")
      .filter({ hasText: "# Third-party notices" })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: Settings navigation, offline viewer, five documents, Escape/focus, mobile layout and Italian UI.",
    );
  }
  console.log(
    "PASS: standalone offline license API returns all original texts; desktop auth; traced files; packaging configuration; safe Electron external navigation.",
  );
} finally {
  if (browser) await browser.close();
  server.kill();
  await new Promise((r) => server.once("exit", r));
  await rm(dir, { recursive: true, force: true });
}
