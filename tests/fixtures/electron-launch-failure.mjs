// Synthetic faults only. The real Playwright launcher uses Node as an invalid
// Electron executable: no native Electron, display, sandbox or model is involved.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { runTest } from '../helpers/runtime.mjs';
import { launchElectron } from '../helpers/electron.mjs';

const mode = process.argv[2];
await runTest('electron-launch-fault', async run => {
  const profile = await run.tempDir();
  await writeFile(join(profile, 'siaas.sqlite'), 'OWNED SYNTHETIC DATABASE');
  console.log('FIXTURE:' + JSON.stringify({ out: run.out, profile }));
  if (mode === 'cleanup') {
    run.defer('injected cleanup failure', () => { throw new Error('Injected cleanup error'); });
    throw new Error('Injected failure with a broken cleanup callback');
  }
  if (mode === 'profile') throw new Error('Injected failure after profile creation');
  const options = { executablePath: process.execPath, profile, ollamaURL: 'http://127.0.0.1:1' };
  if (mode === 'playwright') return launchElectron(run, options);
  await launchElectron(run, options, async launchOptions => {
    assert.equal(launchOptions.chromiumSandbox, true);
    assert(launchOptions.args.includes(`--user-data-dir=${profile}`));
    assert.equal(launchOptions.env.SIAAS_DATA_DIR, undefined);
    if (mode === 'reject') throw new Error('Injected launch rejection before a process exists');
    if (mode === 'reject-empty') throw undefined; // A rejected promise need not carry an Error.
    const child = run.child(process.execPath, ['-e', 'console.log("OWNED CHILD READY"); setInterval(() => {}, 1000)']);
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.once('data', resolve);
    });
    if (mode === 'child') throw new Error('Injected launch rejection with an owned child');
    // Return an application connection but fail before page creation. The child
    // above is already registered; trackChild must not register it a second time.
    const context = {
      tracing: { start: async () => {}, stop: async () => {} },
      on() {},
      pages() { if (mode === 'diagnostic') throw new Error('Injected diagnostic failure'); return []; },
    };
    return {
      process: () => child,
      close: async () => {},
      context: () => context,
      firstWindow: async () => { throw new Error('Injected failure before page creation'); },
    };
  });
}, { timeout: 15000, mode: 'synthetic-electron-launch-fault/no-native-electron' });
