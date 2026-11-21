// Compiled app + real SQLite, actual missing Docker and unreachable Ollama.
// No fake Docker executable, fetch override or model/service fixture is used.
// Run after desktop:build on a host without Docker; never report a skipped run as PASS.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectDocker } from "../scripts/docker-prerequisites.mjs";
import { LocalDatabase } from "../src/lib/local/database.ts";

const docker = await inspectDocker();
assert.equal(
  docker.reason,
  "not_installed",
  "This suite requires a host without Docker; an unavailable prerequisite is not a passing test.",
);
const directory = await mkdtemp(join(tmpdir(), "siaas-missing-docker-"));
const data = join(directory, "data"),
  home = join(directory, "home");
await mkdir(home);
// Reserve a closed port as the unavailable Ollama target; never contact a user's model.
const reservePort = async () => {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
};
const port = await reservePort(),
  ollamaPort = await reservePort();
const origin = `http://127.0.0.1:${port}`,
  key = randomBytes(32).toString("hex");
const headers = {
  origin,
  "x-siaas-desktop-key": key,
  "Content-Type": "application/json",
};
let child,
  logs = "";
async function request(
  path,
  body,
  method = body === undefined ? "GET" : "POST",
) {
  return fetch(origin + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
}
async function api(path, body, method) {
  const response = await request(path, body, method);
  const value = await response.json();
  assert(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
async function start() {
  child = spawn(process.execPath, [resolve(".next/standalone/server.js")], {
    cwd: resolve(".next/standalone"),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SIAAS_DATA_DIR: data,
      SIAAS_RUNTIME: "desktop",
      SIAAS_DESKTOP_DEV: "0",
      VERCEL: "0",
      NODE_ENV: "production",
      SIAAS_DESKTOP_KEY: key,
      SIAAS_DESKTOP_ORIGIN: origin,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaPort}`,
      SIAAS_RESEARCH_TOKEN: "",
      SIAAS_LAYA_URL: "http://127.0.0.1:7821",
      SIAAS_MORPHIC_URL: "http://127.0.0.1:7822",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => {
    logs += d;
  });
  child.stderr.on("data", (d) => {
    logs += d;
  });
  for (let n = 0; n < 100; n++) {
    assert.equal(child.exitCode, null, logs);
    try {
      if ((await request("/api/workspace")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`Compiled app failed to start: ${logs}`);
}
async function stop() {
  if (child?.exitCode === null) {
    const exit = once(child, "exit");
    child.kill();
    await exit;
  }
}
try {
  await start();
  const project = await api("/api/projects", {
    name: "Real missing-prerequisite test",
  });
  const unavailable = await request("/api/assistants", {
    project_id: project.id,
    name: "Offline model selection",
    model_id: "ollama/test:8b",
  });
  assert.equal(unavailable.status, 503);
  assert.match(JSON.stringify(await unavailable.json()), /Ollama/);
  const assistant = await api("/api/assistants", {
    project_id: project.id,
    name: "Offline",
    model_id: null,
  });
  // Represent an existing assistant whose previously selected model is now offline.
  const db = new LocalDatabase(data);
  try {
    db.put(
      "assistants",
      { ...db.get("assistants", assistant.id), model_id: "ollama/test:8b" },
      true,
    );
  } finally {
    db.close();
  }
  const document = await api("/api/documents", {
    assistant_id: assistant.id,
    title: "Preserved note",
    kind: "text",
    text: "The maintenance interval is 500 hours.",
  });
  const conversation = await api("/api/conversations", {
    assistant_id: assistant.id,
  });
  const state = await api("/api/local/experimental");
  assert.equal(state.docker.reason, "not_installed");
  for (const feature of ["advancedReasoning", "advancedWebResearch"]) {
    const response = await request(
      "/api/local/experimental",
      { feature, enabled: true },
      "PATCH",
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "not_installed");
  }
  const chat = await request("/api/chat", {
    conversation_id: conversation.id,
    question: "hello",
  });
  // HTTP 200 starts the NDJSON transport; the terminal event, not HTTP alone,
  // determines whether execution succeeded. An unavailable model must not emit
  // deltas, sources, artifacts or a successful completion.
  assert.equal(chat.status, 200);
  assert.match(chat.headers.get("content-type"), /application\/x-ndjson/);
  const events = (await chat.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type), ["error"]);
  assert.match(events[0].error, /Ollama.*unreachable/i);
  const failedMessages = (await api(`/api/conversations/${conversation.id}`)).messages;
  assert.equal(failedMessages.length, 2);
  assert.equal(failedMessages[0].role, "user");
  assert.equal(failedMessages[0].content, "hello");
  const failed = failedMessages[1];
  assert.equal(failed.role, "assistant");
  assert.equal(failed.status, "error");
  assert.equal(failed.content, events[0].error);
  assert.deepEqual(failed.sources, []);
  assert.equal(failed.input_tokens, 0);
  assert.equal(failed.output_tokens, 0);
  assert.equal(failed.structured_analysis ?? null, null);
  assert.deepEqual(failed.artifacts ?? [], []);

  // Check both inline text and actual uploaded TXT bytes through production
  // preparation/extraction, with neither embeddings nor a running model.
  const txtBytes = Buffer.from("The maintenance checklist requires a filter inspection.");
  const txt = await api("/api/documents", {
    assistant_id: assistant.id,
    title: "maintenance.txt",
    kind: "txt",
    byte_size: txtBytes.length,
  });
  const upload = await fetch(origin + `/api/local/files/${txt.id}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/octet-stream" },
    body: txtBytes,
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(upload.status, 200);
  for (const source of [document, txt]) {
    const processing = await request(`/api/documents/${source.id}/process`, {});
    assert.equal(processing.status, 200);
    const prepared = await processing.json();
    assert.equal(prepared.ok, true);
    assert(prepared.chunks > 0);
    assert.equal((await api(`/api/documents/${source.id}/process`, {})).ok, true);
  }
  const preparedDocuments = await api(`/api/documents?assistant=${assistant.id}`);
  for (const source of [document, txt]) {
    const prepared = preparedDocuments.find((d) => d.id === source.id);
    assert.equal(prepared.status, "ready");
    assert.equal(prepared.embedding_model, "lexical-v1");
    assert(prepared.chunk_count > 0);
  }
  const evidenceDb = new LocalDatabase(data);
  try {
    const chunks = evidenceDb.rows("document_chunks").filter((c) => [document.id, txt.id].includes(c.document_id));
    assert(chunks.length >= 2);
    assert(chunks.every((c) => c.embedding == null));
    assert(chunks.some((c) => c.document_id === txt.id && c.content === txtBytes.toString()));
  } finally {
    evidenceDb.close();
  }
  async function offlineTurn(question) {
    const response = await request("/api/chat", {
      conversation_id: conversation.id,
      question,
    });
    assert.equal(response.status, 200, "previous failure released the chat lease");
    const result = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    assert(result.some((e) => e.type === "done"));
    assert(!result.some((e) => e.type === "error"));
    return result;
  }
  const arithmetic = await offlineTurn("2 + 2");
  assert.equal(arithmetic.filter((e) => e.type === "delta").map((e) => e.text).join(""), "4");
  const retrieval = await offlineTurn("search documents: maintenance");
  const sources = retrieval.filter((e) => e.type === "sources").flatMap((e) => e.sources);
  assert(sources.some((source) => source.document_id === document.id));
  assert(sources.some((source) => source.document_id === txt.id));
  assert(sources.every((source) => [document.id, txt.id].includes(source.document_id)));
  const excerpt = retrieval.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.match(excerpt, /500 hours/);
  assert.match(excerpt, /filter inspection/);
  const persisted = (await api(`/api/conversations/${conversation.id}`)).messages;
  assert.equal(persisted.length, 6);
  assert.deepEqual(persisted.slice(0, 2), failedMessages);
  assert.equal(persisted[3].status, "complete");
  assert.equal(persisted[3].content, "4");
  assert.equal(persisted[5].status, "complete");
  assert.equal(persisted[5].content, excerpt);
  for (const message of [persisted[3], persisted[5]]) {
    assert.equal(message.model_id, null);
    assert.equal(message.input_tokens, 0);
    assert.equal(message.output_tokens, 0);
  }
  await assert.rejects(access(join(data, "research-services.json")), {
    code: "ENOENT",
  });
  await stop();
  await start();
  assert(
    (await api("/api/workspace")).projects.some((p) => p.id === project.id),
  );
  assert(
    (await api(`/api/documents?assistant=${assistant.id}`)).some(
      (d) => d.id === document.id,
    ),
  );
  assert.deepEqual(
    (await api(`/api/conversations/${conversation.id}`)).messages,
    persisted,
    "failure, deterministic result and source-backed retrieval survive restart",
  );
  const restartedDocuments = await api(`/api/documents?assistant=${assistant.id}`);
  for (const source of [document, txt]) {
    const recoveredDocument = restartedDocuments.find((d) => d.id === source.id);
    assert.equal(recoveredDocument.status, "ready");
    assert.equal(recoveredDocument.embedding_model, "lexical-v1");
    assert(recoveredDocument.chunk_count > 0);
  }
  const downloaded = await fetch(origin + `/api/local/files/${txt.id}`, { headers });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), txtBytes);
  await assert.rejects(access(join(data, "research-services.json")), { code: "ENOENT" });
  const recovered = await api("/api/local/experimental");
  assert.equal(recovered.preferences.advancedReasoning, false);
  assert.equal(recovered.preferences.advancedWebResearch, false);
  console.log(
    "PASS: actual missing Docker, absent Ollama, first launch, rejected activation, explicit streamed chat failure, offline text/TXT preparation and retrieval, deterministic follow-up, no research installation, and exact conversation/source persistence across application restart. No containers or model inference tested.",
  );
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
