// Opt-in, local-only functional check for Ollama tool-calling agents.
// Synthetic data only. Run: node scripts/test-agent-tool-calling.mjs --model gemma4:e4b-it-q4_K_M --runs 15
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  if (!process.argv[i + 1]) throw new Error("Missing value for " + name);
  return process.argv[i + 1];
}
const model = argValue("--model", "");
if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,120}$/.test(model))
  throw new Error("Supply an installed local model via --model.");
const runs = Number(argValue("--runs", "15"));
const warmups = Number(argValue("--warmups", "2"));
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 30 ||
    !Number.isSafeInteger(warmups) || warmups < 0 || warmups > 5)
  throw new Error("--runs must be 1..30 and --warmups 0..5.");

const localURL = new URL(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
if (localURL.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(localURL.hostname) ||
    localURL.username || localURL.password || localURL.search || localURL.hash ||
    localURL.pathname !== "/")
  throw new Error("OLLAMA_BASE_URL must be a local HTTP origin.");

async function ollama(path, body) {
  const response = await fetch(new URL(path, localURL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(path + " HTTP " + response.status);
  return response.json();
}
const tools = [
  {
    type: "function",
    function: {
      name: "read_budget_rows",
      description: "Read the two synthetic budget rows. Call this before sum_amounts.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "sum_amounts",
      description: "Calculate the total from exactly the Budget values returned by read_budget_rows.",
      parameters: {
        type: "object",
        properties: {
          amounts: { type: "array", items: { type: "integer" } },
        },
        required: ["amounts"],
      },
    },
  },
];
const messagesBase = [
  {
    role: "system",
    content: "You are testing tool calling. Both tools are available. First call read_budget_rows. After receiving its result, call sum_amounts with exactly the Budget values in their original order. After receiving the computed result, respond with only TOTAL=<integer> EUR. Never calculate the sum yourself.",
  },
  {
    role: "user",
    content: "Read the two budget rows, compute their total with the tools and report it.",
  },
];
async function completion(messages) {
  const r = await ollama("/api/chat", {
    model, messages, tools, stream: false, think: false, keep_alive: "5m",
    options: { temperature: 0, num_ctx: 4096, num_predict: 256 },
  });
  if (r.done === false || r.done_reason === "length" || !r.message)
    throw new Error("Ollama returned an incomplete response");
  return r.message;
}
function singleCall(message, expectedName) {
  const calls = message.tool_calls;
  assert.equal(Array.isArray(calls) ? calls.length : 0, 1,
    "Expected exactly one tool call: " + expectedName);
  assert.equal(calls[0].function?.name, expectedName);
  return calls[0].function.arguments;
}
function appendAssistant(messages, message) {
  messages.push({
    role: "assistant",
    content: message.content ?? "",
    tool_calls: message.tool_calls,
  });
}
async function runTrial(index) {
  const start = performance.now();
  const values = [17 + (index * 7) % 29, 53 + (index * 11) % 37];
  const expected = values[0] + values[1];
  const messages = structuredClone(messagesBase);
  const first = await completion(messages);
  singleCall(first, "read_budget_rows");
  appendAssistant(messages, first);
  messages.push({
    role: "tool",
    tool_name: "read_budget_rows",
    content: JSON.stringify({
      source: "Synthetic in-memory data (no local files accessed)",
      rows: [
        { Category: "Food", Budget: values[0], Currency: "EUR" },
        { Category: "Hardware", Budget: values[1], Currency: "EUR" },
      ],
    }),
  });
  const second = await completion(messages);
  const args = singleCall(second, "sum_amounts");
  assert.deepEqual(args?.amounts, values, "Model did not transfer the source values exactly");
  appendAssistant(messages, second);
  const computed = args.amounts.reduce((sum, value) => sum + value, 0);
  assert.equal(computed, expected);
  messages.push({
    role: "tool",
    tool_name: "sum_amounts",
    content: JSON.stringify({ total: computed, currency: "EUR" }),
  });
  const last = await completion(messages);
  assert.equal((last.tool_calls ?? []).length, 0, "Model called an extra tool instead of finishing");
  assert.match(last.content?.trim() ?? "", new RegExp("^TOTAL\\s*=\\s*" + expected + "\\s*EUR\\.?$", "i"),
    "Model did not faithfully report the tool result");
  return { expected, durationMs: Math.round(performance.now() - start) };
}
const show = await ollama("/api/show", { model });
const capabilities = Array.isArray(show.capabilities) ? show.capabilities : [];
if (!capabilities.includes("completion") || !capabilities.includes("tools")) {
  console.warn("WARNING: /api/show does not declare both completion and tools; SIAAS capability policy may not enable agent mode even if this real tool test passes.");
  console.warn("Reported capabilities:", capabilities);
}
const observations = [];
for (let i = -warmups; i < runs; i++) {
  try {
    const result = await runTrial(i + warmups);
    console.log((i < 0 ? "WARMUP" : "RUN " + (i + 1)) + " PASS " + JSON.stringify(result));
    if (i >= 0) observations.push({ success: true, ...result });
  } catch (error) {
    console.error((i < 0 ? "WARMUP" : "RUN " + (i + 1)) + " FAIL " + String(error));
    if (i >= 0) observations.push({ success: false, error: String(error) });
  }
}
const success = observations.filter((entry) => entry.success);
const durations = success.map((entry) => entry.durationMs).sort((a, b) => a - b);
const median = durations.length
  ? durations[Math.floor(durations.length / 2)]
  : null;
console.log("SUMMARY " + JSON.stringify({
  model, completed: success.length, runs, accuracy: success.length + "/" + runs,
  medianDurationMs: median, declaredTools: capabilities.includes("tools"),
}));
if (success.length !== runs) process.exitCode = 1;
