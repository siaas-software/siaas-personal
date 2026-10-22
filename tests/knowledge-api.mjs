// Real packaged HTTP routes + SQLite/filesystem, deterministic local Ollama fixture.
// Run after npm run desktop:build. Uses temporary data only.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = await mkdtemp(join(tmpdir(), "siaas-knowledge-api-")),
  folder = join(root, "manuals"),
  dataDir = join(root, "data");
await mkdir(folder);
await writeFile(
  join(folder, "manual.txt"),
  "The maintenance interval is 500 hours. ".repeat(12),
);
const ollama = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/tags")
    return res.end(
      JSON.stringify({
        models: [
          { name: "embeddinggemma:latest", digest: "a".repeat(64) },
          { name: "qwen2.5:1.5b", digest: "b".repeat(64) },
        ],
      }),
    );
  if (req.url === "/api/show")
    return res.end(JSON.stringify({ capabilities: ["completion"] }));
  if (req.url === "/api/embed")
    return res.end(
      JSON.stringify({
        embeddings: body.input.map(() =>
          Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)),
        ),
      }),
    );
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  key = "knowledge-integration-key-000000000000000";
const headers = {
  origin,
  "x-siaas-desktop-key": key,
  "Content-Type": "application/json",
};
let server,
  logs = "";
async function api(path, method = "GET", body) {
  const r = await fetch(origin + path, {
    method,
    headers,
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const text = await r.text();
  assert(r.ok, `${method} ${path}: ${r.status} ${text}\n${logs}`);
  return JSON.parse(text);
}
try {
  server = spawn(process.execPath, [resolve(".next/standalone/server.js")], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      SIAAS_RUNTIME: "desktop",
      SIAAS_DESKTOP_DEV: "0",
      SIAAS_DESKTOP_KEY: key,
      SIAAS_DESKTOP_ORIGIN: origin,
      SIAAS_DATA_DIR: dataDir,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`,
      VERCEL: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  let started = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(origin, { headers })).ok) {
        started = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(started, logs);
  const p = await api("/api/projects", "POST", { name: "Knowledge QA" });
  const a = await api("/api/assistants", "POST", {
    project_id: p.id,
    name: "Manuals",
    description: "",
    instructions: "Read manuals",
    model_id: null,
  });
  const target = { assistant_id: a.id, path: folder, recursive: false };
  const preview = await api("/api/local/knowledge", "POST", {
    action: "preview",
    ...target,
  });
  assert.equal(preview.files.length, 1);
  const link = await api("/api/local/knowledge", "POST", {
    action: "connect",
    ...target,
  });
  assert.equal(link.queued.length, 1);
  const id = link.queued[0];
  await api(`/api/documents/${id}/process`, "POST");
  let docs = await api(`/api/documents?assistant=${a.id}`);
  assert.equal(docs[0].status, "ready");
  assert.equal(docs[0].storage_path, null);
  assert.equal(docs[0].source_id, link.source.id);
  const download = await api(`/api/documents/${id}`);
  const contents = await (
    await fetch(origin + download.url, { headers })
  ).text();
  assert.match(contents, /500 hours/);
  const manifest = JSON.parse(
    await readFile(
      join(
        dataDir,
        "projects",
        p.id,
        "assistants",
        a.id,
        "knowledge",
        "index.json",
      ),
    ),
  );
  assert.equal(manifest.documents.length, 1);
  assert.match(manifest.documents[0].chunks[0].content, /500 hours/);
  await writeFile(
    join(folder, "manual.txt"),
    "The new maintenance interval is 750 hours. ".repeat(12),
  );
  const check = await api("/api/local/knowledge", "POST", {
    action: "refresh-project",
    project_id: p.id,
  });
  assert.deepEqual(check.queued, [id]);
  docs = await api(`/api/documents?assistant=${a.id}`);
  assert.equal(docs[0].status, "queued");
  assert.equal(docs[0].chunk_count, 0);
  await api(`/api/documents/${id}/process`, "POST");
  await rename(folder, folder + "-moved");
  const unavailable = await api("/api/local/knowledge", "POST", {
    action: "refresh",
    assistant_id: a.id,
    source_id: link.source.id,
  });
  assert.equal(unavailable.source.status, "unavailable");
  await api("/api/local/knowledge", "POST", {
    action: "connect",
    ...target,
    path: folder + "-moved",
    source_id: link.source.id,
  });
  const bytes = "Local imported notes. ".repeat(12);
  const one = await api("/api/documents", "POST", {
    assistant_id: a.id,
    title: "notes.txt",
    kind: "txt",
    byte_size: Buffer.byteLength(bytes),
  });
  const saved = await api(`/api/local/files/${one.id}`, "PUT", bytes);
  assert.equal(saved.id, one.id);
  const two = await api("/api/documents", "POST", {
    assistant_id: a.id,
    title: "renamed.txt",
    kind: "txt",
    byte_size: Buffer.byteLength(bytes),
  });
  assert.deepEqual(await api(`/api/local/files/${two.id}`, "PUT", bytes), {
    id: one.id,
    duplicate: true,
  });
  await api(`/api/documents/${one.id}`, "DELETE");
  assert.equal(await readFile(join(dataDir, one.storage_path), "utf8"), bytes);
  await api(`/api/projects/${p.id}`, "DELETE");
  assert.match(
    await readFile(join(folder + "-moved", "manual.txt"), "utf8"),
    /750 hours/,
  );
  await assert.rejects(access(join(dataDir, one.storage_path)));
  assert.equal((await api(`/api/documents?assistant=${a.id}`)).length, 0);
  const rejected = await fetch(origin + "/api/local/knowledge", {
    method: "POST",
    headers: { ...headers, origin: "https://invalid.example" },
    body: JSON.stringify({ action: "preview", ...target }),
  });
  assert.equal(rejected.status, 403);
  console.log(
    "PASS: real API import, linked-folder preview/refresh/reconnect, indexing, download, duplicate handling, project cleanup and origin protection.",
  );
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((r) => server.once("exit", r));
  }
  await new Promise((r) => ollama.close(r));
  await rm(root, { recursive: true, force: true });
}
