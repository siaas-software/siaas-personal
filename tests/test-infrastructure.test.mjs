import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bounded, cleanEnv, listen, requireDisplay, stopChild, waitForReady } from './helpers/runtime.mjs';

async function running(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')) return false;
    }
    return true;
  } catch (error) { if (['ESRCH', 'ENOENT'].includes(error.code)) return false; throw error; }
}
test('environment guard preserves security and rejects absent Linux display', () => {
  assert.throws(() => requireDisplay({}, 'linux'), /graphical session/);
  assert.doesNotThrow(() => requireDisplay({}, 'win32'));
  const prior = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = '1';
  try { assert.equal(cleanEnv().ELECTRON_RUN_AS_NODE, undefined); }
  finally { if (prior === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = prior; }
});
test('readiness rejects early exit and nonresponsive HTTP within the deadline', async () => {
  await assert.rejects(waitForReady('http://127.0.0.1:1', { child: { exitCode: 1, signalCode: null } }), /exited before readiness/);
  const server = createServer(() => {});
  const port = await listen(server);
  try {
    await assert.rejects(bounded(waitForReady(`http://127.0.0.1:${port}`, { timeout: 200 }), 2000, 'test deadline'), /readiness timed out/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('cleanup handles an already exited child without a missed-exit hang', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { detached: process.platform !== 'win32', stdio: 'ignore' });
  await new Promise(resolve => child.once('exit', resolve));
  await bounded(stopChild(child), 3000, 'already exited child');
});
for (const mode of ['throw', 'timeout', 'signal']) {
  test(`${mode}: removes isolated SQLite directory and stops owned child tree, preserving unrelated data`, { timeout: 20000 }, async () => {
    const unrelated = await mkdtemp(join(tmpdir(), 'siaas-unrelated-'));
    const sentinel = join(unrelated, 'siaas.sqlite');
    await writeFile(sentinel, 'USER DATA MUST SURVIVE');
    const child = spawn(process.execPath, ['tests/fixtures/runtime-failure.mjs', mode], {
      env: { ...process.env, SIAAS_DATA_DIR: unrelated }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    try {
      const code = await bounded(new Promise((resolve, reject) => {
        child.once('error', reject); child.once('exit', resolve);
      }), 15000, 'fault fixture');
      assert.equal(code, 1, output);
      const match = output.match(/FIXTURE:(.+)/);
      assert(match, output);
      const fixture = JSON.parse(match[1]);
      const report = JSON.parse(await readFile(join(fixture.out, 'result.json'), 'utf8'));
      assert.equal(report.status, 'FAIL');
      assert(report.cleanup.length > 0);
      assert(report.cleanup.every(item => item.result === 'PASS'), JSON.stringify(report));
      await assert.rejects(access(fixture.directory), { code: 'ENOENT' });
      assert.equal(await running(fixture.pid), false, `child ${fixture.pid} still running`);
      assert.equal(await running(fixture.grandchild), false, `grandchild ${fixture.grandchild} still running`);
      assert.equal(await readFile(sentinel, 'utf8'), 'USER DATA MUST SURVIVE');
    } finally { child.kill(); await rm(unrelated, { recursive: true, force: true }); }
  });
}

for (const mode of ['profile', 'reject', 'reject-empty', 'child', 'page', 'diagnostic', 'cleanup', 'playwright']) {
  test(`early Electron failure (${mode}): FAIL artifacts, owned cleanup and unrelated data survive repeated launches`, { timeout: 60000 }, async () => {
    const unrelated = await mkdtemp(join(tmpdir(), 'siaas-unrelated-electron-'));
    const sentinel = join(unrelated, 'siaas.sqlite');
    const profileSentinel = join(unrelated, 'Preferences');
    await writeFile(sentinel, 'UNRELATED SQLITE MUST SURVIVE');
    await writeFile(profileSentinel, 'UNRELATED PROFILE MUST SURVIVE');
    const seen = new Set();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const child = spawn(process.execPath, ['--unhandled-rejections=strict', 'tests/fixtures/electron-launch-failure.mjs', mode], {
          env: { ...process.env, SIAAS_DATA_DIR: unrelated }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        try {
          const code = await bounded(new Promise((resolve, reject) => {
            child.once('error', reject); child.once('exit', resolve);
          }), 18000, 'Electron failure fixture');
          assert.equal(code, 1, output);
          const match = output.match(/FIXTURE:(.+)/);
          assert(match, output);
          const fixture = JSON.parse(match[1]);
          assert(!seen.has(fixture.profile)); seen.add(fixture.profile);
          const report = JSON.parse(await readFile(join(fixture.out, 'result.json'), 'utf8'));
          assert.equal(report.status, 'FAIL', output);
          assert.equal(report.mode, 'synthetic-electron-launch-fault/no-native-electron');
          assert(report.error, JSON.stringify(report));
          assert(report.finished);
          assert.deepEqual(report.directories, [fixture.profile]);
          assert(report.cleanup.some(item => item.label === fixture.profile && item.removed));
          const cleanupFailures = report.cleanup.filter(item => item.result !== 'PASS');
          assert.equal(cleanupFailures.length, mode === 'cleanup' ? 1 : 0, JSON.stringify(report));
          if (mode === 'cleanup') assert.equal(cleanupFailures[0].label, 'injected cleanup failure');
          await assert.rejects(access(fixture.profile), { code: 'ENOENT' });
          assert(!output.includes('UnhandledPromiseRejection'), output);
          assert(output.includes('FAIL: electron-launch-fault'), output);
          const hasChild = ['child', 'page', 'diagnostic'].includes(mode);
          assert.equal(report.children.length, hasChild ? 1 : 0);
          for (const owned of report.children) {
            assert(owned.exited, JSON.stringify(owned));
            assert.equal(await running(owned.pid), false);
            assert((await readFile(join(fixture.out, 'process-0.log'), 'utf8')).includes('OWNED CHILD READY'));
          }
          if (!['profile', 'cleanup'].includes(mode)) {
            const launch = report.electronLaunches[0];
            assert.equal(launch.profile, fixture.profile);
            assert.equal(launch.chromiumSandbox, true);
            assert.equal(launch.status, ['page', 'diagnostic'].includes(mode) ? 'LAUNCHED' : 'FAIL');
            if (launch.status === 'FAIL') assert(launch.error);
          }
          if (mode === 'diagnostic') assert(report.diagnosticErrors.some(error => error.includes('Injected diagnostic failure')));
          if (mode === 'playwright') {
            // Exercise the actual dependency's concurrent endpoint promises and
            // process cleanup, not just an injected Promise.reject at our API.
            assert(report.error.includes('Process failed to launch!'), report.error);
            assert(!report.error.includes('--no-sandbox'), report.error);
            const launched = report.error.match(/<launched> pid=(\d+)/);
            assert(launched, report.error);
            assert.equal(await running(Number(launched[1])), false);
          }
          assert.equal(await readFile(sentinel, 'utf8'), 'UNRELATED SQLITE MUST SURVIVE');
          assert.equal(await readFile(profileSentinel, 'utf8'), 'UNRELATED PROFILE MUST SURVIVE');
        } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
      }
    } finally { await rm(unrelated, { recursive: true, force: true }); }
  });
}
