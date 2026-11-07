// Shared lifecycle utilities for the existing Node/Playwright scripts, not a test runner.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';

export class PrerequisiteError extends Error {}
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
export async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return server.address().port;
}
export async function freePort() {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}
export async function waitForReady(url, { child, headers = {}, timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = 'no response';
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null || child.spawnError)) {
      throw new Error(`Server exited before readiness: ${child.spawnError?.message || child.exitCode || child.signalCode}`);
    }
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))) });
      await response.body?.cancel();
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.message; }
    await delay(100);
  }
  throw new Error(`Server readiness timed out: ${url} (${last})`);
}
export function requireDisplay(env = process.env, platform = process.platform) {
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    throw new PrerequisiteError('Electron requires a graphical session. Use an existing desktop or xvfb-run -a npm run test:desktop:smoke on Linux.');
  }
  if (platform === 'linux' && process.getuid?.() === 0) {
    throw new PrerequisiteError('Run Electron as a non-root desktop user with its sandbox enabled.');
  }
}
export async function requireBuild() {
  try { await access(resolve('.next/standalone/server.js')); }
  catch { throw new PrerequisiteError('Missing desktop build: run npm run desktop:build.'); }
}
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'SIAAS_DATA_DIR', 'SIAAS_DESKTOP_KEY', 'SIAAS_DESKTOP_ORIGIN', 'SIAAS_RUNTIME', 'SIAAS_INSTALL_DIR', 'OLLAMA_HOST']) delete env[name];
  return { ...env, VERCEL: '0', NEXT_TELEMETRY_DISABLED: '1', ...extra };
}
export function chromiumOptions() {
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH;
  return { headless: true, ...(executablePath ? { executablePath } : {}) };
}
export async function launchBrowser(run, chromium) {
  const options = chromiumOptions();
  try { await access(options.executablePath || chromium.executablePath()); }
  catch { throw new PrerequisiteError('Chromium missing: run npx --no-install playwright install chromium, or set CHROMIUM_EXECUTABLE_PATH.'); }
  return run.browser(await chromium.launch(options));
}
function alive(pid, group = false) {
  try { process.kill(group && process.platform !== 'win32' ? -pid : pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
const stoppedChildren = new WeakSet();
export async function stopChild(child, { group = true, grace = 2000 } = {}) {
  if (!child?.pid || stoppedChildren.has(child)) return;
  const pid = child.pid;
  if (process.platform === 'win32') {
    // Terminate the owned tree while its root still exists. Never kill by image name.
    if (child.exitCode === null && child.signalCode === null) {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await bounded(new Promise((resolve, reject) => {
        killer.once('error', reject);
        killer.once('exit', code => code === 0 || !alive(pid) ? resolve() : reject(new Error(`taskkill failed: ${code}`)));
      }), 5000, 'taskkill');
    }
  } else {
    const signal = value => { try { process.kill(group ? -pid : pid, value); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    signal('SIGTERM');
    const deadline = Date.now() + grace;
    while (alive(pid, group) && Date.now() < deadline) await delay(50);
    if (alive(pid, group)) signal('SIGKILL');
  }
  // Checking state avoids the missed-exit race of subscribing only after kill().
  if (child.exitCode === null && child.signalCode === null) {
    await bounded(new Promise(resolve => child.once('exit', resolve)), 5000, `process ${pid} exit`);
  }
  stoppedChildren.add(child);
}

export async function runTest(name, body, { timeout = 180000, mode = 'mocked-ollama' } = {}) {
  const out = resolve('test-results', `${name}-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await mkdir(out, { recursive: true });
  const resources = [], directories = [], children = [], contexts = [];
  const trackedChildren = new WeakSet();
  const metadata = { name, mode, node: process.version, platform: process.platform, arch: process.arch, started: new Date().toISOString(), status: 'RUNNING', directories, children, cleanup: [] };
  let finished, closing, interrupted = false, pageIndex = 0;
  const log = (file, text) => writeFile(join(out, file), text);
  const run = {
    out, metadata,
    async tempDir() {
      const path = await mkdtemp(join(tmpdir(), `siaas-${name}-`));
      directories.push(path);
      return path;
    },
    defer(label, close) { resources.push({ label, close }); },
    async server(server) {
      run.defer('mock server', async () => {
        server.closeAllConnections?.();
        if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      });
      await listen(server);
      return server;
    },
    child(command, args, options = {}) {
      const child = spawn(command, args, { ...options, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      run.trackChild(child);
      return child;
    },
    trackChild(child) {
      if (trackedChildren.has(child)) return;
      trackedChildren.add(child);
      let output = '';
      const record = { pid: child.pid, command: child.spawnfile, args: child.spawnargs, exited: false };
      children.push(record);
      child.on('error', error => { child.spawnError = error; output += error.stack; });
      child.stdout?.on('data', data => { output = (output + data).slice(-262144); });
      child.stderr?.on('data', data => { output = (output + data).slice(-262144); });
      run.defer(`process ${child.pid}`, async () => {
        try { await stopChild(child); }
        finally {
          record.exited = child.exitCode !== null || child.signalCode !== null || !!child.spawnError;
          record.exitCode = child.exitCode; record.signal = child.signalCode;
          await log(`process-${children.indexOf(record)}.log`, output);
        }
      });
    },
    async browser(browser) {
      run.defer('browser', () => browser.close());
      return browser;
    },
    async context(context) {
      contexts.push(context);
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      context.on('page', page => run.page(page));
      for (const page of context.pages()) run.page(page);
      return context;
    },
    page(page) {
      let messages = '';
      const index = pageIndex++;
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(30000);
      page.on('console', msg => { messages = (messages + `${msg.type()}: ${msg.text()}\n`).slice(-131072); });
      page.on('pageerror', error => { messages += `${error.stack}\n`; });
      run.defer('renderer log', () => log(`renderer-${index}.log`, messages));
    },
    async finish(...errors) {
      if (closing) return closing;
      const failed = errors.length > 0, [error] = errors;
      closing = (async () => {
        metadata.status = failed ? error instanceof PrerequisiteError ? 'BLOCKED' : 'FAIL' : 'PASS';
        if (failed) { metadata.error = error?.stack || String(error); console.error(metadata.error); }
        // Persist the failure before diagnostics/cleanup. Final outcomes overwrite it.
        // A failed screenshot/trace must never prevent resource teardown or JSON.
        if (failed) await log('result.json', JSON.stringify(metadata, null, 2) + '\n').catch(writeError => {
          (metadata.diagnosticErrors ??= []).push(`Initial result write: ${writeError.message}`);
        });
        // Capture before closing pages; bounded operations cannot prevent teardown.
        for (const [i, context] of contexts.entries()) {
          try {
            if (failed) for (const [j, page] of context.pages().entries()) {
              await bounded(Promise.resolve().then(() => page.screenshot({ path: join(out, `failure-${i}-${j}.png`), timeout: 3000 })), 3500, 'screenshot');
            }
            await bounded(Promise.resolve().then(() => context.tracing.stop(failed ? { path: join(out, `trace-${i}.zip`) } : {})), 5000, 'trace');
          } catch (diagnosticError) {
            metadata.status = 'FAIL';
            (metadata.diagnosticErrors ??= []).push(diagnosticError?.stack || String(diagnosticError));
          }
        }
        for (const { label, close } of resources.reverse()) {
          try { await bounded(Promise.resolve().then(close), 10000, label); metadata.cleanup.push({ label, result: 'PASS' }); }
          catch (e) { metadata.status = 'FAIL'; metadata.cleanup.push({ label, result: 'FAIL', error: e.message }); }
        }
        for (const path of directories) {
          try { await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); metadata.cleanup.push({ label: path, result: 'PASS', removed: true }); }
          catch (e) { metadata.status = 'FAIL'; metadata.cleanup.push({ label: path, result: 'FAIL', error: e.message }); }
        }
        metadata.finished = new Date().toISOString();
        await log('result.json', JSON.stringify(metadata, null, 2) + '\n');
        console.log(`${metadata.status}: ${name} (${mode}); artifacts: ${out}`);
        finished = true;
        return metadata.status === 'PASS' ? 0 : metadata.status === 'BLOCKED' ? 2 : 1;
      })();
      return closing;
    },
  };
  const interrupt = async reason => {
    if (interrupted || finished) return;
    interrupted = true;
    // The standalone script must stop after cleanup: pending test awaits cannot resume.
    const emergency = setTimeout(() => process.exit(1), 45000);
    emergency.unref();
    process.exit(await run.finish(new Error(reason)));
  };
  const onInt = () => void interrupt('Interrupted by SIGINT');
  const onTerm = () => void interrupt('Interrupted by SIGTERM');
  const onMessage = message => {
    if (message?.type === 'siaas-test-stop') void interrupt(`Interrupted by ${message.signal}`);
  };
  process.on('message', onMessage);
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  const timer = setTimeout(() => void interrupt(`Suite timeout after ${timeout}ms`), timeout);
  try {
    await body(run);
    process.exitCode = await run.finish();
  } catch (error) { process.exitCode = await run.finish(error); }
  finally {
    clearTimeout(timer); process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); process.off('message', onMessage);
  }
  return metadata;
}
