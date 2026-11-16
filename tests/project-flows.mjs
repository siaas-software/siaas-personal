// Acceptance test against the real standalone desktop HTTP server and SQLite.
// Only Ollama model discovery is simulated; no personal data or installed app is used.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

import { runTest, requireBuild, freePort, waitForReady, cleanEnv, launchBrowser, stopChild } from './helpers/runtime.mjs';

await runTest('project-flows', async run => {
await requireBuild();
const directory = await run.tempDir();
const ollama = createServer((req, res) => {
  if (req.url === "/api/show") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ capabilities: ["completion"] })); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ models: [
    { name: 'qwen2.5:1.5b', digest: 'a'.repeat(64) },
    { name: 'qwen2.5-coder:3b', digest: 'c'.repeat(64) },
    { name: 'embeddinggemma:latest', digest: 'b'.repeat(64) },
  ] }));
});
await run.server(ollama);
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const key = 'isolated-project-flows-test-key-000000';
const headers = { 'Content-Type': 'application/json', origin, 'x-siaas-desktop-key': key };
let server, browser, logs = '';
const pageErrors = [];
async function request(path, method = 'GET', body) {
  return fetch(origin + path, { method, headers, signal: AbortSignal.timeout(30000), body: body === undefined ? undefined : JSON.stringify(body) });
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
  server = run.child(process.execPath, [resolve('.next/standalone/server.js')], {
    env: cleanEnv({ NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      SIAAS_RUNTIME: 'desktop', SIAAS_DESKTOP_DEV: '1', SIAAS_DESKTOP_KEY: key,
      SIAAS_DESKTOP_ORIGIN: origin, SIAAS_DATA_DIR: join(directory, 'data'), VERCEL: '0',
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`, NEXT_TELEMETRY_DISABLED: '1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
  await waitForReady(origin, { child: server, headers });
}
async function stop() { await stopChild(server); }
  await start();
  browser = await launchBrowser(run, chromium);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, extraHTTPHeaders: { 'x-siaas-desktop-key': key } });
  await run.context(page.context());
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('**/api/local/hardware', route => route.fulfill({ json: {
    hardware: { ram: 16, gpu: 'cpu', vram: 0, disk: 100 },
    cpu: 'CPU test', gpuName: 'Grafica integrata', freeRam: 12, note: '',
  } }));
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor();
  assert.equal(await page.getByText('Check Ollama', { exact: true }).count(), 0);
  const templatesNav = page.locator('.sidebar nav').getByRole('button', { name: 'Templates', exact: true });
  const settingsNav = page.locator('.sidebar-bottom').getByRole('button', { name: 'Settings', exact: true });
  await settingsNav.click();
  await page.getByRole('heading', { name: 'Settings.', exact: true }).waitFor();
  assert.match(await settingsNav.getAttribute('class'), /\bactive\b/);
  await templatesNav.click();
  await page.getByRole('heading', { name: 'Templates.' }).waitFor();
  assert.match(await templatesNav.getAttribute('class'), /\bactive\b/);
  assert.doesNotMatch(await settingsNav.getAttribute('class'), /\bactive\b/);
  const initialTemplates = await api('/api/templates');
  const studyTemplate = initialTemplates.find(t => t.builtin_key === 'computer-science-study');
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
  await config.getByRole('radio', { name: 'Slate', exact: true }).check();
  await config.getByRole('button', { name: 'Save project' }).click();
  await page.getByRole('heading', { name: 'Evento aggiornato.' }).waitFor();
  await until(async () => await page.locator('main').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(233, 237, 241)');
  const configuredProject = (await api('/api/workspace')).projects.find(p => p.id === project.id);
  assert.equal(configuredProject.color, '#E9EDF1');
  assert.equal(configuredProject.description, 'Organizza il lancio del prodotto');

  await page.screenshot({ path: join(run.out, 'detail.png'), fullPage: true });
  const a = assistants[0];
  await page.locator('.resource-card').filter({ has: page.getByRole('heading', { name: a.name, exact: true }) }).locator('.assistant-card').click();
  await page.getByRole('tab', { name: 'Configuration', exact: true }).click();
  assert.equal(await page.getByRole('region', { name: 'Model catalog' }).count(), 0);
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  const catalog = page.getByRole('region', { name: 'Model catalog' });
  await until(async () => (await catalog.locator('.hardware-card').count()) === 12);
  // Guidance describes compatible sizes, not a recommended or best-installed model.
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  const advisor = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Find the right model', exact: true }) });
  const profiles = advisor.locator('.hardware-card');
  assert.deepEqual(await profiles.locator('.eyebrow').allTextContents(), ['Lightweight', 'Balanced', 'Advanced']);
  const lightweight = profiles.filter({ has: page.getByText('Lightweight', { exact: true }) });
  await catalog.getByLabel('Search models').fill('qwen2.5:');
  const qwenSizes = ['0.5', '1.5', '3', '7', '14', '32', '72'];
  await until(async () => await catalog.locator('.hardware-card').count() === qwenSizes.length);
  assert.deepEqual((await catalog.locator('.hardware-card code').allTextContents()).sort(), qwenSizes.map(size => `qwen2.5:${size}b`).sort());
  async function assertGuidance(compatibleSizes) {
    const displayedSizes = (await lightweight.getByRole('heading').innerText()).split(' · ');
    for (const size of qwenSizes) {
      const card = catalog.locator('.hardware-card').filter({ has: page.getByText(`qwen2.5:${size}b`, { exact: true }) });
      const fits = compatibleSizes.includes(size);
      // At 100 GB free disk the FP16 budgets for 32B/72B fail disk before RAM.
      const warning = ['32', '72'].includes(size) ? 'Insufficient disk space' : 'Insufficient RAM';
      assert.equal(await card.locator('.model-hardware-note').innerText(), fits
        ? 'CPU · slower response; GPU offload may be partial' : warning);
      assert.equal(await card.locator('.model-hardware-note.hardware-warning').count(), fits ? 0 : 1);
      if (Number(size) <= 3) assert.equal(displayedSizes.includes(`${size}B`), fits);
    }
    // Installed status is independent of whether the model fits the current budget.
    const installed = catalog.locator('.hardware-card').filter({ has: page.getByText('qwen2.5:1.5b', { exact: true }) });
    assert.equal(await installed.locator('.eyebrow').innerText(), 'INSTALLED');
    assert(await installed.getByRole('button', { name: 'Installed', exact: true }).isDisabled());
  }
  // The bundled entries have unknown quantization: conservative FP16 budgets apply.
  await assertGuidance(['0.5', '1.5', '3']);
  await page.screenshot({ path: join(run.out, 'assistant-config-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(run.out, 'assistant-config-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await advisor.getByLabel('Total RAM (GB)', { exact: true }).fill('8');
  await assertGuidance(['0.5']);
  await advisor.getByLabel('Total RAM (GB)', { exact: true }).fill('4');
  await assertGuidance([]);
  assert.deepEqual(await profiles.getByRole('heading').allTextContents(), Array(3).fill('No compatible sizes'));
  assert.deepEqual(await profiles.getByRole('status').allTextContents(), Array(3).fill('0 catalog entries fit the planning budget.'));
  await advisor.getByLabel('Total RAM (GB)', { exact: true }).fill('16');
  await assertGuidance(['0.5', '1.5', '3']);
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
  await page.screenshot({ path: join(run.out, 'model-config.png'), fullPage: true });
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
  assert.equal(bundle.project.color, '#E9EDF1');
  assert.equal(bundle.project.assistants.length, 3);
  assert(bundle.project.assistants.some(x => x.instructions === a.instructions && x.model === null));
  for (const assistant of bundle.project.assistants) {
    assert.equal(assistant.model, null);
    assert.deepEqual(assistant.sources, studyTemplate.assistants.find(x => x.name === assistant.name).sources);
  }
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
  assert.equal(importedProject.color, '#E9EDF1');
  assert(importedAssistants.some(x => x.instructions === a.instructions));
  assert.equal(importedAssistants.length, 3);
  async function assertImportedSources(assistantList) {
    for (const assistant of assistantList) {
      const documents = await api(`/api/documents?assistant=${assistant.id}`);
      const expected = bundle.project.assistants.find(x => x.name === assistant.name).sources;
      assert.deepEqual(documents.map(d => d.source_url).sort(), [...expected].sort());
      assert(documents.every(d => d.assistant_id === assistant.id && d.enabled));
      assert(!/PRIVATE CONTENT|Private.txt|MUST NOT IMPORT/.test(JSON.stringify(documents)));
    }
  }
  await assertImportedSources(importedAssistants);
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
  const remainingTemplates = await api('/api/templates');
  assert.equal(remainingTemplates.length, initialTemplates.length + 2);
  assert.deepEqual(remainingTemplates.filter(t => t.builtin_key).map(t => t.id).sort(), initialTemplates.map(t => t.id).sort());
  assert.deepEqual(remainingTemplates.filter(t => !t.builtin_key).map(t => t.name).sort(), ['Evento riutilizzabile', 'Template importato']);
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Project bianco');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: 'Project bianco.' }).waitFor();
  assert.equal((await api('/api/workspace')).projects.find(x => x.name === 'Project bianco').color, '#FFFFFF');
  await page.getByRole('button', { name: /^Projects/ }).click();
  assert.equal(await page.getByText('Check Ollama', { exact: true }).count(), 0);
  const whiteCard = page.locator('.project-card').filter({ hasText: 'Project bianco' });
  // Legacy white remains stored; project cards display its nearest accessible palette (Lavender).
  assert.equal(await whiteCard.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(240, 234, 254)');
  assert.equal((await api('/api/workspace')).projects.find(x => x.name === 'Project bianco').color, '#FFFFFF');
  assert.match(await whiteCard.innerText(), /ASSISTANTS\s*0/);
  await page.screenshot({ path: join(run.out, 'projects.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(run.out, 'mobile.png'), fullPage: true });
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
  assert.equal(importedInto.color, '#E9EDF1');
  const importedIntoAssistants = (await api('/api/workspace')).assistants.filter(a => a.project_id === importedInto.id);
  assert.equal(importedIntoAssistants.length, 3);
  await assertImportedSources(importedIntoAssistants);
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.screenshot({ path: join(run.out, 'project-menu.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await templatesNav.click();
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
  const beforeRestart = await api('/api/workspace');
  await stop(); await start();
  const afterRestart = await api('/api/workspace');
  assert.deepEqual(afterRestart.projects, beforeRestart.projects);
  assert.deepEqual(afterRestart.assistants, beforeRestart.assistants);
  assert(!(await api('/api/templates')).some(t => t.builtin_key === 'computer-science-study' || t.id === custom.id));
  assert((await api('/api/templates')).some(t => t.name === 'Evento riutilizzabile'));
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  console.log('PASS: real desktop UI/API/SQLite; template configuration, public-source preservation and private-data exclusion, named export/import, deletion and restart, accessible cards with stored white default, sidebar, project palette editing/background, responsive layout, model guidance/selection/persistence, no project-list Ollama banner.');
});
