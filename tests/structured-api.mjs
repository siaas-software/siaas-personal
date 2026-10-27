// Real standalone HTTP routes, bundled parser and SQLite; only Ollama is a local fixture.
// Optional --ui requires a runnable Playwright Chromium installation.
// SIAAS_TEST_SERVER_ROOT / SIAAS_TEST_NODE also exercise an unpacked distribution.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
let answerPlan,
  plannerMode = "query",
  plannerRequests = 0;
const ollama = createServer(async (req, res) => {
  let text = "";
  for await (const c of req) text += c;
  const body = text ? JSON.parse(text) : {};
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/tags")
    return res.end(
      JSON.stringify({
        models: [{ name: "qwen2.5:1.5b", digest: "a".repeat(64) }],
      }),
    );
  if (req.url === "/api/show")
    return res.end(JSON.stringify({ capabilities: ["completion"] }));
  if (req.url === "/api/chat" && body.format) {
    plannerRequests++;
    assert(body.messages[0].content.includes("Authoritative catalog"));
    return res.end(
      JSON.stringify({
        message: {
          content:
            plannerMode === "invalid"
              ? "not json"
              : JSON.stringify(
                  plannerMode === "clarify"
                    ? {
                        status: "clarify",
                        message:
                          "This request needs a scheduling optimizer, which is not available.",
                      }
                    : { status: "query", plan: answerPlan },
                ),
        },
      }),
    );
  }
  if (req.url === "/api/chat") {
    const question = body.messages.at(-1)?.content;
    const general = question === "Quanto fa 2 + 2?";
    if (general)
      assert(body.messages[0].content.includes("do not require Knowledge"));
    res.setHeader("Content-Type", "application/x-ndjson");
    return res.end(
      JSON.stringify({
        message: {
          content: general
            ? "4"
            : "The computed result identifies a shortage. See the exact table and source evidence.",
        },
        done: false,
      }) +
        "\n" +
        JSON.stringify({
          message: { content: "" },
          done: true,
          prompt_eval_count: 50,
          eval_count: 15,
        }) +
        "\n",
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
  key = "structured-integration-test-key-0000000000";
const directory = await mkdtemp(join(tmpdir(), "siaas-structured-api-"));
const headers = {
  origin,
  "x-siaas-desktop-key": key,
  "Content-Type": "application/json",
};
let server,
  serverExit,
  browser,
  logs = "";
async function api(path, method = "GET", body, status = 200) {
  const response = await fetch(origin + path, {
    method,
    headers,
    signal: AbortSignal.timeout(60000),
    ...(body === undefined
      ? {}
      : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  assert(
    response.status === status,
    `${method} ${path}: ${response.status} ${text}\n${logs}`,
  );
  return JSON.parse(text);
}
async function upload(assistantId, name, kind, bytes) {
  const doc = await api(
    "/api/documents",
    "POST",
    { assistant_id: assistantId, title: name, kind, byte_size: bytes.length },
    201,
  );
  await api(`/api/local/files/${doc.id}`, "PUT", bytes);
  await api(`/api/documents/${doc.id}/process`, "POST");
  return doc;
}
try {
  const serverRoot = resolve(
    process.env.SIAAS_TEST_SERVER_ROOT || ".next/standalone",
  );
  server = spawn(
    process.env.SIAAS_TEST_NODE
      ? resolve(process.env.SIAAS_TEST_NODE)
      : process.execPath,
    [join(serverRoot, "server.js")],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        SIAAS_RUNTIME: "desktop",
        SIAAS_DESKTOP_DEV: "0",
        SIAAS_DESKTOP_KEY: key,
        SIAAS_DESKTOP_ORIGIN: origin,
        SIAAS_DATA_DIR: directory,
        OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`,
        VERCEL: "0",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (d) => (logs += d));
  serverExit = new Promise((done) => {
    server.once("exit", done);
    server.once("error", (error) => {
      logs += error.message;
      done();
    });
  });
  server.stderr.on("data", (d) => (logs += d));
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(origin, { headers })).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, logs);
  assert.equal(
    (await fetch(origin + "/api/local/structured?assistant=invalid")).status,
    403,
  );
  const projects = [];
  for (const template_id of ["production-planning", "personal-finance"])
    projects.push(await api("/api/projects", "POST", { template_id }, 201));
  const workspace = await api("/api/workspace");
  const production = workspace.assistants.find(
      (a) => a.project_id === projects[0].id,
    ),
    finance = workspace.assistants.find((a) => a.project_id === projects[1].id);
  assert(production && finance);
  assert.equal(production.model_id, null);
  assert.equal(finance.model_id, null);
  assert.equal(workspace.aiReady, false);
  const ordersDoc = await upload(
    production.id,
    "orders.csv",
    "csv",
    Buffer.from(
      "Product,Quantity,Note\nA,10,PRIVATE_RAW_CELL\nA,5,other\nUNKNOWN,1,missing",
    ),
  );
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Stock").addRows([
    ["Product", "Available"],
    ["A", 12],
    ["B", 6],
  ]);
  wb.addWorksheet("BOM").addRows([
    ["Product", "Material", "Required"],
    ["A", "M", 2],
  ]);
  await upload(
    production.id,
    "operations.xlsx",
    "xlsx",
    Buffer.from(await wb.xlsx.writeBuffer()),
  );
  let inspection = await api(
    `/api/local/structured?assistant=${production.id}`,
  );
  assert.equal(inspection.datasets.length, 3);
  for (const d of inspection.datasets)
    assert.equal(
      d.mapping.confirmed,
      true,
      "ordinary worksheets must be ready without mapping confirmation",
    );
  inspection = await api(`/api/local/structured?assistant=${production.id}`);
  const orders = inspection.datasets.find((d) => d.filename === "orders.csv"),
    stock = inspection.datasets.find((d) => d.worksheet === "Stock");
  const rel = await api("/api/local/structured", "POST", {
    assistantId: production.id,
    action: "relationship",
    value: {
      leftDataset: orders.id,
      leftColumn: "c1",
      rightDataset: stock.id,
      rightColumn: "c1",
      cardinality: "many-to-one",
    },
  });
  assert.equal(rel.unmatchedLeftRows, 1);
  answerPlan = {
    stages: [
      { id: "stock", datasetId: stock.id, steps: [] },
      {
        id: "orders",
        datasetId: orders.id,
        steps: [
          {
            op: "group",
            by: ["c1"],
            aggregates: [{ as: "ordered", fn: "sum", column: "c2" }],
          },
          { op: "join", right: "stock", relationshipId: rel.id, kind: "left" },
          {
            op: "derive",
            as: "shortage",
            operator: "subtract",
            left: { column: "ordered" },
            right: { column: "stock.c2" },
          },
        ],
      },
    ],
    output: "orders",
    limit: 100,
  };
  const result = await api("/api/local/structured", "POST", {
    assistantId: production.id,
    action: "query",
    value: answerPlan,
  });
  assert.equal(result.rows[0].shortage, "3");
  assert.equal(result.rows[1].shortage, null);
  assert.equal(result.evidence.length, 2);
  await api(
    "/api/local/structured",
    "POST",
    { assistantId: finance.id, action: "query", value: answerPlan },
    422,
  );
  await api(
    "/api/local/structured",
    "POST",
    {
      assistantId: production.id,
      action: "query",
      value: { sql: "DROP TABLE documents" },
    },
    400,
  );
  const denied = await fetch(origin + "/api/local/structured", {
    method: "POST",
    headers: { ...headers, origin: "https://example.com" },
    body: JSON.stringify({
      assistantId: production.id,
      action: "query",
      value: answerPlan,
    }),
  });
  assert.equal(denied.status, 403);
  const transactions = await upload(
    finance.id,
    "transactions.csv",
    "csv",
    Buffer.from(
      "Date,Type,Amount,Currency\n2026-10-01,income,1000,EUR\n2026-10-02,expense,10.10,EUR\n2026-10-03,expense,20.20,EUR\n2026-10-04,expense,40,USD",
    ),
  );
  const fd = (await api(`/api/local/structured?assistant=${finance.id}`))
    .datasets[0];
  await api(
    "/api/local/structured",
    "POST",
    {
      assistantId: finance.id,
      action: "mapping",
      id: fd.id,
      value: { ...fd.mapping, confirmed: true, partitionColumns: [] },
    },
    422,
  );
  assert.equal(fd.mapping.confirmed, true);
  assert.deepEqual(fd.mapping.partitionColumns, ["c4"]);
  const financial = await api("/api/local/structured", "POST", {
    assistantId: finance.id,
    action: "query",
    value: {
      stages: [
        {
          id: "money",
          datasetId: fd.id,
          steps: [
            {
              op: "filter",
              column: "c2",
              comparison: "eq",
              value: { value: "expense" },
            },
            {
              op: "group",
              by: ["c4"],
              aggregates: [{ as: "spending", fn: "sum", column: "c3" }],
            },
          ],
        },
      ],
      output: "money",
    },
  });
  assert.deepEqual(financial.rows, [
    { c4: "EUR", spending: "30.3" },
    { c4: "USD", spending: "40" },
  ]);
  await api(`/api/assistants/${production.id}`, "PATCH", {
    name: production.name,
    description: production.description,
    instructions: production.instructions,
    model_id: "ollama/qwen2.5:1.5b",
  });
  const conversation = await api(
    "/api/conversations",
    "POST",
    { assistant_id: production.id },
    201,
  );
  async function chat(question) {
    const response = await fetch(origin + "/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ conversation_id: conversation.id, question }),
    });
    assert(response.ok);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert(!events.some((e) => e.type === "error"), JSON.stringify(events));
    return events;
  }
  const events = await chat(
    "Compare sales orders with inventory and show shortages.",
  );
  assert(events.some((e) => e.type === "artifacts"));
  assert(
    events
      .filter((e) => e.type === "delta")
      .map((e) => e.text)
      .join("")
      .includes("Sources and applied operations"),
  );
  const history = await api(`/api/conversations/${conversation.id}`);
  const message = history.messages.find((m) => m.role === "assistant");
  assert.equal(message.structured_analysis.rows[0].shortage, "3");
  assert.equal(message.status, "complete");
  assert(message.artifacts[0].content.includes("orders.csv"));
  assert.equal(plannerRequests, 1);
  const generalEvents = await chat("Quanto fa 2 + 2?");
  assert.equal(
    generalEvents
      .filter((e) => e.type === "delta")
      .map((e) => e.text)
      .join(""),
    "4",
  );
  assert.equal(
    plannerRequests,
    1,
    "general arithmetic must bypass structured planner",
  );
  plannerMode = "invalid";
  const invalid = await chat("Calculate again");
  assert(
    invalid
      .filter((e) => e.type === "delta")
      .map((e) => e.text)
      .join("")
      .includes("invalid plan"),
  );
  plannerMode = "clarify";
  const unsupported = await chat("Find the optimal production schedule");
  assert(
    unsupported
      .filter((e) => e.type === "delta")
      .map((e) => e.text)
      .join("")
      .includes("No calculation was executed"),
  );
  const exported = await api(
    `/api/projects/${projects[1].id}/template`,
    "POST",
    { name: "Finance reusable" },
    201,
  );
  assert(!JSON.stringify(exported).includes("transactions.csv"));
  if (process.argv.includes("--ui")) {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    const page = await browser.newPage({
        extraHTTPHeaders: { "x-siaas-desktop-key": key },
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.getByRole("heading", { name: "Your projects." }).waitFor();
    await page
      .locator(".resource-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Production Planning",
          exact: true,
        }),
      })
      .locator("button")
      .first()
      .click();
    await page
      .locator(".resource-card")
      .filter({
        has: page.getByRole("heading", { name: production.name, exact: true }),
      })
      .locator(".assistant-card")
      .click();
    await page
      .getByRole("heading", { name: "Structured Data Analysis", exact: true })
      .waitFor();
    await page.getByText("Advanced Settings", { exact: true }).click();
    await page.locator(".structured-dataset summary").first().click();
    await page
      .getByRole("button", { name: "Confirm mapping", exact: true })
      .first()
      .waitFor();
    await mkdir("test-results/structured", { recursive: true });
    await page.screenshot({
      path: "test-results/structured/knowledge.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
  }
  await api(`/api/documents/${transactions.id}?deleteCopy=true`, "DELETE");
  assert.equal(
    (await api(`/api/local/structured?assistant=${finance.id}`)).datasets
      .length,
    0,
  );
  await api(`/api/documents/${ordersDoc.id}?deleteCopy=true`, "DELETE");
  assert.equal(
    (await api(`/api/local/structured?assistant=${production.id}`))
      .relationships.length,
    0,
  );
  console.log(
    "PASS: standalone parser; XLSX/CSV without embeddings/Docker/Python; three-template catalog and both project creations; confirmed mappings and joins; exact shortage and multi-currency results; isolation and Origin guards; mocked Ollama JSON fallback, invalid plan and unsupported-request handling; persisted chat evidence/report; deletion.",
  );
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill();
    await serverExit;
  }
  await new Promise((r) => ollama.close(r));
  await mkdir("test-results/structured", { recursive: true });
  await writeFile("test-results/structured/server.log", logs);
  await rm(directory, { recursive: true, force: true });
}
