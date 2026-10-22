// Acceptance test against the real standalone desktop HTTP server and SQLite.
// Only Ollama model discovery is simulated; no personal data or installed app is used.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'siaas-project-flows-'));
const ollama = createServer((req, res) => {
  if (req.url === "/api/show") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ capabilities: ["completion"] })); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ models: [
    { name: 'qwen2.5:1.5b', digest: 'a'.repeat(64) },
    { name: 'qwen2.5-coder:3b', digest: 'c'.repeat(64) },
    { name: 'embeddinggemma:latest', digest: 'b'.repeat(64) },
  ] }));
});
await new Promise(r => ollama.listen(0, '127.0.0.1', r));
const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
const key = 'isolated-project-flows-test-key-000000';
const headers = { 'Content-Type': 'application/json', origin, 'x-siaas-desktop-key': key };
let server, browser, logs = '';
const pageErrors = [];
async function request(path, method = 'GET', body) {
  return fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function api(path, method = 'GET', body) {
  const r = await request(path, method, body); const text = await r.text();
  assert(r.ok, `${method} ${path}: ${r.status} ${text}\n${logs}`);
  return JSON.parse(text);
}
async function until(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Condition timed out');
}
async function start() {
  server = spawn(process.execPath, [resolve('.next/standalone/server.js')], {
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      SIAAS_RUNTIME: 'desktop', SIAAS_DESKTOP_DEV: '1', SIAAS_DESKTOP_KEY: key,
      SIAAS_DESKTOP_ORIGIN: origin, SIAAS_DATA_DIR: join(directory, 'data'), VERCEL: '0',
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
  await until(async () => { try { return (await request('/')).ok; } catch { return false; } });
}
async function stop() {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM'); await new Promise(r => server.once('exit', r));
  }
}
try {
  await start();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, extraHTTPHeaders: { 'x-siaas-desktop-key': key } });
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('**/api/local/hardware', route => route.fulfill({ json: {
    hardware: { ram: 16, gpu: 'cpu', vram: 0, disk: 100 },
    cpu: 'CPU test', gpuName: 'Grafica integrata', freeRam: 12, note: '',
  } }));
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor();
  assert.equal(await page.getByText('Check Ollama', { exact: true }).count(), 0);
  assert.equal(await page.locator('.sidebar-bottom button').first().innerText(), 'Templates');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('heading', { name: 'Templates.' }).waitFor();
  const eventCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Computer Science Study', exact: true }) });
  await eventCard.getByRole('button', { name: 'Use template' }).click();
  assert.match(await page.locator('select[name="template_id"]').inputValue(), /computer-science-study/);
  await page.getByLabel('Project name', { exact: true }).fill('Evento QA');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: 'Evento QA.' }).waitFor();
  let workspace = await api('/api/workspace');
  let project = workspace.projects.find(p => p.name === 'Evento QA');
  let assistants = workspace.assistants.filter(a => a.project_id === project.id);
  assert.equal(assistants.length, 3);
  assert(assistants.every(a => a.instructions && a.model_id === null));
  assert.equal(await page.locator('.project-settings').count(), 0);
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  assert(await page.getByRole('menuitem', { name: 'Import', exact: true }).isDisabled());
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Configuration');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(), 0);
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Configuration', exact: true }).click();
  const config = page.locator('.project-settings');
  await config.getByLabel('Name', { exact: true }).fill('Evento aggiornato');
  await config.getByLabel('Project description').fill('Organizza il lancio del prodotto');
  await config.getByLabel('Project color', { exact: true }).fill('#18283c');
  await config.getByRole('button', { name: 'Save project' }).click();
  await page.getByRole('heading', { name: 'Evento aggiornato.' }).waitFor();
  await until(async () => await page.locator('main').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(24, 40, 60)');
  await mkdir('test-results/project-flows', { recursive: true });
  await page.screenshot({ path: 'test-results/project-flows/detail.png', fullPage: true });
  const a = assistants[0];
  await page.locator('.resource-card').filter({ has: page.getByRole('heading', { name: a.name, exact: true }) }).locator('.assistant-card').click();
  await page.getByRole('tab', { name: 'Configuration', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: 'Model catalog' }).count(), 0);
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  const catalog = page.getByRole('region', { name: 'Model catalog' });
  await until(async () => (await catalog.locator('.hardware-card').count()) === 12);
  // Advice stays consistent across the suggested cards and the searchable catalog.
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  const advisor = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Find the right model', exact: true }) });
  const recommended = 'RECOMMENDED FOR THIS PC';
  const installedRecommended = 'BEST ALREADY INSTALLED';
  await catalog.getByLabel('Search models').fill('qwen2.5:');
  await until(async () => await advisor.locator('.model-recommendation').count() === 2);
  for (const section of [advisor, catalog]) {
    assert.equal(await section.getByText(recommended, { exact: true }).count(), 1);
    assert.equal(await section.getByText(installedRecommended, { exact: true }).count(), 1);
  }
  await page.screenshot({ path: 'test-results/project-flows/assistant-config-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/project-flows/assistant-config-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await advisor.getByLabel('Total RAM (GB)', { exact: true }).fill('8');
  for (const section of [advisor, catalog]) {
    await until(async () => await section.getByText(recommended, { exact: true }).count() === 1);
    assert.equal(await section.getByText(installedRecommended, { exact: true }).count(), 0);
    assert.match(await section.locator('.hardware-card').filter({ has: page.getByText(recommended, { exact: true }) }).innerText(), /1\.5[Bb]/);
  }
  await advisor.getByLabel('Total RAM (GB)', { exact: true }).fill('4');
  assert.equal(await page.locator('.model-recommendation').count(), 0);
  await advisor.getByLabel('Total RAM (GB)', { exact: true }).fill('16');
  await catalog.getByLabel('Search models').fill('');
  await catalog.getByRole('button', { name: 'Next', exact: true }).click();
  assert.match(await catalog.innerText(), /pagina 2 di/);
  await catalog.getByLabel('Search models').fill('qwen2.5-coder:3b');
  await until(async () => (await catalog.locator('.hardware-card').count()) === 1);
  assert.match(await catalog.innerText(), /pagina 1 di 1/);
  await catalog.getByRole('button', { name: 'Use for assistant', exact: true }).click();
  await until(async () => (await api('/api/workspace')).assistants.find(x => x.id === a.id)?.model_id === 'ollama/qwen2.5-coder:3b');
  const updated = (await api('/api/workspace')).assistants.find(x => x.id === a.id);
  assert.equal(updated.instructions, a.instructions);
  await page.getByRole('tab', { name: 'Configuration', exact: true }).click();
  await page.getByLabel(/^Instructions/).fill('Updated instructions');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await until(async () => (await api('/api/workspace')).assistants.find(x => x.id === a.id)?.instructions === 'Updated instructions');
  assert.equal((await api('/api/workspace')).assistants.find(x => x.id === a.id).model_id, 'ollama/qwen2.5-coder:3b');
  a.instructions = 'Updated instructions';
  await page.reload();
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  await page.locator('.assistant-models .model-tag').filter({ hasText: /qwen2.5-coder|Qwen 2.5 Coder/i }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Models', exact: true }).getAttribute('aria-selected'), 'true');
  await page.screenshot({ path: 'test-results/project-flows/model-config.png', fullPage: true });
  await page.getByRole('button', { name: 'All assistants', exact: true }).click();
  const doc = await api('/api/documents', 'POST', { assistant_id: a.id, title: 'Private.txt', kind: 'txt', byte_size: 15 });
  const uploaded = await fetch(origin + `/api/local/files/${doc.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'text/plain' }, body: 'PRIVATE CONTENT' });
  assert(uploaded.ok);
  const conversation = await api('/api/conversations', 'POST', { assistant_id: a.id });
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  await page.getByLabel('Template name', { exact: true }).fill('Evento riutilizzabile');
  await page.getByRole('button', { name: 'Save to Templates' }).click();
  await page.getByRole('heading', { name: 'Templates.' }).waitFor();
  const savedCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Evento riutilizzabile', exact: true }) });
  await savedCard.waitFor();
  const downloading = page.waitForEvent('download');
  await savedCard.getByRole('link', { name: 'Export JSON' }).click();
  const download = await downloading;
  const downloadPath = join(directory, 'template.json'); await download.saveAs(downloadPath);
  const raw = await readFile(downloadPath, 'utf8'); const bundle = JSON.parse(raw);
  assert.equal(bundle.project.color, '#18283c');
  assert.equal(bundle.project.assistants.length, 3);
  assert(bundle.project.assistants.some(x => x.instructions === a.instructions && x.model === null));
  assert(!/PRIVATE CONTENT|Private.txt|storage_path|conversation_id|tenant_id|project_id|document_id/.test(raw));
  bundle.project.name = 'Template importato';
  bundle.project.documents = ['MUST NOT IMPORT']; bundle.project.assistants[0].documents = ['MUST NOT IMPORT'];
  await page.locator('.main-content input[type=file]').setInputFiles({ name: 'template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  const importedCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Template importato', exact: true }) });
  await importedCard.waitFor();
  await importedCard.getByRole('button', { name: 'Use template' }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: 'Template importato.' }).waitFor();
  workspace = await api('/api/workspace');
  const importedProject = workspace.projects.find(p => p.name === 'Template importato');
  const importedAssistants = workspace.assistants.filter(x => x.project_id === importedProject.id);
  assert(importedAssistants.every(x => x.model_id === null));
  assert.equal(importedProject.color, '#18283c');
  assert(importedAssistants.some(x => x.instructions === a.instructions));
  assert.equal((await api(`/api/documents?assistant=${importedAssistants[0].id}`)).length, 0);
  // Cancel then confirm assistant deletion; siblings and unrelated projects survive.
  page.once('dialog', d => d.dismiss());
  await page.getByRole('button', { name: `Delete assistant ${importedAssistants[0].name}`, exact: true }).click();
  assert((await api('/api/workspace')).assistants.some(x => x.id === importedAssistants[0].id));
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: `Delete assistant ${importedAssistants[0].name}`, exact: true }).click();
  await until(async () => !(await api('/api/workspace')).assistants.some(x => x.id === importedAssistants[0].id));
  assert.equal((await api('/api/workspace')).assistants.filter(x => x.project_id === importedProject.id).length, 2);
  await page.getByRole('button', { name: 'Evento aggiornato', exact: true }).click();
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Configuration', exact: true }).click();
  assert.equal(await page.locator('.project-settings input[name=name]').inputValue(), 'Evento aggiornato');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor();
  workspace = await api('/api/workspace');
  assert(!workspace.projects.some(x => x.id === project.id));
  assert(!workspace.assistants.some(x => x.project_id === project.id));
  assert.equal((await request(`/api/conversations/${conversation.id}`)).status, 404);
  await assert.rejects(access(join(directory, 'data', 'files', doc.storage_path)));
  assert.equal((await api('/api/templates')).length, 5);
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Project bianco');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: 'Project bianco.' }).waitFor();
  assert.equal((await api('/api/workspace')).projects.find(x => x.name === 'Project bianco').color, '#FFFFFF');
  await page.getByRole('button', { name: /^Projects/ }).click();
  assert.equal(await page.getByText('Check Ollama', { exact: true }).count(), 0);
  const whiteCard = page.locator('.project-card').filter({ hasText: 'Project bianco' });
  assert.equal(await whiteCard.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  assert.match(await whiteCard.innerText(), /ASSISTANTS\s*0/);
  await page.screenshot({ path: 'test-results/project-flows/projects.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/project-flows/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Open project Project bianco', exact: true }).click();
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  assert(!(await page.getByRole('menuitem', { name: 'Import', exact: true }).isDisabled()));
  await page.getByRole('menuitem', { name: 'Import', exact: true }).click();
  const importBundle = { ...bundle, project: { ...bundle.project, name: 'Importazione nel progetto' } };
  page.once('dialog', d => d.accept());
  await page.getByLabel('Import template into project', { exact: true }).setInputFiles({ name: 'template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(importBundle)) });
  await page.getByRole('heading', { name: 'Importazione nel progetto.' }).waitFor();
  const importedInto = (await api('/api/workspace')).projects.find(p => p.name === 'Importazione nel progetto');
  assert.equal(importedInto.color, '#18283c');
  assert.equal((await api('/api/workspace')).assistants.filter(a => a.project_id === importedInto.id).length, 3);
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.screenshot({ path: 'test-results/project-flows/project-menu.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Delete template Computer Science Study', exact: true }).click();
  await until(async () => !(await api('/api/templates')).some(t => t.builtin_key === 'computer-science-study'));
  const custom = (await api('/api/templates')).find(t => t.name === 'Template importato');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Delete template Template importato', exact: true }).click();
  await until(async () => !(await api('/api/templates')).some(t => t.id === custom.id));
  assert((await api('/api/workspace')).projects.some(p => p.id === importedProject.id));
  assert.equal((await request('/api/projects', 'POST', { template_id: custom.id })).status, 404);
  assert.equal((await request(`/api/projects/${importedProject.id}`, 'PATCH', { name: 'Invalid', color: 'red' })).status, 400);
  await stop(); await start();
  assert(!(await api('/api/templates')).some(t => t.builtin_key === 'computer-science-study' || t.id === custom.id));
  assert((await api('/api/templates')).some(t => t.name === 'Evento riutilizzabile'));
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  console.log('PASS: real desktop UI/API/SQLite; template configuration, private-data exclusion, named export/import, deletion and restart, real cards, white default, sidebar, project editing/background, no project-list Ollama banner.');
} catch (error) {
  console.error(logs); throw error;
} finally {
  await browser?.close(); await stop(); ollama.closeAllConnections();
  await new Promise(r => ollama.close(r));
  await rm(directory, { recursive: true, force: true });
}
