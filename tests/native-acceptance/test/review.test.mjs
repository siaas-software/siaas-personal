// Focused regression tests: synthetic process records/commands, disposable files only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeDriver } from '../driver.mjs';
import { ProcessAudit, selectOwned } from '../native-host.mjs';
import { validateReport, validateJobBinding, validateArtifacts, maximumBytes } from '../evidence.mjs';
import { initialScenarios } from '../lifecycle.mjs';
const config = JSON.parse(readFileSync(new URL('../reviewed.json', import.meta.url)));
const successful = () => ({ schemaVersion: 1, status: 'PASS', reason: 'UNIT_FIXTURE', target: 'linux-x64', role: 'baseline',
  applicationSha: config.baseline, workflowSha: 'a'.repeat(40), node: '24.22.0', os: 'UNIT', arch: 'x64', image: 'UNIT',
  scenarios: initialScenarios().map(row => ({ ...row, status: 'PASS', reason: 'UNIT' })), observations: [], processes: [],
  cleanup: [{ path: '/unit-only', removed: true, reason: 'UNIT' }] });

test('historical installation executes that generation manager; update executes the tested manager', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'siaas-review-')));
  try {
    const calls = [], historical = { sha: 'b'.repeat(40), tree: join(root, 'historical'), prepared: join(root, 'prepared'), version: '1.1.0-rc.2' };
    const target = { ...historical, sha: config.candidate, tree: join(root, 'target'), version: '1.1.0-rc.3' };
    const driver = new NativeDriver({ root, trees: { target: target.tree }, env: {}, report: { observations: [] },
      audit: { command: async (...args) => { calls.push(args); return 'Activated SIAAS Personal ' + (calls.length === 1 ? historical.version : target.version); } } });
    // Fixtures model already obtained profile proofs, not native isolation evidence.
    driver.profileProofs = new Set([historical.sha, target.sha]);
    await driver.install('upgrade', historical, 'install');
    await driver.install('upgrade', target, 'update');
    assert.equal(calls[0][2][0], join(historical.tree, 'scripts/source-manager.mjs'));
    assert.equal(calls[1][2][0], join(target.tree, 'scripts/source-manager.mjs'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('a new owned live process in the final quiescence sample blocks cleanup', async () => {
  const audit = Object.create(ProcessAudit.prototype);
  audit.report = { processes: [] }; audit.unattributed = []; audit.newZombies = [];
  audit.stop = async () => {};
  audit.sample = () => [{ pid: 4242, ppid: 1, identity: '100', state: 'S', executable: '/owned/child' }];
  await assert.rejects(audit.finish(), /OWNED_LIVE_PROCESS_REMAINS/);
});
test('PID reuse cannot adopt a child born before the newly owned parent', () => {
  const parent = { pid: 42, ppid: 1, identity: '900', state: 'S', executable: '/owned/new-parent' };
  const unrelated = { pid: 43, ppid: 42, identity: '800', state: 'S', executable: '/system/unrelated' };
  assert.deepEqual(selectOwned([parent, unrelated], ['/owned'], new Set()).map(p => p.pid), [42]);
});
for (const removed of ['false', 'true', 1, {}]) test('cleanup removed must be a boolean: ' + JSON.stringify(removed), () => {
  const report = successful(); report.cleanup[0].removed = removed;
  assert.throws(() => validateReport(report));
});
test('process records reject a string PID', () => {
  const report = successful(); report.processes.push({ pid: 'not-a-pid', ppid: 1, identity: '10', executable: '/unit', state: 'S', event: 'OBSERVED' });
  assert.throws(() => validateReport(report));
});

for (const status of ['FAIL', 'BLOCKED', 'NOT RUN']) test('incomplete scenario prevents PASS: ' + status, () => {
  const report = successful(); report.scenarios[0].status = status;
  assert.throws(() => validateReport(report), /INCOMPLETE_ACCEPTANCE/);
});
for (const event of ['UNATTRIBUTED_LIVE', 'UNRESOLVED_ZOMBIE', 'OWNED_LIVE_REMAINS']) test('unresolved process prevents PASS: ' + event, () => {
  const report = successful(); report.processes.push({ pid: 42, ppid: 1, identity: '10', executable: '/unit', state: 'S', event });
  assert.throws(() => validateReport(report), /INCOMPLETE_ACCEPTANCE/);
});
test('evidence cannot be substituted across roles, targets, architectures or workflow revisions', () => {
  const report = successful(), expected = { role: 'baseline', target: 'linux-x64', workflowSha: report.workflowSha };
  validateJobBinding(report, config, expected);
  for (const patch of [{ role: 'candidate', applicationSha: config.candidate }, { target: 'windows-x64' }, { arch: 'arm64' }, { workflowSha: 'b'.repeat(40) }])
    assert.throws(() => validateJobBinding({ ...report, ...patch }, config, expected));
  assert.throws(() => validateJobBinding(report, config, { ...expected, role: undefined }));
});
test('historical installation is blocked before commands without its own native profile proof', async () => {
  let commands = 0;
  const driver = new NativeDriver({ root: '/unused', audit: { command() { commands++; } } });
  driver.profileProofs.add(config.candidate);
  await assert.rejects(driver.install('stable', { sha: 'b'.repeat(40) }, 'install'), /GENERATION_PROFILE_PROOF_UNAVAILABLE/);
  assert.equal(commands, 0);
});
test('ambiguous ancestry is not a license to signal; ordered native timestamps permit attribution', () => {
  const parent = { pid: 42, ppid: 1, identity: '900', state: 'S', executable: '/owned/parent' };
  const child = { pid: 43, ppid: 42, identity: '901', state: 'S', executable: '/system/helper' };
  for (const identity of ['900', 'unknown', '899']) assert.equal(selectOwned([parent, { ...child, identity }], ['/owned'], new Set()).length, 1);
  for (const [p, c] of [['900', '901'], ['2026-11-13T10:00:00.0000000Z', '2026-11-13T10:00:01.0000000Z'],
    ['Fri Nov 13 10:00:00 2026', 'Fri Nov 13 10:00:01 2026']]) {
    assert.equal(selectOwned([{ ...parent, identity: p }, { ...child, identity: c }], ['/owned'], new Set()).length, 2);
    assert.equal(selectOwned([{ ...parent, identity: c }, { ...child, identity: p }], ['/owned'], new Set()).length, 1);
  }
});

test('artifact reader rejects malformed JSON and oversized files before accepting evidence', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'siaas-review-artifact-')));
  try {
    const dir = join(root, 'evidence'); mkdirSync(dir);
    const file = join(dir, 'native.json'); writeFileSync(file, '{');
    assert.throws(() => validateArtifacts(dir, root), SyntaxError);
    writeFileSync(file, ' '.repeat(maximumBytes + 1));
    assert.throws(() => validateArtifacts(dir, root), /ARTIFACT_TYPE_OR_SIZE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
for (const kind of ['unattributed', 'newZombies', 'clear']) test('final cleanup classification: ' + kind, async () => {
  const audit = Object.create(ProcessAudit.prototype);
  audit.report = { processes: [] }; audit.unattributed = []; audit.newZombies = [];
  audit.stop = async () => {}; audit.sample = () => [];
  if (kind !== 'clear') audit[kind] = [{ pid: 42, ppid: 1, identity: '10', state: kind === 'newZombies' ? 'Z' : 'S', executable: '' }];
  if (kind === 'clear') await audit.finish();
  else await assert.rejects(audit.finish(), kind === 'newZombies' ? /UNEXPLAINED_NEW_ZOMBIES/ : /UNATTRIBUTED_NEW_PROCESSES/);
});

test('reason codes reject scalar coercion and trailing newlines', () => {
  for (const reason of [123, 'UNIT\n']) {
    const report = successful(); report.reason = reason;
    assert.throws(() => validateReport(report));
    const scenario = successful(); scenario.scenarios[0].reason = reason;
    assert.throws(() => validateReport(scenario));
  }
});
