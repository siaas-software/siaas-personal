import { createRequire } from 'node:module';
import { readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { cleanEnv, requireBuild, requireDisplay, PrerequisiteError, bounded, stopChild } from './runtime.mjs';
const require = createRequire(import.meta.url);

export async function electronPrerequisites() {
  requireDisplay();
  await requireBuild();
  // Do not let require('electron') implicitly download a binary during a test.
  const root = dirname(require.resolve('electron/package.json'));
  try {
    const relative = (await readFile(join(root, 'path.txt'), 'utf8')).trim();
    const executable = join(root, 'dist', relative);
    await access(executable);
    return executable;
  } catch {
    throw new PrerequisiteError('Electron binary missing: run npx --no-install install-electron --no before testing.');
  }
}
export async function launchElectron(run, { executablePath, profile, ollamaURL }) {
  const app = await electron.launch({
    executablePath,
    args: [resolve('desktop/main.cjs'), `--user-data-dir=${profile}`],
    env: cleanEnv({
      SIAAS_NODE_EXECUTABLE: process.execPath,
      OLLAMA_BASE_URL: ollamaURL,
    }),
    timeout: 60000,
  });
  run.trackChild(app.process()); // Playwright launches a separate process group on POSIX.
  run.defer('Electron connection', async () => {
    // On Windows taskkill needs a living parent to identify the owned backend tree.
    if (process.platform === 'win32') await stopChild(app.process());
    await bounded(app.close(), 5000, 'Electron close').catch(() => {});
  });
  await run.context(app.context());
  const page = await app.firstWindow({ timeout: 60000 });
  await page.getByRole('heading', { name: 'Your projects.' }).waitFor({ timeout: 60000 });
  const actualProfile = await app.evaluate(({ app }) => app.getPath('userData'));
  if (resolve(actualProfile) !== resolve(profile)) throw new Error(`Unexpected Electron profile: ${actualProfile}`);
  run.metadata.electronProfile = actualProfile;
  return { app, page };
}
export async function closeElectron(app) {
  if (process.platform === 'win32') await stopChild(app.process());
  else await bounded(app.close(), 5000, 'Electron close').finally(() => stopChild(app.process()));
}
export async function realOllamaPrerequisites() {
  const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new PrerequisiteError('OLLAMA_BASE_URL must be an HTTP loopback origin without credentials.');
  }
  let models;
  try {
    const response = await fetch(new URL('/api/tags', url), { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    models = (await response.json()).models;
  } catch (error) { throw new PrerequisiteError(`Real Ollama unavailable at ${url.origin}: ${error.message}`); }
  if (!models?.some(m => m.name === 'embeddinggemma:latest') || !models.some(m => ['qwen2.5:1.5b', 'qwen2.5:7b', 'qwen2.5:14b'].includes(m.name))) {
    throw new PrerequisiteError('Real Electron acceptance requires embeddinggemma:latest and an installed supported chat model. Run npm run ollama:check.');
  }
  return url.origin;
}
