// Real Electron + SQLite + Ollama test. Requires two models and a graphical session.
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const profile = await mkdtemp(join(tmpdir(), "siaas-desktop-e2e-"));
const out = resolve("test-results/desktop");
await mkdir(out, { recursive: true });
const errors = [];
let app;
async function launch() {
  app = await electron.launch({
    executablePath: require("electron"),
    args: [
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      resolve("desktop/main.cjs"),
    ],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: profile,
      SIAAS_NODE_EXECUTABLE: process.execPath,
    },
    timeout: 60000,
  });
  const page = await app.firstWindow({ timeout: 60000 });
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(30000);
  await page.getByRole("heading", { name: "Your projects." }).waitFor();
  return page;
}
try {
  let page = await launch();
  const origin = new URL(page.url()).origin;
  assert.equal(
    (await fetch(origin + "/api/workspace")).status,
    403,
    "Local API must reject unrelated clients",
  );
  assert.equal(await page.locator("input[type=password]").count(), 0);
  assert.equal(await page.getByRole("tab", { name: /Preventivo/ }).count(), 0);
  await page.getByRole("button", { name: "Modelli", exact: true }).click();
  await page.getByText("Ollama connected", { exact: true }).waitFor();
  await page.getByText(/RAM libera al rilevamento/).waitFor();
  await page.screenshot({ path: join(out, "hardware.png"), fullPage: true });
  await page.getByRole("button", { name: /^Assistants/ }).click();
  await page
    .getByRole("button", { name: "New assistant", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Assistant name", { exact: true })
    .fill("Collaudo local");
  await page
    .locator("textarea[name=instructions]")
    .fill("Rispondi in italiano, brevemente, citando la fonte [1].");
  await page
    .getByRole("button", { name: "Create assistant", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use for assistant", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Back to knowledge and chat", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add text", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Orario officina");
  await page
    .getByLabel("Content", { exact: true })
    .fill(
      "L’officina SIAAS Personal apre alle ore 09:17 il martedì. Il codice interno per prenotare assistenza è ZAFFIRO-482. Il servizio di assistenza risponde entro due giorni lavorativi.",
    );
  await page
    .getByRole("button", { name: "Add to knowledge" })
    .click();
  await page.getByText("Ready", { exact: true }).waitFor({ timeout: 180000 });
  console.log("Real embeddings prepared from UI");
  await page.getByRole("tab", { name: "Chat di prova" }).click();
  await page
    .getByLabel("Your question")
    .fill(
      "A che ora apre l’officina il martedì e qual è il codice di prenotazione?",
    );
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByText(/Generation local completata/)
    .waitFor({ timeout: 240000 });
  const body = await page.locator("main").innerText();
  assert(body.includes("09:17"), body);
  assert(body.includes("ZAFFIRO-482"), body);
  await page
    .getByRole("button", { name: "[1] Orario officina", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({ path: join(out, "rag-real.png"), fullPage: true });
  console.log("Real model answered with document facts and a source");
  // Upload original bytes through the same renderer route; verify storage and extraction.
  await page.getByRole("tab", { name: "Base di conoscenza" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "seconda-fonte.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "La manutenzione del dispositivo SIAAS Personal richiede un controllo ogni 500 ore di utilizzo.",
    ),
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".status.ready").length >= 2,
    undefined,
    { timeout: 180000 },
  );
  await page.getByText("seconda-fonte.txt", { exact: true }).waitFor();
  const runtime = await page.evaluate(async () =>
    (await fetch("/api/workspace")).json(),
  );
  assert.equal(runtime.desktop, true);
  const docs = await page.evaluate(
    async (id) => (await fetch("/api/documents?assistant=" + id)).json(),
    runtime.assistants[0].id,
  );
  assert.equal(docs.length, 2);
  const f = docs.find((d) => d.kind === "txt");
  assert.equal(f.status, "ready");
  const downloaded = await page.evaluate(
    async (id) => (await fetch("/api/local/files/" + id)).text(),
    f.id,
  );
  assert(downloaded.includes("500 ore"));
  const conversationUrl = await page.evaluate(async (id) => {
    const c = await (await fetch("/api/conversations?assistant=" + id)).json();
    return `/?assistant=${id}&conversation=${c[0].id}`;
  }, runtime.assistants[0].id);
  await page
    .getByRole("link", { name: "External provider · Coming soon" })
    .click();
  await page
    .getByRole("heading", { name: "RAG preparation estimate" })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: /paga|avvia/i }).count(),
    0,
  );
  console.log("Local files and external handoff verified");
  await app.close();
  app = null;
  page = await launch();
  await page.goto(new URL(conversationUrl, page.url()).href);
  await page.getByText(/Generation local completata/).waitFor();
  assert((await page.locator("main").innerText()).includes("ZAFFIRO-482"));
  assert.deepEqual(errors, []);
  console.log("Restart persistence verified; no renderer errors");
} catch (error) {
  if (app) {
    const page = app.windows()[0];
    if (page) {
      await page
        .screenshot({ path: join(out, "failure.png"), fullPage: true })
        .catch(() => {});
      console.error((await page.locator("body").innerText()).slice(-4000));
    }
  }
  throw error;
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}
