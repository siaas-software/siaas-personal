// Synthetic receipts exercise comparison logic only; never native evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareEvidence, validateComparison, requiredFacts } from '../compare.mjs';
import { validateReport, roleReadyForComparison } from '../evidence.mjs';
import { initialScenarios } from '../lifecycle.mjs';
const config = JSON.parse(readFileSync(new URL('../reviewed.json', import.meta.url)));
const workflowSha = 'a'.repeat(40);
function fixture(role) {
  const report = { schemaVersion: 2, repository: config.repository, role, target: 'linux-x64', arch: 'x64', applicationSha: config[role], workflowSha,
    node: config.node, os: 'SYNTHETIC_OS', image: 'SYNTHETIC_IMAGE', status: 'BLOCKED', reason: 'AWAITING_COMPARISON',
    scenarios: initialScenarios().map(row => ({ ...row, status: row.id === 'baseline-candidate-comparison' ? 'NOT RUN' : 'PASS', reason: 'SYNTHETIC_FIXTURE' })),
    observations: [], processes: [], cleanup: [{ path: '/synthetic', removed: true, reason: 'UNIT' }] };
  for (const kind of requiredFacts) {
    const stable = kind.endsWith(':stable'), profile = stable ? 'native-default' : 'candidate';
    const value = kind.startsWith('metadata:') ? { version: '1.1.0-rc.3', tag: 'v1.1.0-rc.3', nodeVersion: config.node, profile, previousVersion: null } :
      kind.startsWith('launcher:') ? { name: stable ? 'siaas-personal.desktop' : 'launch-rc.sh', profile } :
      kind.startsWith('gui:') ? { visible: true, profile } : { lock: true, stages: 1 };
    report.observations.push({ kind: 'behavior:' + kind, expected: 'semantic-v1', observed: JSON.stringify(value) });
  }
  return report;
}
const compare = (a, b) => compareEvidence(a, b, config, 'linux-x64', workflowSha);
test('equivalent complete synthetic role receipts produce a comparison PASS, never self-attested role PASS', () => {
  const a = fixture('baseline'), b = fixture('candidate'); validateReport(a); assert(roleReadyForComparison(a));
  const receipt = compare(a, b); assert.equal(receipt.status, 'PASS'); validateComparison(receipt);
  assert.notEqual(receipt.baselineDigest, receipt.candidateDigest);
  assert.equal(a.scenarios.find(x => x.id === 'baseline-candidate-comparison').status, 'NOT RUN');
});
for (const field of ['repository', 'target', 'arch', 'applicationSha', 'workflowSha', 'role']) test('comparison rejects mismatched identity: ' + field, () => {
  const b = fixture('candidate'); b[field] = field.endsWith('Sha') ? 'b'.repeat(40) : 'untrusted';
  assert.throws(() => compare(fixture('baseline'), b));
});
for (const status of ['FAIL', 'BLOCKED', 'NOT RUN']) test('mandatory scenario prevents comparison PASS: ' + status, () => {
  const b = fixture('candidate'); b.scenarios.find(x => x.id === 'public-bootstrap').status = status;
  assert.notEqual(compare(fixture('baseline'), b).status, 'PASS'); assert.equal(roleReadyForComparison(b), false);
});
test('missing scenarios, duplicate rows, unknown fields and false cleanup cannot pass', () => {
  const b = fixture('candidate'); b.scenarios.pop(); assert.throws(() => compare(fixture('baseline'), b));
  const duplicate = fixture('candidate'); duplicate.scenarios[1] = duplicate.scenarios[0]; assert.throws(() => compare(fixture('baseline'), duplicate));
  const extra = fixture('candidate'); extra.secret = 'unit'; assert.throws(() => compare(fixture('baseline'), extra));
  const cleanup = fixture('candidate'); cleanup.cleanup[0].removed = false; assert.equal(compare(fixture('baseline'), cleanup).status, 'BLOCKED');
});
test('observed profile/launcher/metadata differences are compared, not just status labels', () => {
  const b = fixture('candidate'); const row = b.observations.find(x => x.kind === 'behavior:metadata:fresh');
  row.observed = JSON.stringify({ ...JSON.parse(row.observed), profile: 'native-default' });
  const result = compare(fixture('baseline'), b); assert.equal(result.status, 'FAIL');
  assert.equal(result.rows.find(x => x.id === 'behavior:metadata:fresh').reason, 'OBSERVED_BEHAVIOR_DIFFERS');
});
test('environment differences block regression attribution', () => {
  const b = fixture('candidate'); b.image = 'DIFFERENT_IMAGE'; b.scenarios[0].status = 'FAIL'; b.scenarios[0].reason = 'INSTALL_COMPLETION_MISSING';
  assert.equal(compare(fixture('baseline'), b).status, 'BLOCKED');
});
test('known application assertion failure is only a potential regression; shared failure is baseline evidence', () => {
  const b = fixture('candidate'); b.scenarios[0].status = 'FAIL'; b.scenarios[0].reason = 'INSTALL_COMPLETION_MISSING';
  assert.equal(compare(fixture('baseline'), b).rows.find(x => x.id === 'legacy-install').reason, 'POTENTIAL_APPLICATION_REGRESSION');
  const a = fixture('baseline'); a.scenarios[0] = { ...b.scenarios[0] };
  assert.equal(compare(a, b).rows.find(x => x.id === 'legacy-install').reason, 'SHARED_BASELINE_FAILURE');
});
test('missing, malformed and duplicate behavior observations cannot masquerade as equivalence', () => {
  const b = fixture('candidate'); b.observations.pop(); assert.equal(compare(fixture('baseline'), b).status, 'BLOCKED');
  const invalid = fixture('candidate'); invalid.observations[0].observed = '{'; assert.throws(() => compare(fixture('baseline'), invalid));
  const duplicate = fixture('candidate'); duplicate.observations.push(duplicate.observations[0]); assert.equal(compare(fixture('baseline'), duplicate).status, 'FAIL');
});
test('comparison receipt rejects forged PASS and altered row set', () => {
  const b = fixture('candidate'); b.scenarios[0].status = 'NOT RUN';
  const receipt = compare(fixture('baseline'), b); assert.throws(() => validateComparison({ ...receipt, status: 'PASS' }));
  receipt.rows.pop(); assert.throws(() => validateComparison(receipt));
});
test('role cleanup failures and terminal process records block completion', () => {
  const b = fixture('candidate'); b.processes.push({ pid: 42, ppid: 1, identity: '10', executable: '', state: 'Z', event: 'UNRESOLVED_ZOMBIE' });
  assert.equal(roleReadyForComparison(b), false); assert.equal(compare(fixture('baseline'), b).status, 'BLOCKED');
  const a = fixture('baseline'); a.scenarios.find(x => x.id === 'cleanup').status = 'BLOCKED';
  assert.equal(roleReadyForComparison(a), false);
});
test('a role cannot supply its own comparison PASS', () => {
  const a = fixture('baseline'); a.scenarios.find(x => x.id === 'baseline-candidate-comparison').status = 'PASS';
  assert.throws(() => compare(a, fixture('candidate')), /ROLE_CANNOT_SELF_ATTEST_COMPARISON/);
});

test('semantic JSON field ordering is irrelevant to behavior equivalence', () => {
  const b=fixture('candidate'),row=b.observations[0];
  row.observed=JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(row.observed)).reverse()));
  assert.equal(compare(fixture('baseline'),b).status,'PASS');
});

test('identical UNKNOWN runner images do not establish equivalent native environments', () => {
  const a=fixture('baseline'),b=fixture('candidate');a.image=b.image='UNKNOWN/UNKNOWN';
  assert.equal(compare(a,b).status,'BLOCKED');
  b.target='linux-x64\n';assert.throws(()=>validateReport(b));
});
