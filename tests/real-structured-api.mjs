// Opt-in: actual standalone app + installed local >=8B tool model, no simulator.
// Run: OLLAMA_BASE_URL=http://127.0.0.1:11434 node --import tsx tests/real-structured-api.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { agentEligibility } from '../src/lib/agent-policy.ts';

const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const model = process.env.SIAAS_REAL_MODEL || 'qwen3:8b';
const url = new URL(base);
assert.equal(url.protocol, 'http:');
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
const infoResponse = await fetch(base + '/api/show', {
  method: 'POST', body: JSON.stringify({ model }), signal: AbortSignal.timeout(10000),
});
assert(infoResponse.ok, `Model unavailable: ${infoResponse.status}`);
const info = await infoResponse.json();
assert(agentEligibility(info).enabled, 'Requires verified local >=8B tool model');
console.log('Real model eligibility', model, agentEligibility(info));

const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
const key = 'isolated-real-analysis-test-0000000000';
const headers = { origin, 'x-siaas-desktop-key': key, 'Content-Type': 'application/json' };
const directory = await mkdtemp(join(tmpdir(), 'siaas-real-analysis-'));
const serverRoot = resolve(process.env.SIAAS_TEST_SERVER_ROOT || '.next/standalone');
const server = spawn(process.execPath, [join(serverRoot, 'server.js')], {
  cwd: serverRoot,
  env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
    SIAAS_RUNTIME: 'desktop', SIAAS_DESKTOP_DEV: '0', SIAAS_DESKTOP_KEY: key,
    SIAAS_DESKTOP_ORIGIN: origin, SIAAS_DATA_DIR: directory, OLLAMA_BASE_URL: base,
    VERCEL: '0', NEXT_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', d => { logs += d; });
server.stderr.on('data', d => { logs += d; });
const exited = new Promise(r => { server.once('exit', r); server.once('error', r); });
async function api(path, method = 'GET', body, expected = 200) {
  const response = await fetch(origin + path, { method, headers,
    signal: AbortSignal.timeout(300000),
    ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return JSON.parse(text);
}
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(origin, { headers })).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert(ready, logs);
  const project = await api('/api/projects', 'POST', { template_id: 'production-planning' }, 201);
  const workspace = await api('/api/workspace');
  const assistant = workspace.assistants.find(a => a.project_id === project.id);
  assert(assistant);
  await api(`/api/assistants/${assistant.id}`, 'PATCH', {
    name: assistant.name, description: assistant.description,
    instructions: 'Explain the computed total briefly, citing the source filename. Never invent records.',
    model_id: `ollama/${model}`,
  });
  const bytes = Buffer.from('Product,Quantity\nA,10\nB,5\n');
  const doc = await api('/api/documents', 'POST', {
    assistant_id: assistant.id, title: 'orders.csv', kind: 'csv', byte_size: bytes.length,
  }, 201);
  await api(`/api/local/files/${doc.id}`, 'PUT', bytes);
  await api(`/api/documents/${doc.id}/process`, 'POST');
  const inspection = await api(`/api/local/structured?assistant=${assistant.id}`);
  const dataset = inspection.datasets.find(d => d.filename === 'orders.csv');
  assert(dataset);
  await api('/api/local/structured', 'POST', { assistantId: assistant.id,
    action: 'mapping', id: dataset.id, value: { ...dataset.mapping, confirmed: true } });
  const conversation = await api('/api/conversations', 'POST', { assistant_id: assistant.id }, 201);
  const started = Date.now();
  const response = await fetch(origin + '/api/chat', { method: 'POST', headers,
    signal: AbortSignal.timeout(300000),
    body: JSON.stringify({ conversation_id: conversation.id,
      question: 'What is the total Quantity across all rows of orders.csv? Sum Quantity with no grouping or filters.' }) });
  const raw = await response.text();
  console.log('Chat elapsed ms', Date.now() - started);
  console.log('Synthetic chat events', raw);
  assert(response.ok, `Chat HTTP ${response.status}`);
  const events = raw.trim().split('\n').map(JSON.parse);
  assert(!events.some(e => e.type === 'error'), 'Chat error; see full events above');
  const history = await api(`/api/conversations/${conversation.id}`);
  const message = history.messages.find(m => m.role === 'assistant');
  console.log('Persisted synthetic assistant response', JSON.stringify(message));
  assert(message?.structured_analysis, 'No deterministic result persisted; see chat events');
  assert.equal(message.status, 'complete');
  assert.equal(message.structured_analysis.rows.length, 1);
  assert(Object.values(message.structured_analysis.rows[0]).includes('15'), 'Expected exact SUM = 15');
  assert(message.artifacts?.some(a => a.content.includes('orders.csv')), 'Missing source evidence');
  const explanation = events.filter(e => e.type === 'delta').map(e => e.text).join('').split('### AI explanation')[1];
  assert(explanation?.trim() && !explanation.includes('AI explanation unavailable'), 'No real model explanation');
  console.log('PASS real analytical chat: template/model selection, import, confirmed mapping, exact SUM 15, evidence, explanation and history');
} finally {
  console.log('Standalone server log', logs);
  server.kill();
  await exited;
  await rm(directory, { recursive: true, force: true });
}
