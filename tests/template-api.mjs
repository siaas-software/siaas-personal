// Real standalone desktop routes and SQLite, isolated from the user's workspace.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const ollama = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url === '/api/show'
    ? {capabilities:['completion'],details:{parameter_size:'1.5B'}}
    : {models:[{name:'qwen2.5:1.5b',digest:'a'.repeat(64)}]}));
});
await new Promise(resolve => ollama.listen(0,'127.0.0.1',resolve));
const directory = await mkdtemp(join(tmpdir(), 'siaas-template-api-'));
const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
const key = 'isolated-template-api-test-key-000000';
const headers = { 'Content-Type': 'application/json', origin, 'x-siaas-desktop-key': key };
let logs = '';
const server = spawn(process.execPath, [resolve('.next/standalone/server.js')], {
  env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port), SIAAS_RUNTIME: 'desktop',
    SIAAS_DESKTOP_DEV: '1', SIAAS_DESKTOP_KEY: key, SIAAS_DESKTOP_ORIGIN: origin, SIAAS_DATA_DIR: directory,
    VERCEL: '0', OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`, NEXT_TELEMETRY_DISABLED: '1', }, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
async function request(path, method = 'GET', body) {
  return fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function api(path, method = 'GET', body) {
  const r = await request(path, method, body); const text = await r.text();
  assert(r.ok, `${path}: ${r.status} ${text}\n${logs}`); return JSON.parse(text);
}
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const presets = await api('/api/templates');
  assert.deepEqual(presets.map(t => t.name), ['Computer Science Study', 'Production Planning', 'Personal Finance']);
  const project = await api('/api/projects', 'POST', { template_id: presets[0].id });
  const workspace = await api('/api/workspace');
  assert.match(workspace.version, /^\d+\.\d+\.\d+/);
  const assistants = workspace.assistants.filter(a => a.project_id === project.id);
  assert.equal(assistants.length, 3);
  for (const assistant of assistants) {
    const docs = await api(`/api/documents?assistant=${assistant.id}`);
    assert.equal(docs.length, 1); assert.equal(docs[0].enabled, true); assert(docs[0].source_url);
  }
  const a = assistants[0];
  assert.equal((await request(`/api/assistants/${a.id}/export`)).status, 404);
  assert.equal((await request(`/api/assistants/${a.id}/export`, 'POST', {})).status, 404);
  const selected = await api(`/api/assistants/${a.id}`, 'PATCH', {...a, model_id:'ollama/qwen2.5:1.5b'});
  assert.equal(selected.model_id,'ollama/qwen2.5:1.5b');
  await api(`/api/assistants/${a.id}`, 'PATCH', {...selected, description:'Edited configuration'});
  assert.equal((await api('/api/workspace')).assistants.find(item=>item.id===a.id).model_id,'ollama/qwen2.5:1.5b');
  const doc = (await api(`/api/documents?assistant=${a.id}`))[0];
  await api('/api/local/knowledge/web', 'POST', { action: 'toggle', assistant_id: a.id, document_id: doc.id, enabled: false });
  assert.equal((await api(`/api/documents?assistant=${a.id}`))[0].enabled, false);
  assert.equal((await request('/api/local/knowledge/web', 'POST', { action: 'toggle', assistant_id: assistants[1].id, document_id: doc.id, enabled: true })).status, 400);
  await api('/api/documents', 'POST', { assistant_id: a.id, kind: 'text', title: 'Private notes', text: 'SECRET_LOCAL_TEXT_123' });
  const exported = await api(`/api/project/export?project=${project.id}`);
  assert.equal(exported.format, 'siaas-project-v1');
  assert(exported.project.assistants.every(a => a.sources.length === 1 && a.model === null && !('color' in a)));
  assert(!JSON.stringify(exported).includes('SECRET_LOCAL_TEXT_123'));
  assert(!JSON.stringify(exported).includes('listing'));
  assert.equal((await api(`/api/documents?assistant=${a.id}`)).length, 2);
  const saved = await api(`/api/projects/${project.id}/template`, 'POST', { name: 'Saved portable' });
  assert(saved.assistants.every(a => a.sources.length === 1));
  const catalogDownload = await api(`/api/templates/${saved.id}`);
  assert.deepEqual(catalogDownload.project.assistants, exported.project.assistants);
  const empty = await api('/api/projects', 'POST', { name: 'Empty' });
  const imported = await api(`/api/project/import?project=${empty.id}`, 'POST', exported);
  assert.equal(imported.sources, 3);
  assert.equal((await request(`/api/project/import?project=${empty.id}`, 'POST', exported)).status, 409);
  const fresh = (await api('/api/workspace')).assistants.filter(a => a.project_id === empty.id);
  assert.equal(fresh.length, 3);
  for (const assistant of fresh) assert.equal((await api(`/api/documents?assistant=${assistant.id}`))[0].enabled, true);
  const legacy = await api('/api/templates', 'POST', { format: 'siaas-project-v1', listing: { title: 'Old' }, project: { name: 'Legacy', assistants: [{ name: 'Old assistant', model: 'old', color: '#123456' }] } });
  const old = await api('/api/projects', 'POST', { template_id: legacy.id });
  const oldAssistant = (await api('/api/workspace')).assistants.find(a => a.project_id === old.id);
  assert.equal(oldAssistant.model_id, null);
  assert.equal((await api(`/api/documents?assistant=${oldAssistant.id}`)).length, 0);
  console.log('PASS: actual desktop APIs, version metadata, assistant/model persistence, removed export endpoint, 3 presets, source ownership/toggles, portable exports, saved templates, import and legacy compatibility with simulated Ollama discovery.');
} finally {
  server.kill('SIGKILL'); await new Promise(r => server.once('exit', r));
  await new Promise(resolve => ollama.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
