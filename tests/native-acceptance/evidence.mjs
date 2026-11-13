import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, renameSync, openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedPath } from './safety.mjs';
import { scenarioIds } from './lifecycle.mjs';
export const maximumBytes = 1024 * 1024;
const states = ['PASS', 'FAIL', 'BLOCKED', 'NOT RUN'];
const reasonCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,100}$(?![\s\S])/.test(value);
const fields = ['schemaVersion', 'repository', 'status', 'reason', 'target', 'role', 'applicationSha', 'workflowSha',
  'node', 'os', 'arch', 'image', 'scenarios', 'observations', 'processes', 'cleanup'];
export function validateReport(report) {
  assert(report && typeof report === 'object' && !Array.isArray(report), 'REPORT_OBJECT');
  assert.deepEqual(Object.keys(report).sort(), [...fields].sort(), 'REPORT_FIELDS');
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.repository, 'siaas-software/siaas-personal');
  assert(states.includes(report.status));
  assert(reasonCode(report.reason));
  assert(typeof report.target === 'string' && /^(linux|windows|macos)-(x64|arm64)$(?![\s\S])/.test(report.target));
  assert(['baseline', 'candidate'].includes(report.role));
  for (const field of ['applicationSha', 'workflowSha']) assert(typeof report[field] === 'string' && /^[a-f0-9]{40}$/.test(report[field]) && report[field].length === 40);
  for (const field of ['node', 'os', 'arch', 'image']) assert(typeof report[field] === 'string' && report[field].length <= 300);
  assert.deepEqual(report.scenarios.map(x => x.id), scenarioIds, 'SCENARIO_SET');
  for (const row of report.scenarios) {
    assert.deepEqual(Object.keys(row).sort(), ['id', 'reason', 'status']);
    assert(states.includes(row.status) && reasonCode(row.reason));
  }
  // Observations are constructed by the trusted harness, never arbitrary stdout/env.
  for (const [array, keys] of [[report.observations, ['kind', 'expected', 'observed']],
    [report.processes, ['pid', 'ppid', 'identity', 'executable', 'state', 'event']],
    [report.cleanup, ['path', 'removed', 'reason']]]) {
    assert(Array.isArray(array) && array.length <= 2000, 'EVIDENCE_ARRAY_LIMIT');
    for (const item of array) {
      assert.deepEqual(Object.keys(item).sort(), [...keys].sort(), 'EVIDENCE_RECORD_FIELDS');
      const string = value => typeof value === 'string' && value.length <= 4096 && !value.includes('\0');
      if (array === report.observations) assert(Object.values(item).every(string), 'OBSERVATION_TYPES');
      if (array === report.cleanup) {
        assert(string(item.path) && typeof item.removed === 'boolean' && string(item.reason), 'CLEANUP_TYPES');
        assert(reasonCode(item.reason), 'CLEANUP_REASON');
      }
      if (array === report.processes) {
        assert(Number.isSafeInteger(item.pid) && item.pid > 1 && Number.isSafeInteger(item.ppid) && item.ppid >= 0, 'PROCESS_PID');
        assert(string(item.identity) && item.identity.length > 0 && string(item.executable) && string(item.state) && item.state.length > 0, 'PROCESS_TYPES');
        assert(['OBSERVED', 'STATE', 'UNATTRIBUTED_LIVE', 'UNRESOLVED_ZOMBIE', 'OWNED_LIVE_REMAINS'].includes(item.event), 'PROCESS_EVENT');
      }
    }
  }
  if (report.status === 'PASS') assert(report.scenarios.every(row => row.status === 'PASS') &&
    report.cleanup.length > 0 && report.cleanup.every(row => row.removed === true) &&
    !report.processes.some(row => ['UNATTRIBUTED_LIVE', 'UNRESOLVED_ZOMBIE', 'OWNED_LIVE_REMAINS'].includes(row.event)), 'INCOMPLETE_ACCEPTANCE');
  assert(Buffer.byteLength(JSON.stringify(report)) <= maximumBytes, 'EVIDENCE_SIZE');
  return report;
}
export function validateJobBinding(report, config, { role, target, workflowSha }) {
  assert(['baseline', 'candidate'].includes(role), 'JOB_ROLE');
  assert(Object.hasOwn(config.platforms, target), 'JOB_TARGET');
  assert.equal(report.repository, config.repository, 'JOB_REPOSITORY_MISMATCH');
  assert.equal(report.role, role, 'JOB_ROLE_MISMATCH');
  assert.equal(report.target, target, 'JOB_TARGET_MISMATCH');
  assert.equal(report.applicationSha, config[role], 'JOB_REVISION_MISMATCH');
  assert.equal(report.workflowSha, workflowSha, 'WORKFLOW_REVISION_MISMATCH');
  assert.equal(report.arch, config.platforms[target].arch, 'JOB_ARCHITECTURE_MISMATCH');
}
export function roleReadyForComparison(report) {
  return report.status === 'BLOCKED' && report.reason === 'AWAITING_COMPARISON' &&
    report.scenarios.every(row => row.id === 'baseline-candidate-comparison' ? row.status === 'NOT RUN' : row.status === 'PASS') &&
    report.cleanup.length > 0 && report.cleanup.every(row => row.removed === true) &&
    !report.processes.some(row => ['UNRESOLVED_ZOMBIE', 'UNATTRIBUTED_LIVE', 'OWNED_LIVE_REMAINS'].includes(row.event));
}
export function writeReport(directory, report, workspace = resolve('.')) {
  validateReport(report);
  const base = resolve(directory);
  ownedPath(workspace, base);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const target = ownedPath(base, join(base, 'native.json'));
  const pending = ownedPath(base, join(base, '.pending'));
  writeFileSync(pending, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  assert(lstatSync(pending).size <= maximumBytes, 'EVIDENCE_SIZE');
  renameSync(pending, target);
}
export function validateArtifacts(directory, workspace = resolve('.')) {
  const base = resolve(directory);
  ownedPath(workspace, base);
  assert.deepEqual(readdirSync(base), ['native.json'], 'UNEXPECTED_ARTIFACT');
  const path = ownedPath(base, join(base, 'native.json'));
  const stat = lstatSync(path);
  assert(stat.isFile() && stat.nlink === 1 && stat.size <= maximumBytes, 'ARTIFACT_TYPE_OR_SIZE');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const before = fstatSync(fd);
    assert(before.isFile() && before.nlink === 1 && before.size <= maximumBytes && before.dev === stat.dev && before.ino === stat.ino, 'ARTIFACT_CHANGED');
    const bytes = Buffer.alloc(maximumBytes + 1); let used = 0, count;
    do { count = readSync(fd, bytes, used, bytes.length - used, null); used += count; } while (count > 0 && used < bytes.length);
    const after = fstatSync(fd);
    assert(used <= maximumBytes && used === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.nlink === 1, 'ARTIFACT_CHANGED');
    return validateReport(JSON.parse(bytes.subarray(0, used).toString('utf8')));
  } finally { closeSync(fd); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateArtifacts(process.argv[2]);
    const config = JSON.parse(readFileSync(new URL('./reviewed.json', import.meta.url)));
    validateJobBinding(result, config, { role: process.env.ACCEPTANCE_ROLE, target: process.env.ACCEPTANCE_TARGET, workflowSha: process.env.GITHUB_WORKFLOW_SHA });
    console.log('Validated exact bounded native.json; no native acceptance inferred.');
  }
  catch { console.error('ARTIFACT_VALIDATION_FAILED'); process.exitCode = 1; }
}
