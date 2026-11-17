// Reuse the standalone HTTP/SQLite fixture in structured-api.mjs.
// node tests/structured-api.mjs --hybrid [--benchmark] [--ui]
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { cpus, platform, arch } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const amounts = [
  "2.00",
  "2.00",
  "18.50",
  "8.30",
  "12.00",
  "3.40",
  "6.90",
  "31.00",
  "7.25",
  "5.80",
  "22.40",
  "14.95",
  "3.20",
  "11.60",
  "4.70",
  "39.90",
  "1.75",
  "8.00",
  "12.50",
  "3.90",
  "6.50",
  "19.00",
  "1.20",
  "9.90",
];
const budgetQuestion =
  "What is the total budget in budgets.csv? Show the result, currency, and number of rows used in the calculation.";

export async function checkHybridChat({
  api,
  upload,
  origin,
  headers,
  finance,
  production,
  requests,
  directory,
  serverPid,
}) {
  const conversation = async (assistant) =>
    (
      await api(
        "/api/conversations",
        "POST",
        { assistant_id: assistant.id },
        201,
      )
    ).id;
  const id = await conversation(finance);
  const other = await conversation(production);
  for (const file of ["budgets", "duplicates"]) {
    await upload(
      finance.id,
      file + ".csv",
      "csv",
      await readFile("examples/structured-analysis/" + file + ".csv"),
    );
  }
  const csv =
    "id,importo_eur\n" +
    amounts.map((v, i) => i + 1 + "," + v).join("\n") +
    "\n";
  await upload(finance.id, "invoice.csv", "csv", Buffer.from(csv));
  async function chat(question, conversationId = id) {
    // Rate-limited samples are retried outside the timed interval, retaining the production limit.
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = requests();
      const start = performance.now();
      const r = await fetch(origin + "/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ conversation_id: conversationId, question }),
        signal: AbortSignal.timeout(30000),
      });
      const body = await r.text();
      const ms = performance.now() - start;
      if (r.status === 429 && !attempt) {
        await delay(61000);
        continue;
      }
      assert.equal(r.status, 200, body);
      const events = body.trim().split("\n").map(JSON.parse);
      assert.equal(events.at(-1).type, "done", body);
      const count = requests() - before;
      assert.equal(count, 0, "local routes must not even probe Ollama");
      const { messages } = await api("/api/conversations/" + conversationId);
      const message = messages.find((m) => m.id === events.at(-1).id);
      assert.equal(message.status, "complete");
      assert.equal(message.model_id, null);
      assert.equal(message.input_tokens + message.output_tokens, 0);
      assert.equal(
        message.content,
        events
          .filter((e) => e.type === "delta")
          .map((e) => e.text)
          .join(""),
      );
      return { message, ms, count };
    }
  }
  const arithmetic = async () => {
    const sample = await chat("What is 2 + 2?");
    assert.equal(sample.message.execution_path, "arithmetic");
    assert.equal(sample.message.content, "4");
    return sample;
  };
  const invoice = async () => {
    const sample = await chat("total importo_eur in invoice.csv");
    assert.equal(sample.message.execution_path, "structured");
    assert.deepEqual(sample.message.structured_analysis.rows, [
      { total: "256.65", rowsUsed: 24 },
    ]);
    return sample;
  };
  const coldArithmetic = await arithmetic();
  const coldInvoice = await invoice();
  const { message: budget } = await chat(budgetQuestion);
  assert.deepEqual(budget.structured_analysis.rows, [
    { c4: "EUR", total: "35", rowsUsed: 1 },
  ]);
  assert.match(budget.content, /budgets\.csv/);
  assert.doesNotMatch(budget.content, /\x60\x60\x60json/);
  const { message: dups } = await chat("Find duplicates in duplicates.csv");
  assert.equal(dups.structured_analysis.totalRows, 2);
  const { message: amount } = await chat("total Amount in duplicates.csv");
  assert.deepEqual(amount.structured_analysis.rows, [
    { c4: "EUR", total: "25", rowsUsed: 2 },
  ]);
  assert.match(amount.structured_analysis.warnings.join(" "), /duplicate/i);
  for (const [question, conversationId] of [
    [budgetQuestion, other],
    ["total missing in budgets.csv", id],
    ["2 + 2 * 3", id],
    ["1 / 0", id],
  ]) {
    assert.equal(
      (await chat(question, conversationId)).message.structured_analysis,
      undefined,
    );
  }
  console.log(
    "PASS unified chat HTTP, stored replies, exact invoice, RC4 budgets and duplicates, ambiguous input, cross-project denial, no model selected, zero Ollama HTTP requests.",
  );
  if (process.argv.includes("--offline")) {
    const folder = join(directory, "linked-fixtures");
    await mkdir(folder);
    const file = join(folder, "linked.csv");
    await writeFile(file, "Item,Amount\nA,11\nB,5\n");
    const linked = await api("/api/local/knowledge", "POST", {
      action: "connect",
      assistant_id: production.id,
      path: folder,
      recursive: false,
    });
    await api("/api/documents/" + linked.queued[0] + "/process", "POST");
    assert.equal(
      (await chat("total Amount in linked.csv", other)).message
        .structured_analysis.rows[0].total,
      "16",
    );
    await writeFile(file, "Item,Amount\nA,71\nB,5\n");
    const stale = (await chat("total Amount in linked.csv", other)).message;
    assert.equal(stale.structured_analysis, undefined);
    assert.match(stale.content, /changed|unavailable/i);
    console.log(
      "PASS stopped Ollama endpoint and chat-time invalidation of a changed linked CSV",
    );
  }
  if (process.argv.includes("--ui")) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    });
    try {
      const page = await browser.newPage({
        extraHTTPHeaders: {
          "x-siaas-desktop-key": headers["x-siaas-desktop-key"],
        },
      });
      await page.goto(
        origin + "/?project=" + finance.project_id + "&assistant=" + finance.id,
      );
      const input = page.getByPlaceholder("Type a message…");
      await input.fill(budgetQuestion);
      await input.press("Enter");
      const reply = page.locator(".message.assistant").last();
      await reply.getByText("Local response · no model used").waitFor();
      assert.match(await reply.innerText(), /35/);
      assert.match(await reply.innerText(), /EUR/);
      await page.reload();
      await page
        .locator(".message.assistant")
        .last()
        .getByText("Local response · no model used")
        .waitFor();
      console.log(
        "PASS no-model composer, budget via Enter, rendered and reloaded persisted reply",
      );
    } finally {
      await browser.close();
    }
  }
  if (process.argv.includes("--benchmark")) {
    // Linux procfs measures the server process; client and model usage are separate.
    const ticks =
      process.platform === "linux"
        ? Number(execFileSync("getconf", ["CLK_TCK"]))
        : null;
    const usage = async () => {
      if (!ticks) return null;
      const stat = await readFile("/proc/" + serverPid + "/stat", "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const status = await readFile("/proc/" + serverPid + "/status", "utf8");
      return {
        cpuMs: (1000 * (Number(fields[11]) + Number(fields[12]))) / ticks,
        rssKiB: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]),
      };
    };
    const results = {
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0].model,
      warmups: 2,
      samples: 15,
      scenarios: {},
    };
    for (const [name, run, cold] of [
      ["arithmetic", arithmetic, coldArithmetic],
      ["invoice", invoice, coldInvoice],
    ]) {
      await run(); // The first (separately recorded) invocation was warmup one.
      const samples = [];
      for (let i = 0; i < 15; i++) {
        const before = await usage();
        const { ms, message, count } = await run();
        const after = await usage();
        samples.push({
          ms,
          ollamaRequests: count,
          tokens: message.input_tokens + message.output_tokens,
          engineMs: message.structured_analysis?.engineMs ?? null,
          serverCpuMsIncludingHistoryCheck:
            before && after ? after.cpuMs - before.cpuMs : null,
          serverRssKiBAfterHistoryCheck: after?.rssKiB ?? null,
        });
      }
      const times = samples.map((s) => s.ms).sort((a, b) => a - b);
      results.scenarios[name] = {
        correct: 15,
        routedCorrectly: 15,
        firstRequestMs: cold.ms,
        p50: times[7],
        p95: times[14],
        samples,
      };
    }
    await mkdir("test-results/hybrid", { recursive: true });
    await writeFile(
      "test-results/hybrid/http.json",
      JSON.stringify(results, null, 2) + "\n",
    );
    console.log(
      "PASS 15 measured chat requests per scenario",
      Object.entries(results.scenarios).map(([k, v]) => [k, v.p50, v.p95]),
    );
  }
}
