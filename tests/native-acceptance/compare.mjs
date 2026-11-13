// Offline comparison stage: validates receipts; never executes application code.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { validateReport, validateJobBinding, validateArtifacts, maximumBytes, roleReadyForComparison } from './evidence.mjs';
import { scenarioIds } from './lifecycle.mjs';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const sha256 = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const comparable = scenarioIds.filter(id => id !== 'baseline-candidate-comparison');
export const requiredFacts = ['metadata:fresh', 'metadata:upgrade', 'metadata:stable', 'launcher:fresh', 'launcher:upgrade', 'launcher:stable',
  'gui:fresh', 'gui:upgrade', 'gui:stable', 'interruption'];
const closed = (item, keys) => assert.deepEqual(Object.keys(item).sort(), [...keys].sort(), 'BEHAVIOR_FIELDS');
export function behaviorFacts(report) {
  const result = {};
  for (const row of report.observations.filter(row => row.kind.startsWith('behavior:'))) {
    const kind = row.kind.slice(9); assert(requiredFacts.includes(kind), 'UNKNOWN_BEHAVIOR_FACT');
    assert.equal(row.expected, 'semantic-v1'); const value = JSON.parse(row.observed);
    if (kind.startsWith('metadata:')) {
      closed(value, ['version', 'tag', 'nodeVersion', 'profile', 'previousVersion']);
      for (const k of ['version', 'nodeVersion']) assert(typeof value[k] === 'string' && /^\d+\.\d+\.\d+(?:-rc\.\d+)?$(?![\s\S])/.test(value[k]));
      assert.equal(value.tag, 'v' + value.version);
      assert(['candidate', 'native-default'].includes(value.profile));
      assert(value.previousVersion === null || (typeof value.previousVersion === 'string' && /^\d+\.\d+\.\d+(?:-rc\.\d+)?$(?![\s\S])/.test(value.previousVersion)));
    } else if (kind.startsWith('launcher:')) {
      closed(value, ['name', 'profile']); assert(['candidate', 'native-default'].includes(value.profile));
      assert(['launch-rc.cmd', 'launch-rc.sh', 'SIAAS Personal.cmd', 'SIAAS Personal.command', 'siaas-personal.desktop'].includes(value.name));
    } else if (kind.startsWith('gui:')) {
      closed(value, ['visible', 'profile']); assert.equal(value.visible, true); assert(['candidate', 'native-default'].includes(value.profile));
    } else {
      closed(value, ['lock', 'stages']); assert.equal(typeof value.lock, 'boolean'); assert(Number.isSafeInteger(value.stages) && value.stages >= 0 && value.stages <= 100);
    }
    (result[kind] ||= []).push(value); assert(result[kind].length <= 20, 'BEHAVIOR_COUNT');
  }
  return result;
}
export function compareEvidence(baseline, candidate, config, target, workflowSha) {
  for (const [role, report] of [['baseline', baseline], ['candidate', candidate]]) {
    validateReport(report); validateJobBinding(report, config, { role, target, workflowSha });
    assert.equal(report.repository, config.repository, 'REPOSITORY_MISMATCH');
    const own = report.scenarios.find(x => x.id === 'baseline-candidate-comparison');
    assert(own.status !== 'PASS', 'ROLE_CANNOT_SELF_ATTEST_COMPARISON');
  }
  const receipt = { schemaVersion: 1, kind: 'native-comparison', repository: config.repository, target,
    arch: config.platforms[target].arch, workflowSha, baselineSha: baseline.applicationSha, candidateSha: candidate.applicationSha,
    baselineDigest: sha256(baseline), candidateDigest: sha256(candidate), status: 'BLOCKED', reason: 'INCOMPLETE_EVIDENCE', rows: [] };
  const environmentsMatch = ['node', 'os', 'arch', 'image'].every(k => baseline[k] === candidate[k]) &&
    baseline.node === config.node && baseline.os.length > 0 && baseline.image.length > 0 && !baseline.image.includes('UNKNOWN') && !['NO_NATIVE_RUN', 'UNIT'].includes(baseline.image);
  receipt.rows.push({ id: 'environment', status: environmentsMatch ? 'PASS' : 'BLOCKED', reason: environmentsMatch ? 'EQUIVALENT_ENVIRONMENTS' : 'ENVIRONMENT_NOT_COMPARABLE' });
  const assertionFailures = new Set(['INSTALL_COMPLETION_MISSING', 'REPEAT_CHANGED_METADATA', 'STABLE_CHANGED_CANDIDATE', 'UNINSTALL_CHANGED_PROFILE']);
  for (const id of comparable) {
    const a = baseline.scenarios.find(x => x.id === id), b = candidate.scenarios.find(x => x.id === id);
    let status = 'BLOCKED', reason = 'INSUFFICIENT_EVIDENCE';
    if (a.status === 'PASS' && b.status === 'PASS') { status = 'PASS'; reason = 'BOTH_ASSERTIONS_COMPLETED'; }
    else if (a.status === 'PASS' && b.status === 'FAIL' && environmentsMatch && assertionFailures.has(b.reason)) { status = 'FAIL'; reason = 'POTENTIAL_APPLICATION_REGRESSION'; }
    else if (a.status === 'FAIL' && b.status === 'FAIL' && a.reason === b.reason) reason = 'SHARED_BASELINE_FAILURE';
    else if ([a.status, b.status].includes('BLOCKED')) reason = 'PREREQUISITE_OR_ENVIRONMENT_BLOCKER';
    receipt.rows.push({ id, status, reason });
  }
  for (const [role, report] of [['baseline', baseline], ['candidate', candidate]]) {
    const ready = roleReadyForComparison(report);
    receipt.rows.push({ id: role + '-envelope', status: ready ? 'PASS' : 'BLOCKED', reason: ready ? 'VALIDATED_ROLE_COMPLETION' : 'ROLE_INCOMPLETE' });
  }
  const aFacts = behaviorFacts(baseline), bFacts = behaviorFacts(candidate);
  for (const kind of requiredFacts) {
    const a = aFacts[kind], b = bFacts[kind];
    const equal = a && b && isDeepStrictEqual(a, b);
    receipt.rows.push({ id: 'behavior:' + kind, status: !a || !b ? 'BLOCKED' : equal ? 'PASS' : environmentsMatch ? 'FAIL' : 'BLOCKED',
      reason: !a || !b ? 'BEHAVIOR_EVIDENCE_MISSING' : equal ? 'EQUIVALENT_OBSERVATIONS' : 'OBSERVED_BEHAVIOR_DIFFERS' });
  }
  receipt.status = receipt.rows.some(x => x.status === 'FAIL') ? 'FAIL' : receipt.rows.every(x => x.status === 'PASS') ? 'PASS' : 'BLOCKED';
  receipt.reason = receipt.status === 'PASS' ? 'EQUIVALENT_ACCEPTANCE_EVIDENCE' : receipt.status === 'FAIL' ? 'DIFFERENCE_REQUIRES_REVIEW' : 'INCOMPLETE_EVIDENCE';
  return validateComparison(receipt);
}
export function validateComparison(receipt) {
  closed(receipt, ['schemaVersion', 'kind', 'repository', 'target', 'arch', 'workflowSha', 'baselineSha', 'candidateSha', 'baselineDigest', 'candidateDigest', 'status', 'reason', 'rows']);
  assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.kind, 'native-comparison');
  assert.equal(receipt.repository, 'siaas-software/siaas-personal');
  assert(/^(linux|windows|macos)-(x64|arm64)$(?![\s\S])/.test(receipt.target));
  assert.equal(receipt.arch, receipt.target.split('-')[1]);
  for (const key of ['workflowSha', 'baselineSha', 'candidateSha']) assert(typeof receipt[key] === 'string' && /^[a-f0-9]{40}$(?![\s\S])/.test(receipt[key]));
  for (const key of ['baselineDigest', 'candidateDigest']) assert(typeof receipt[key] === 'string' && /^[a-f0-9]{64}$(?![\s\S])/.test(receipt[key]));
  assert.deepEqual(receipt.rows.map(x => x.id), ['environment', ...comparable, 'baseline-envelope', 'candidate-envelope', ...requiredFacts.map(k => 'behavior:' + k)]);
  for (const row of receipt.rows) { closed(row, ['id', 'status', 'reason']); assert(['PASS', 'FAIL', 'BLOCKED'].includes(row.status)); assert(/^[A-Z0-9_]{1,100}$(?![\s\S])/.test(row.reason)); }
  const status = receipt.rows.some(x => x.status === 'FAIL') ? 'FAIL' : receipt.rows.every(x => x.status === 'PASS') ? 'PASS' : 'BLOCKED';
  assert.equal(receipt.status, status); assert.equal(receipt.reason, status === 'PASS' ? 'EQUIVALENT_ACCEPTANCE_EVIDENCE' : status === 'FAIL' ? 'DIFFERENCE_REQUIRES_REVIEW' : 'INCOMPLETE_EVIDENCE');
  assert(Buffer.byteLength(JSON.stringify(receipt)) <= maximumBytes); return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [base, candidate, target, output] = process.argv.slice(2); assert.equal(process.argv.length, 6);
    const config = JSON.parse(readFileSync(new URL('./reviewed.json', import.meta.url)));
    const result = compareEvidence(validateArtifacts(base), validateArtifacts(candidate), config, target, process.env.GITHUB_WORKFLOW_SHA);
    const bytes = JSON.stringify(result, null, 2) + '\n'; assert(Buffer.byteLength(bytes) <= maximumBytes);
    writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
    console.log(result.status + ': ' + result.reason); process.exitCode = result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2;
  } catch { console.error('COMPARISON_INPUT_INVALID'); process.exitCode = 2; }
}
