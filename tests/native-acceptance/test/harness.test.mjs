// Unit tests of test infrastructure only. No native application, installer or download runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, linkSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePlan, requireHistory } from '../plan.mjs';
import { within, ownedPath, cleanEnvironment, verifyInstalled, versionOrder, Blocked } from '../safety.mjs';
import { validateReport, validateArtifacts, writeReport, maximumBytes } from '../evidence.mjs';
import { initialScenarios, exerciseLifecycle, scenarioIds } from '../lifecycle.mjs';
import { parseProc, parsePs, processKey, selectOwned, unattributed } from '../native-host.mjs';
import { NativeDriver } from '../driver.mjs';
const config = JSON.parse(readFileSync(new URL('../reviewed.json', import.meta.url)));
const context = { repository: config.repository, event: 'workflow_dispatch', hosted: 'github-hosted', workflowSha: 'a'.repeat(40), ref: 'refs/heads/main' };
const input = { baseline: config.baseline, candidate: config.candidate, platforms: 'linux-x64', authorization: 'PREPARATION_ONLY' };
const temporary = fn => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'siaas-infrastructure-unit-')));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
};
const report = () => ({ schemaVersion: 1, status: 'BLOCKED', reason: 'UNIT_FIXTURE', target: 'linux-x64', role: 'baseline', applicationSha: config.baseline,
  workflowSha: 'a'.repeat(40), node: '24.22.0', os: 'UNIT_FIXTURE', arch: 'x64', image: 'NO_NATIVE_RUN', scenarios: initialScenarios(), observations: [], processes: [], cleanup: [] });

test('closed gate and historical approvals remain absent', () => {
  assert.equal(config.executionEnabled, false);
  assert.deepEqual(config.historicalRevisions, { stable: null, previousCandidate: null });
  assert.throws(() => requireHistory(config), /HISTORICAL_REVISION_NOT_APPROVED/);
});
test('every target gets separate baseline/candidate jobs, with no free runner input', () => {
  for (const platforms of [...Object.keys(config.platforms), 'linux', 'windows', 'macos', 'all']) {
    const jobs = validatePlan(config, { ...input, platforms }, context).matrix.include;
    assert(jobs.length >= 2 && jobs.length <= 12);
    for (let i = 0; i < jobs.length; i += 2) {
      assert.equal(jobs[i].target, jobs[i + 1].target); assert.equal(jobs[i].role, 'baseline');
      assert.equal(jobs[i + 1].role, 'candidate'); assert.notEqual(jobs[i].sha, jobs[i + 1].sha);
      assert.equal(jobs[i].runner, config.platforms[jobs[i].target].runner);
    }
  }
});
for (const [label, bad] of Object.entries({ branch: { candidate: 'main' }, unapproved: { candidate: 'b'.repeat(40) }, uppercase: { candidate: config.candidate.toUpperCase() },
  newline: { candidate: config.candidate + '\n' }, swap: { baseline: config.candidate }, extra: { token: 'not-a-secret-fixture' },
  prototype: { platforms: '__proto__' }, paid: { platforms: 'macos-15-xlarge' }, selfHosted: { platforms: 'self-hosted' }, list: { platforms: 'linux-x64,windows-x64' },
  authorization: { authorization: 'RUN' }, missing: { candidate: undefined } })) {
  test('reject input: ' + label, () => assert.throws(() => validatePlan(config, { ...input, ...bad }, context)));
}
for (const bad of [{ event: 'push' }, { repository: 'untrusted/repo' }, { hosted: 'self-hosted' }, { workflowSha: 'a'.repeat(40) + '\n' }, { ref: 'refs/heads/develop' }]) {
  test('reject context: ' + JSON.stringify(bad), () => assert.throws(() => validatePlan(config, input, { ...context, ...bad })));
}
test('history slots require distinct approved revisions and channel-specific versions', () => {
  const historicalRevisions = { stable: { sha: 'b'.repeat(40), version: '1.0.0', approval: 'UNIT FIXTURE ONLY' },
    previousCandidate: { sha: 'c'.repeat(40), version: '1.1.0-rc.2', approval: 'UNIT FIXTURE ONLY' } };
  assert.deepEqual(requireHistory({ ...config, historicalRevisions }), historicalRevisions);
  for (const item of [{ sha: config.candidate }, { approval: '' }, { sha: 'main' }, { extra: true }]) {
    assert.throws(() => requireHistory({ ...config, historicalRevisions: { ...historicalRevisions, stable: { ...historicalRevisions.stable, ...item } } }));
  }
});
test('version ordering distinguishes a real upgrade from same-version reinstall', () => {
  assert.equal(versionOrder('1.1.0-rc.2', '1.1.0-rc.3'), -1);
  assert.equal(versionOrder('1.1.0-rc.3', '1.1.0-rc.3'), 0);
  assert.equal(versionOrder('1.1.0', '1.1.0-rc.3'), 1);
  assert.throws(() => versionOrder('latest', '1.0.0'));
});
test('path ownership rejects traversal, prefix confusion and symlinks', () => temporary(root => {
  assert(within(root, join(root, 'owned'))); assert(!within(root, root + '-other'));
  assert.throws(() => ownedPath(root, join(root, '..', 'outside')));
  symlinkSync(tmpdir(), join(root, 'link'), 'dir');
  assert.throws(() => ownedPath(root, join(root, 'link', 'file')));
}));
test('child environments keep trust settings, remove inherited credentials and own HOME', () => temporary(root => {
  const env = cleanEnvironment(root, { PATH: '/bin', GITHUB_TOKEN: 'fixture', AWS_SECRET_ACCESS_KEY: 'fixture', NODE_OPTIONS: '--inspect', NODE_PATH: '/outside',
    HOME: '/outside', ELECTRON_OVERRIDE_DIST_PATH: '/outside', NODE_EXTRA_CA_CERTS: '/approved-ca.pem', HTTPS_PROXY: 'https://proxy.invalid' });
  assert.equal(env.HOME, join(root, 'home')); assert.equal(env.USERPROFILE, env.HOME);
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/approved-ca.pem');
  for (const name of ['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_OVERRIDE_DIST_PATH']) assert(!(name in env));
}));
test('credential-bearing proxy is rejected before child execution', () => temporary(root => {
  assert.throws(() => cleanEnvironment(root, { HTTPS_PROXY: 'https://user:password@proxy.invalid' }), /CREDENTIAL_BEARING_PROXY/);
}));
test('installed file identity is checked against Git blob contents', () => temporary(root => {
  const dir = join(root, 'versions', '1.0.0-123'); mkdirSync(dir, { recursive: true });
  const bytes = Buffer.from('exact source\n'), path = join(dir, 'app.txt'); writeFileSync(path, bytes);
  const index = [{ path: 'app.txt', blob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') }];
  assert.equal(verifyInstalled(root, '1.0.0-123', index), dir);
  writeFileSync(path, 'tampered'); assert.throws(() => verifyInstalled(root, '1.0.0-123', index), /INSTALLED_SOURCE_MISMATCH/);
}));
test('profile snapshots detect content changes and reject linked files without starting an application', () => temporary(root => {
  const profile = join(root, 'profile'); mkdirSync(profile); writeFileSync(join(profile, 'user-data.txt'), 'keep');
  const driver = new NativeDriver({ root });
  const before = driver.profileDigest(profile);
  writeFileSync(join(profile, 'user-data.txt'), 'changed'); assert.notDeepEqual(driver.profileDigest(profile), before);
  symlinkSync(join(profile, 'user-data.txt'), join(profile, 'link'));
  assert.throws(() => driver.profileDigest(profile), /LINK_IN_OWNED_PATH/);
}));
test('process parser preserves birth identity, parent and zombie state', () => {
  const fields = ['Z', '1', ...Array(17).fill('0'), '900'];
  const p = parseProc('42', '42 (name with ) parentheses) ' + fields.join(' '), '');
  assert.equal(p.identity, '900'); assert.equal(p.ppid, 1); assert.equal(p.state, 'Z');
  const mac = parsePs('42 1 Tue Nov 10 12:00:00 2026 S /owned/App with spaces')[0];
  assert.equal(mac.executable, '/owned/App with spaces'); assert.throws(() => parsePs('malformed'));
});
test('ownership uses identity and ancestry, not command substrings or recycled PID', () => {
  const parent = { pid: 10, ppid: 1, identity: 'old', state: 'S', executable: '/system/node' };
  const rows = [{ ...parent, identity: 'new' }, { pid: 11, ppid: 1, identity: '2', state: 'S', executable: '/owned/app' },
    { pid: 12, ppid: 11, identity: '3', state: 'S', executable: '/system/helper' },
    { pid: 13, ppid: 1, identity: '4', state: 'S', executable: '/owned-other/app' }];
  assert.deepEqual(selectOwned(rows, ['/owned'], new Set([processKey(parent)])).map(p => p.pid), [11, 12]);
  assert.deepEqual(unattributed(rows, new Set([processKey(rows[0])]), selectOwned(rows, ['/owned'], new Set())).map(p => p.pid), [13]);
});
test('evidence refuses incomplete PASS, unknown fields and oversized payloads', () => {
  assert.throws(() => validateReport({ ...report(), status: 'PASS' }), /INCOMPLETE_ACCEPTANCE/);
  assert.throws(() => validateReport({ ...report(), environment: {} }), /REPORT_FIELDS/);
  assert.throws(() => validateReport({ ...report(), observations: [{ kind: 'x', expected: 'x', observed: 'x'.repeat(maximumBytes) }] }));
  const good = report(); good.status = 'PASS'; good.scenarios.forEach(row => { row.status = 'PASS'; }); good.cleanup.push({ path: '/unit', removed: true, reason: 'UNIT' });
  assert.equal(validateReport(good).status, 'PASS');
});
test('artifact selection rejects unexpected files, symlinks and hardlinks', () => temporary(root => {
  const dir = join(root, 'evidence'); writeReport(dir, report(), root); validateArtifacts(dir, root);
  writeFileSync(join(dir, 'extra.json'), '{}'); assert.throws(() => validateArtifacts(dir, root), /UNEXPECTED_ARTIFACT/); rmSync(join(dir, 'extra.json'));
  linkSync(join(dir, 'native.json'), join(root, 'second-link')); assert.throws(() => validateArtifacts(dir, root), /ARTIFACT_TYPE_OR_SIZE/); rmSync(join(root, 'second-link'));
  rmSync(join(dir, 'native.json')); writeFileSync(join(root, 'outside.json'), '{}'); symlinkSync(join(root, 'outside.json'), join(dir, 'native.json'));
  assert.throws(() => validateArtifacts(dir, root), /LINK_IN_OWNED_PATH/);
}));
function fakeDriver() {
  // Models only the scenario scheduler API; never represents native acceptance.
  const calls = [], versions = new Map();
  const generations = { target: { sha: 'a', version: '1.1.0-rc.3' }, previous: { sha: 'b', version: '1.1.0-rc.2' }, stable: { sha: 'c', version: '1.0.0' } };
  const driver = { calls, generations, async install(root, generation, action) { calls.push(['install', root, generation.version, action]); versions.set(root, generation.version); },
    async snapshot(root) { return versions.get(root); } };
  for (const name of ['verify', 'observe', 'stop', 'smoke', 'metadata', 'profile', 'launcher', 'noApplication', 'sentinels', 'userSentinel', 'previous',
    'checkUserSentinel', 'wrapper', 'dispatcher', 'isolation', 'retained', 'uninstalled', 'checkSentinels', 'invalidSource', 'exclusiveLock', 'interruption', 'rejectAdapter'])
    driver[name] = async (...args) => { calls.push([name, ...args]); };
  return driver;
}
test('lifecycle schedules real different-version update before rollback, never cleanup PASS itself', async () => {
  const driver = fakeDriver(), rows = initialScenarios(); await exerciseLifecycle(driver, rows);
  assert(rows.filter(x => !['cleanup', 'public-bootstrap', 'baseline-candidate-comparison'].includes(x.id)).every(x => x.status === 'PASS'));
  assert(rows.filter(x => ['cleanup', 'public-bootstrap', 'baseline-candidate-comparison'].includes(x.id)).every(x => x.status === 'NOT RUN'));
  assert.deepEqual(driver.calls.filter(x => x[0] === 'install' && x[1] === 'upgrade'),
    [['install', 'upgrade', '1.1.0-rc.2', 'install'], ['install', 'upgrade', '1.1.0-rc.3', 'update']]);
  assert(driver.calls.some(x => x[0] === 'wrapper' && x[2] === 'rollback'));
});
test('same-version update and absent history fail before any installation call', async () => {
  for (const missing of [false, true]) {
    const driver = fakeDriver();
    if (missing) driver.generations.previous = null; else driver.generations.previous.version = driver.generations.target.version;
    await assert.rejects(exerciseLifecycle(driver, initialScenarios())); assert.equal(driver.calls.length, 0);
  }
});
test('blocked GUI observation stops dependent scenarios without hiding completed checks', async () => {
  const driver = fakeDriver(); driver.observe = async () => { throw new Blocked('DISPLAY_UNAVAILABLE'); };
  const rows = initialScenarios(); await assert.rejects(exerciseLifecycle(driver, rows), /DISPLAY_UNAVAILABLE/);
  assert.equal(rows[0].status, 'PASS'); assert.equal(rows[1].status, 'BLOCKED'); assert.equal(rows[2].status, 'NOT RUN');
});
test('closed native entry point only emits BLOCKED evidence; no application or download is started', () => temporary(root => {
  const entry = fileURLToPath(new URL('../run.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [entry], { cwd: root, encoding: 'utf8', timeout: 15000,
    env: { PATH: process.env.PATH, GITHUB_WORKSPACE: root, ACCEPTANCE_TARGET: 'linux-x64', ACCEPTANCE_ROLE: 'baseline', GITHUB_WORKFLOW_SHA: 'a'.repeat(40) } });
  assert.equal(result.status, 2, result.stderr); assert.match(result.stdout, /PREPARATION_ONLY_POLICY_GATE/);
  assert.deepEqual(readdirSync(root), ['evidence-native']);
  const data = validateArtifacts(join(root, 'evidence-native'), root);
  assert.equal(data.status, 'BLOCKED'); assert(data.scenarios.every(row => row.status === 'BLOCKED'));
  assert.equal(data.processes.length, 0); assert.equal(data.observations.length, 0);
}));
