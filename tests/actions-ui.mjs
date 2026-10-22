// Actual Electron application + production server + SQLite, with mock local Ollama.
// Run after npm run desktop:build. Set SIAAS_HEADLESS=1 on a headless host.
import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const profile = await mkdtemp(join(tmpdir(), "siaas-actions-ui-"));
const errors = [],
  calls = [];
let connected = true,
  installed = true;
let revision = 1,
  app;
const markdown = () =>
  `# UI summary\n\n## Purpose\nSummarize the user's notes.\n\n## Instructions\n1. Read the available notes.\n2. Include important facts with source citations.\n3. Include UI_REVISION_${revision}.\n\n## Expected Output\nProvide a clear summary in chat.\n\n## Constraints\nUse only available evidence. Ask the user when information is missing.`;
const ollama = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  res.setHeader("Content-Type", "application/json");
  if (!connected) {
    res.statusCode = 503;
    return res.end("{}");
  }
  if (req.url === "/api/tags")
    return res.end(
      JSON.stringify({
        models: installed
          ? [
              { name: "test:3b", digest: "a".repeat(64) },
              { name: "test:8b", digest: "b".repeat(64) },
            ]
          : [],
      }),
    );
  if (req.url === "/api/show")
    return res.end(
      JSON.stringify({
        capabilities: ["completion"],
        model_info: { "general.parameter_count": 3e9 },
      }),
    );
  if (req.url === "/api/chat") {
    calls.push(body);
    if (body.format) {
      const content = body.format.properties.scope
        ? { scope: "action" }
        : body.format.properties.english
          ? { english: true, compatible: true, withinScope: true }
          : {
              reply: "Review this draft before saving.",
              markdown: markdown(),
              language: "en",
            };
      return res.end(
        JSON.stringify({
          done: true,
          message: { content: JSON.stringify(content) },
        }),
      );
    }
    res.setHeader("Content-Type", "application/x-ndjson");
    return res.end(
      JSON.stringify({
        done: true,
        message: { role: "assistant", content: "Fixture chat result." },
      }) + "\n",
    );
  }
  return res.end("{}");
});
await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
try {
  app = await electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32"
        ? "electron.exe"
        : process.platform === "darwin"
          ? "Electron.app/Contents/MacOS/Electron"
          : "electron",
    ),
    args: [
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      ...(process.env.SIAAS_HEADLESS === "1"
        ? ["--ozone-platform=headless", "--disable-gpu"]
        : []),
      `--user-data-dir=${profile}`,
      resolve("desktop/main.cjs"),
    ],
    env: {
      ...process.env,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`,
      SIAAS_NODE_EXECUTABLE: process.execPath,
    },
    timeout: 20000,
  });
  const page = await app.firstWindow({ timeout: 20000 });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Your projects." }).waitFor();
  const nav = await page.locator(".sidebar nav > button").allTextContents();
  assert.deepEqual(
    nav.map((s) => s.replace(/\d+/g, "").trim()),
    ["Overview", "Projects", "Actions", "Templates"],
  );
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  const builtins = page.getByRole("region", { name: "Built-in Actions" });
  assert.equal(await builtins.locator("article").count(), 4);
  assert.equal(
    await builtins.getByRole("button", { name: "Delete", exact: true }).count(),
    0,
  );
  assert.equal(
    await builtins
      .getByRole("button", { name: "Edit with AI", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.getByText("Data table", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Add Action", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Actions →" }).waitFor();
  assert.equal(await page.locator("dialog").count(), 0);
  const menu = page.getByRole("button", { name: "Actions menu", exact: true });
  const heading = await page
    .getByRole("heading", { name: "Actions", exact: true })
    .boundingBox();
  const trigger = await menu.boundingBox();
  assert(Math.abs(heading.y - trigger.y) < 40, "menu is adjacent to title");
  await menu.click();
  await page.getByRole("menuitem", { name: "Models", exact: true }).click();
  await page.getByRole("heading", { name: "Models", exact: true }).waitFor();
  assert.match(page.url(), /view=actions-models/);
  await page.getByRole("radio", { name: "test:3b", exact: true }).check();
  await page.getByRole("status").waitFor({ state: "detached" });
  await page.reload();
  await page.getByRole("radio", { name: "test:3b", exact: true }).waitFor();
  assert(
    await page.getByRole("radio", { name: "test:3b", exact: true }).isChecked(),
  );
  await page.getByRole("button", { name: "← Actions", exact: true }).click();
  connected = false;
  await page.getByRole("button", { name: "Add Action", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Actions →" }).waitFor();
  assert.equal(await page.locator("dialog").count(), 0);
  connected = true;
  installed = false;
  await page.getByRole("button", { name: "Add Action", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Actions →" }).waitFor();
  assert.equal(await page.locator("dialog").count(), 0);
  installed = true;
  await page.getByRole("button", { name: "Add Action", exact: true }).click();
  await page.getByLabel("Action name", { exact: true }).fill("report");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "already used" }).waitFor();
  await page.getByLabel("Action name", { exact: true }).fill("UI summary");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Describe or improve your Action")
    .fill("Create an Action to summarize notes");
  await page
    .getByRole("button", { name: "Send to builder", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Markdown preview" })
    .getByText(/UI_REVISION_1/)
    .waitFor();
  assert.equal(await page.locator(".actions-group article").count(), 4);
  await page
    .getByRole("button", { name: "Confirm and save Action", exact: true })
    .click();
  const custom = page.getByRole("region", { name: "My Actions" });
  await custom
    .getByRole("heading", { name: "UI summary", exact: true })
    .waitFor();
  await custom.getByRole("button", { name: "Edit with AI" }).click();
  revision = 2;
  await page
    .getByLabel("Describe or improve your Action")
    .fill("Make the summary more concise");
  await page
    .getByRole("button", { name: "Send to builder", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Markdown preview" })
    .getByText(/UI_REVISION_2/)
    .waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.match(await custom.locator("pre").textContent(), /UI_REVISION_1/);
  await custom.getByRole("button", { name: "Edit with AI" }).click();
  await page
    .getByLabel("Describe or improve your Action")
    .fill("Make the summary more concise");
  await page
    .getByRole("button", { name: "Send to builder", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Markdown preview" })
    .getByText(/UI_REVISION_2/)
    .waitFor();
  await page
    .getByRole("button", { name: "Confirm and save Action", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  assert.match(await custom.locator("pre").textContent(), /UI_REVISION_2/);
  const assistant = await page.evaluate(async () => {
    const post = async (path, body) =>
      (
        await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();
    const project = await post("/api/projects", { name: "UI project" });
    return post("/api/assistants", {
      project_id: project.id,
      name: "UI assistant",
      instructions: "Keep assistant instructions",
      model_id: "ollama/test:3b",
    });
  });
  await page.goto(
    new URL(
      `/?project=${assistant.project_id}&assistant=${assistant.id}`,
      page.url(),
    ).href,
  );
  const shortcuts = page.locator(".shortcut-sidebar");
  await shortcuts
    .getByRole("button", { name: "UI summary", exact: true })
    .waitFor();
  assert.equal(
    await shortcuts.locator("button").first().getAttribute("aria-label"),
    "Data table",
  );
  assert.equal(await shortcuts.locator("hr").count(), 1);
  assert.equal(await shortcuts.locator("button svg.lucide-zap").count(), 5);
  await shortcuts
    .getByRole("button", { name: "Data table", exact: true })
    .click();
  const dataModal = page.locator("dialog[open]");
  await dataModal
    .getByLabel("What would you like in the table?")
    .fill("Name, features, source");
  await dataModal
    .getByRole("button", { name: "Create table", exact: true })
    .click();
  await page.getByText("Fixture chat result.", { exact: true }).waitFor();
  assert(
    calls
      .filter((c) => !c.format)
      .at(-1)
      .messages.at(-1)
      .content.includes("Name, features, source"),
  );
  // Resolve the existing chat textarea without depending on a CSS class name.
  const chatInput = page.locator(".chat-panel textarea");
  await chatInput.fill("Apply the Action to this draft");
  await shortcuts
    .getByRole("button", { name: "UI summary", exact: true })
    .click();
  await page
    .getByText("Fixture chat result.", { exact: true })
    .nth(1)
    .waitFor();
  assert.equal(await chatInput.inputValue(), "");
  assert(
    calls
      .filter((c) => !c.format)
      .at(-1)
      .messages.at(-1)
      .content.includes("UI_REVISION_2"),
  );
  await shortcuts.getByRole("button", { name: "Report", exact: true }).click();
  await page
    .getByText("Fixture chat result.", { exact: true })
    .nth(2)
    .waitFor();
  assert(
    calls
      .filter((c) => !c.format)
      .at(-1)
      .messages.at(-1)
      .content.includes("relevant conversation context"),
  );
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await custom.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await custom.locator("article").count(), 1);
  await custom.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await custom
    .getByText("Create your first Action with the local chatbot.")
    .waitFor();
  await mkdir("test-results/actions", { recursive: true });
  await page.screenshot({
    path: "test-results/actions/actions-electron.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual Electron UI, navigation, built-in protections, guided create/preview/save/edit/cancel/delete, Data Cell modal, divider, unified icons, typed/empty chat invocation (Ollama fixture).",
  );
} finally {
  if (app) await app.close();
  await new Promise((r) => ollama.close(r));
  await rm(profile, { recursive: true, force: true });
}
