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
