const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

test('source status and rollback keep personal data and do not create removed feature directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'siaas-rollback-'));
  try {
    const runtime = {version: process.versions.node, node: process.execPath, npm: process.execPath, binarySha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex')};
    const old = { runtime, version: '1.1.0', tag: 'v1.1.0', folder: 'old' };
    const current = { runtime, version: '1.2.0', tag: 'v1.2.0', folder: 'current', previous: old };
    const binary = process.platform === 'win32' ? 'SIAAS Personal.exe' : process.platform === 'darwin' ? 'SIAAS Personal.app/Contents/MacOS/SIAAS Personal' : 'siaas';
    for (const version of ['old', 'current']) {
      const file = join(root, 'versions', version, 'dist', 'unpacked', binary);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'Fixture only; never executed');
    }
    writeFileSync(join(root, 'current.json'), JSON.stringify(current));
    writeFileSync(join(root, 'personal.txt'), 'Preserve unknown content');
    const command = (action) => spawnSync(process.execPath, [resolve('scripts/source-manager.mjs'), action], { env: { ...process.env, HOME: root, APPDATA: root, SIAAS_INSTALL_DIR: root }, encoding: 'utf8' });
    const status = command('status'); assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).version, '1.2.0');
    const rollback = command('rollback'); assert.equal(rollback.status, 0, rollback.stderr);
    let state = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'));
    assert.equal(state.version, '1.1.0'); assert.equal(state.previous.version, '1.2.0');
    assert.equal(command('rollback').status, 0);
    state = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'));
    assert.equal(state.version, '1.2.0');
    assert.equal(readFileSync(join(root, 'personal.txt'), 'utf8'), 'Preserve unknown content');
    assert(!readdirSync(root).includes('.operation-lock'));
    const damaged = {...state, previous: {...state.previous, runtime: {...runtime, binarySha256: '0'.repeat(64)}}};
    writeFileSync(join(root, 'current.json'), JSON.stringify(damaged));
    assert.notEqual(command('rollback').status, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')), damaged);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
