// Compiled desktop HTTP -> real temporary SQLite, with read-only Docker CLI mocks.
// The fixture refuses every container mutation. No Docker daemon or container is used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "siaas-beta-http-"));
const bin = join(directory, "bin");
await mkdir(bin);
const state = join(directory, "docker-state.json");
await writeFile(state, JSON.stringify({ ready: false }));
await writeFile(
  join(bin, "docker"),
  `#!${process.execPath}\nimport { readFileSync } from 'node:fs';
const state=JSON.parse(readFileSync(${JSON.stringify(state)},'utf8'));
const args=process.argv.slice(2);
if(args.join(' ')==='--version') console.log('Docker version 27.0.0');
else if(args.join(' ')==='compose version --short') console.log('2.30.0');
else if(args[0]==='info' && !state.ready) process.exit(1);
else if(args[0]==='info') console.log(JSON.stringify({ServerVersion:'27.0.0',OSType:'linux',Architecture:'x86_64'}));
else { console.error('Container commands forbidden in this mock test'); process.exit(99); }
`,
  { mode: 0o755 },
);
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  key = "beta-fixture-key-".repeat(4);
const headers = {
  "x-siaas-desktop-key": key,
  origin,
  "Content-Type": "application/json",
};
let logs = "";
const server = spawn(
  process.execPath,
  [resolve(".next/standalone/server.js")],
  {
    cwd: resolve(".next/standalone"),
    env: {
      ...process.env,
      PATH: bin,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      VERCEL: "0",
      SIAAS_RUNTIME: "desktop",
      SIAAS_DESKTOP_DEV: "0",
      SIAAS_DESKTOP_KEY: key,
      SIAAS_DESKTOP_ORIGIN: origin,
      SIAAS_DATA_DIR: directory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
async function api(path, method = "GET", body, extra = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: { ...headers, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
try {
  let up = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await api("/api/local/experimental")).status === 200) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  assert(up, logs);
  let status = await api("/api/local/experimental");
  assert.equal(status.body.docker.reason, "engine_unavailable");
  for (const feature of ["advancedReasoning", "advancedWebResearch"]) {
    assert.equal(status.body.preferences[feature], false);
    const rejected = await api("/api/local/experimental", "PATCH", {
      feature,
      enabled: true,
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, "engine_unavailable");
  }
  assert.equal(
    (
      await api(
        "/api/local/experimental",
        "PATCH",
        { feature: "advancedReasoning", enabled: true },
        { origin: "https://invalid.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/api/local/experimental", "PATCH", {
        feature: "unknown",
        enabled: true,
      })
    ).status,
    400,
  );
  await writeFile(state, JSON.stringify({ ready: true }));
  status = await api("/api/local/experimental");
  assert.equal(status.body.docker.ready, true);
  assert.equal(status.body.preferences.advancedReasoning, false);
  assert.equal(status.body.preferences.advancedWebResearch, false);
  const project = await api("/api/projects", "POST", {
    name: "Preserved",
    color: "#FFFFFF",
  });
  assert.equal(project.status, 201);
  const assistant = await api("/api/assistants", "POST", {
    project_id: project.body.id,
    name: "Standard",
    model_id: null,
    research: {
      mode: "sites",
      websites: [{ url: "https://example.org", scope: "page" }],
    },
  });
  assert.equal(assistant.status, 201);
  const body = {
    name: "Standard",
    model_id: null,
    research: {
      version: 2,
      advancedWebResearch: true,
      websites: [{ url: "https://example.org", scope: "page" }],
    },
  };
  const rejectedMode = await api(
    `/api/assistants/${assistant.body.id}`,
    "PATCH",
    body,
  );
  assert.equal(rejectedMode.status, 409);
  assert.equal(rejectedMode.body.code, "feature_disabled");
  const workspace = await api("/api/workspace");
  const saved = workspace.body.assistants.find(
    (a) => a.id === assistant.body.id,
  );
  assert.equal(saved.research.version, 2);
  assert.equal(saved.research.advancedWebResearch, false);
  assert.equal(saved.research.websites.length, 1);
  assert.equal((await fetch(origin + "/api/local/experimental")).status, 403);
  console.log(
    "PASS: compiled API rejects absent Engine, invalid origins/payloads and disabled assistant Beta; Docker recovery never opts in; normal project/assistant data persists. No container commands executed.",
  );
} finally {
  server.kill();
  if (server.exitCode === null)
    await new Promise((r) => server.once("exit", r));
  await rm(directory, { recursive: true, force: true });
}
