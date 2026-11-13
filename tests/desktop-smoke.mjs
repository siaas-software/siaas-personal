// Infrastructure only: native startup/readiness, profile path, SQLite, restart, API guard.
// No model inference or new functional UI scenarios.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { runTest } from './helpers/runtime.mjs';
import { electronPrerequisites, launchElectron, closeElectron } from './helpers/electron.mjs';

await runTest('desktop-smoke', async run => {
  const executablePath = await electronPrerequisites();
  const profile = await run.tempDir();
  const mock = await run.server(createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/version' ? { version: '0.35.1' } : { models: [] }));
  }));
  const options = { executablePath, profile, ollamaURL: `http://127.0.0.1:${mock.address().port}` };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { app, page } = await launchElectron(run, options);
    assert.equal((await fetch(new URL('/api/workspace', page.url()), { signal: AbortSignal.timeout(5000) })).status, 403);
    assert.equal(await page.evaluate(async () => (await fetch('/api/workspace')).status), 200);
    await access(join(profile, 'siaas.sqlite'));
    await closeElectron(app);
  }
}, { mode: 'native-electron/mocked-ollama' });
