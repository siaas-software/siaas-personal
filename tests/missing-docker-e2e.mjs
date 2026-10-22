// Compiled app + real SQLite, actual missing Docker and unreachable Ollama.
// No fake Docker executable, fetch override or model/service fixture is used.
// Run after desktop:build. Skips when the machine has a Docker executable.
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
if (docker.reason !== "not_installed") {
  console.log(
    "SKIP: missing-Docker scenario requires an environment without the Docker executable.",
  );
  process.exit(0);
}
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
  assert.equal(chat.status, 503);
  assert.match(JSON.stringify(await chat.json()), /Ollama/);
  const processing = await request(`/api/documents/${document.id}/process`, {});
  assert.equal(processing.status, 503);
  assert.match(JSON.stringify(await processing.json()), /Ollama/);
  assert.deepEqual(
    (await api(`/api/conversations/${conversation.id}`)).messages,
    [],
  );
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
  const recovered = await api("/api/local/experimental");
  assert.equal(recovered.preferences.advancedReasoning, false);
  assert.equal(recovered.preferences.advancedWebResearch, false);
  console.log(
    "PASS: actual missing Docker, absent Ollama, first launch, rejected activation, safe chat/indexing errors, no research installation, and data persistence across application restart. No containers or model inference tested.",
  );
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
