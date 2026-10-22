// Compiled desktop API + SQLite + local Ollama/services and Docker/website mocks.
// No browser, Docker daemon, real Internet search or model download is used.
// Run after desktop:build: node --import tsx tests/research-e2e.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "../src/lib/local/database.ts";
import { LOCAL_USER_ID } from "../src/lib/runtime.ts";
const directory = await mkdtemp(join(tmpdir(), "siaas-unified-e2e-"));
const token = "fixture-only-token-".repeat(4);
let siteCalls = 0,
  webCalls = 0,
  reasonCalls = 0,
  serviceOnline = true,
  app,
  db;
let logs = "";
const site = createServer((req, res) => {
  siteCalls++;
  assert.equal(req.method, "GET");
  assert.equal(req.url, "/docs");
  assert(!JSON.stringify(req.headers).includes("PRIVATE"));
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<html><title>Configured site</title><body>Public astronomy background. A partial website citation for this question.</body></html>",
  );
});
const services = createServer(async (req, res) => {
  assert.equal(req.headers.authorization, `Bearer ${token}`);
  let raw = "";
  for await (const c of req) raw += c;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health") {
    res.statusCode = serviceOnline ? 200 : 503;
    return res.end(JSON.stringify({ ok: serviceOnline }));
  }
  if (req.url === "/assess") {
    reasonCalls++;
    const b = JSON.parse(raw);
    return res.end(
      JSON.stringify({
        coverage: b.evidence.some((s) => s.kind === "web")
          ? "sufficient"
          : "partial",
        uncertain: false,
        needsFreshness: false,
      }),
    );
  }
  if (req.url === "/research") {
    webCalls++;
    const b = JSON.parse(raw);
    assert.equal(b.query, "public astronomy facts");
    assert(!raw.includes("PRIVATE"));
    assert(!raw.includes("scheduling"));
    return res.end(
      JSON.stringify({
        version: 1,
        status: "partial",
        evidence: [
          {
            url: "https://1.1.1.1/fixture",
            title: "Discovered source",
            content: "Public astronomy facts from a discovered source.",
            fetchedAt: new Date().toISOString(),
          },
        ],
        missing: ["Unverified fixture detail"],
        searches: 1,
        pages: 1,
      }),
    );
  }
  res.writeHead(404).end("{}");
});
const ollama = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const b = raw ? JSON.parse(raw) : {};
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/tags")
    return res.end(
      JSON.stringify({
        models: [
          { name: "test:1.5b", digest: "a".repeat(64) },
          { name: "test:8b", digest: "b".repeat(64) },
        ],
      }),
    );
  if (req.url === "/api/show")
    return res.end(
      JSON.stringify({
        capabilities: [
          "completion",
          ...(b.model?.includes("8b") ? ["tools"] : []),
        ],
        details: { parameter_size: b.model?.includes("8b") ? "8B" : "1.5B" },
        model_info: {
          "general.parameter_count": b.model?.includes("8b") ? 8e9 : 1.5e9,
        },
      }),
    );
  if (req.url === "/api/ps") return res.end('{"models":[]}');
  if (req.url === "/api/chat") {
    assert(!raw.includes("Prepara SOLO un oggetto JSON"));
    const answer = "Answer using local and available public sources [1] [2].";
    return res.end(
      JSON.stringify({
        model: b.model,
        created_at: new Date().toISOString(),
        message: { role: "assistant", content: answer },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 50,
        eval_count: 20,
      }) + "\n",
    );
  }
  res.writeHead(404).end("{}");
});
for (const s of [site, services, ollama])
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
const bin = join(directory, "bin"),
  state = join(directory, "docker.json");
await mkdir(bin);
await writeFile(state, '{"ready":true}');
await writeFile(
  join(bin, "docker"),
  `#!${process.execPath}\nconst fs=require('node:fs'),a=process.argv.slice(2),s=JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'));
if(a[0]==='--version') console.log('Docker 27'); else if(a[0]==='compose'&&a[1]==='version') console.log('2.30.0'); else if(a[0]==='info'&&s.ready) console.log(JSON.stringify({ServerVersion:'27.0.0',OSType:'linux',Architecture:'x86_64'})); else process.exit(99);`,
  { mode: 0o755 },
);
const preload = join(directory, "public-site-fixture.mjs");
await writeFile(
  preload,
  `import http from 'node:http'; import dns from 'node:dns'; import {syncBuiltinESMExports} from 'node:module';
const get=http.get,lookup=dns.promises.lookup;
dns.promises.lookup=async function(host,options){if(host==='research.example.org')return [{address:'93.184.216.34',family:4}];return lookup.call(this,host,options);};
http.get=function(url,options,callback){if(new URL(url).hostname==='research.example.org'){return get.call(this,new URL('http://127.0.0.1:${site.address().port}'+new URL(url).pathname),{...options,lookup:undefined},callback);}return get.call(this,url,options,callback);};
syncBuiltinESMExports();`,
);
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  key = "unified-fixture-key-".repeat(4);
const headers = {
  "Content-Type": "application/json",
  origin,
  "x-siaas-desktop-key": key,
};
async function api(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(origin + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await r.text();
  assert(r.ok, `${path}: ${r.status} ${raw}\n${logs}`);
  return JSON.parse(raw);
}
async function chat(id, question = "public astronomy facts") {
  const r = await fetch(origin + "/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ conversation_id: id, question, ...(process.env.SIAAS_TEST_ACTION_ID ? { action_id: process.env.SIAAS_TEST_ACTION_ID } : {}) }),
  });
  assert(r.ok);
  const events = (await r.text()).trim().split("\n").map(JSON.parse);
  assert(
    !events.some((e) => e.type === "error"),
    JSON.stringify(events) + logs,
  );
  return (await api(`/api/conversations/${id}`)).messages.at(-1);
}
try {
  app = spawn(
    process.execPath,
    ["--import", preload, resolve(".next/standalone/server.js")],
    {
      cwd: resolve(".next/standalone"),
      env: {
        ...process.env,
        PATH: bin,
        SIAAS_DATA_DIR: directory,
        SIAAS_RUNTIME: "desktop",
        VERCEL: "0",
        SIAAS_DESKTOP_KEY: key,
        SIAAS_DESKTOP_ORIGIN: origin,
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`,
        SIAAS_LAYA_URL: `http://127.0.0.1:${services.address().port}`,
        SIAAS_MORPHIC_URL: `http://127.0.0.1:${services.address().port}`,
        SIAAS_RESEARCH_TOKEN: token,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  app.stdout.on("data", (d) => (logs += d));
  app.stderr.on("data", (d) => (logs += d));
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      await api("/api/workspace");
      ready = true;
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  assert(ready, logs);
  const permanentKnowledge = () =>
    JSON.stringify(
      ["knowledge_sources", "documents", "document_chunks"].map((table) =>
        db.rows(table),
      ),
    );
  const project = await api("/api/projects", { name: "Unified" });
  db = new LocalDatabase(directory);
  const assistants = [];
  for (const mode of ["documents", "sites", "web"]) {
    const a = await api("/api/assistants", {
      project_id: project.id,
      name: mode,
      model_id: "ollama/test:1.5b",
      research: {
        mode,
        websites: [{ url: "http://research.example.org/docs", scope: "page" }],
      },
    });
    const doc = db.put("documents", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: a.id,
      title: "PRIVATE local planning",
      status: "ready",
    });
    db.put("document_chunks", {
      tenant_id: LOCAL_USER_ID,
      assistant_id: a.id,
      document_id: doc.id,
      content: "Astronomy scheduling PRIVATE source information",
      position: 0,
    });
    const c = await api("/api/conversations", { assistant_id: a.id });
    const knowledgeBefore = permanentKnowledge();
    const before = siteCalls;
    const message = await chat(c.id);
    assert.equal(
      permanentKnowledge(),
      knowledgeBefore,
      "On-demand site evidence must not change permanent knowledge",
    );
    assert.equal(message.agent_mode, false);
    assert(message.sources.some((s) => s.document_id === doc.id));
    assert.equal(siteCalls > before, mode !== "documents");
    assert.equal(webCalls, 0);
    if (mode === "documents") {
      await api(
        `/api/assistants/${a.id}`,
        {
          name: mode,
          model_id: "ollama/test:1.5b",
          research: { ...a.research, websitesConfirmed: true },
        },
        "PATCH",
      );
      const confirmed = await chat(c.id);
      assert(confirmed.sources.some((s) => s.kind === "website"));
      assert.equal(permanentKnowledge(), knowledgeBefore);
    } else assert(message.sources.some((s) => s.kind === "website"));
    assistants.push({ a, c });
  }
  const { a, c } = assistants[1];
  const knowledgeBeforeAdvanced = permanentKnowledge();
  let rejected = await fetch(origin + `/api/assistants/${a.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      name: a.name,
      model_id: a.model_id,
      research: { ...a.research, advancedWebResearch: true },
    }),
  });
  assert.equal(rejected.status, 409);
  assert.equal(db.get("assistants", a.id).research.advancedWebResearch, false);
  const workspace = db.get("workspaces", LOCAL_USER_ID);
  db.put(
    "workspaces",
    {
      ...workspace,
      experimental_features: {
        version: 1,
        advancedReasoning: true,
        advancedWebResearch: true,
      },
    },
    true,
  );
  const reasonOnly = await chat(c.id);
  assert(reasonOnly.sources.length >= 2);
  assert(reasonCalls > 0);
  assert.equal(webCalls, 0);
  serviceOnline = false;
  rejected = await fetch(origin + `/api/assistants/${a.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      name: a.name,
      model_id: a.model_id,
      research: { ...a.research, advancedWebResearch: true },
    }),
  });
  assert.equal(rejected.status, 409);
  assert.equal(db.get("assistants", a.id).research.advancedWebResearch, false);
  serviceOnline = true;
  await api(
    `/api/assistants/${a.id}`,
    {
      name: a.name,
      model_id: "ollama/test:8b",
      research: { ...a.research, advancedWebResearch: true },
    },
    "PATCH",
  );
  const advanced = await chat(c.id);
  assert(advanced.agent_mode);
  assert(advanced.sources.some((s) => s.kind === "web"));
  assert.equal(webCalls, 1);
  assert(advanced.research_warnings.length);
  assert.equal(
    permanentKnowledge(),
    knowledgeBeforeAdvanced,
    "Advanced evidence belongs to the conversation only",
  );
  await writeFile(state, '{"ready":false}');
  const fallback = await chat(c.id);
  assert(fallback.sources.length >= 2);
  assert.equal(webCalls, 1);
  assert(fallback.research_warnings.length);
  assert.equal(
    permanentKnowledge(),
    knowledgeBeforeAdvanced,
    "Fallback must preserve permanent knowledge",
  );
  assert.equal(db.get("assistants", a.id).research.advancedWebResearch, true);
  const other = assistants[0].a;
  const otherSettings = db.get("assistants", other.id).research;
  rejected = await fetch(origin + `/api/assistants/${other.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      name: other.name,
      model_id: other.model_id,
      research: { ...otherSettings, advancedWebResearch: true },
    }),
  });
  assert.equal(rejected.status, 409);
  assert.equal(
    db.get("assistants", other.id).research.advancedWebResearch,
    false,
  );
  const before = siteCalls;
  await chat(c.id, "hello");
  assert.equal(siteCalls, before);
  assert.equal(webCalls, 1);
  assert((await api(`/api/conversations/${c.id}`)).messages.length >= 10);
  const persisted = new LocalDatabase(directory);
  try {
    assert(
      persisted
        .rows("messages")
        .some((m) =>
          m.sources?.some(
            (s) => s.kind === "web" && s.url === "https://1.1.1.1/fixture",
          ),
        ),
      "Attributed discovery evidence must survive database reopen in conversation history",
    );
    assert.equal(
      JSON.stringify(
        ["knowledge_sources", "documents", "document_chunks"].map((table) =>
          persisted.rows(table),
        ),
      ),
      knowledgeBeforeAdvanced,
    );
  } finally {
    persisted.close();
  }
  console.log(
    "PASS: compiled unified workflow for all legacy configurations and small/agent models, migration confirmation, local+site citations, global/assistant/Docker/health gates, private-data boundaries, graceful failures and conversation persistence. All external dependencies mocked.",
  );
} finally {
  app?.kill();
  if (app && app.exitCode === null)
    await new Promise((r) => app.once("exit", r));
  db?.close();
  for (const s of [site, services, ollama]) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  await rm(directory, { recursive: true, force: true });
}
