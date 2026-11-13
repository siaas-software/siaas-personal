// Disabled native entry point. No local application tests call this past its gate.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, realpathSync, writeFileSync, existsSync, rmSync, statfsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import { requireHistory } from './plan.mjs';
import { Blocked, digest, ownedPath, cleanEnvironment } from './safety.mjs';
import { ProcessAudit } from './native-host.mjs';
import { NativeDriver } from './driver.mjs';
import { initialScenarios, exerciseLifecycle } from './lifecycle.mjs';
import { writeReport } from './evidence.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'reviewed.json')));
const workspace = resolve(process.env.GITHUB_WORKSPACE || '.');
const role = process.env.ACCEPTANCE_ROLE || 'baseline';
const target = process.env.ACCEPTANCE_TARGET || 'linux-x64';
const report = { schemaVersion: 1, status: 'BLOCKED', reason: 'PREPARATION_ONLY_POLICY_GATE', target, role,
  applicationSha: config[role] || config.baseline, workflowSha: process.env.GITHUB_WORKFLOW_SHA || config.mainBaseline,
  node: process.versions.node, os: `${process.platform} ${os.release()} ${os.version()}`, arch: process.arch,
  image: `${process.env.ImageOS || 'UNKNOWN'}/${process.env.ImageVersion || 'UNKNOWN'}`,
  scenarios: initialScenarios(), observations: [], processes: [], cleanup: [] };
const persist = () => writeReport(join(workspace, 'evidence-native'), report);
let root, audit, driver, owner;
try {
  if (config.executionEnabled !== true) throw new Blocked('PREPARATION_ONLY_POLICY_GATE');
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      process.env.GITHUB_REPOSITORY !== config.repository || process.env.GITHUB_REF !== 'refs/heads/main' ||
      process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw new Blocked('UNTRUSTED_WORKFLOW_CONTEXT');
  try { requireHistory(config); } catch { throw new Blocked('HISTORICAL_REVISION_NOT_APPROVED'); }
  const platform = config.platforms[target];
  if (!platform || !['baseline', 'candidate'].includes(role) || platform.os !== process.platform ||
      platform.arch !== process.arch || config.node !== process.versions.node) throw new Blocked('NATIVE_RUNTIME_MISMATCH');
  const machines = { x64: ['x86_64', 'amd64'], arm64: ['aarch64', 'arm64'] };
  if (!machines[platform.arch].includes(os.machine().toLowerCase())) throw new Blocked('HOST_ARCHITECTURE_MISMATCH');
  if (process.platform === 'darwin') {
    const translated = spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8', timeout: 5000 });
    if (translated.stdout?.trim() === '1') throw new Blocked('TRANSLATED_PROCESS');
  }
  if (process.platform === 'linux' && (!process.env.DISPLAY || process.getuid() === 0)) throw new Blocked('SANDBOXED_DISPLAY_UNAVAILABLE');
  const space = statfsSync(workspace);
  if (space.bavail * space.bsize < 10 * 1024 ** 3 || os.freemem() < 4 * 1024 ** 3) throw new Blocked('RESOURCE_HEADROOM_UNAVAILABLE');
  const vendor = join(here, 'vendor/pr20');
  const provenance = JSON.parse(readFileSync(join(vendor, 'provenance.json')));
  for (const [path, info] of Object.entries(provenance.files)) assert.equal(digest(readFileSync(join(vendor, path))), info.sha256, 'HARNESS_INTEGRITY');
  const trees = { target: join(workspace, 'application'), stable: join(workspace, 'historical-stable'), previous: join(workspace, 'historical-previous') };
  for (const tree of Object.values(trees)) {
    assert.equal(realpathSync(tree), tree, 'CHECKOUT_CANONICAL_PATH');
    const headers = spawnSync('git', ['config', '--local', '--get-regexp', 'http\\..*extraheader'], { cwd: tree, stdio: 'ignore' });
    assert.equal(headers.status, 1, 'CHECKOUT_CREDENTIAL_STATE');
  }
  const temporary = realpathSync(process.env.RUNNER_TEMP);
  root = realpathSync(mkdtempSync(join(temporary, 'siaas-native-')));
  owner = randomUUID(); writeFileSync(join(root, '.owner'), owner, { flag: 'wx', mode: 0o600 });
  const env = cleanEnvironment(root);
  report.observations.push({ kind: 'native-machine', expected: platform.arch, observed: os.machine() });
  audit = new ProcessAudit([root, trees.target], report);
  driver = new NativeDriver({ root, env, audit, report, config, trees, sha: config[role], vendor });
  persist();
  await driver.initialize();
  await exerciseLifecycle(driver, report.scenarios, persist);
  if (report.scenarios.some(row => row.id !== 'cleanup' && row.status !== 'PASS'))
    throw new Blocked('ACCEPTANCE_COVERAGE_INCOMPLETE');
  report.status = 'PASS'; report.reason = 'NATIVE_SCENARIOS_COMPLETED';
} catch (error) {
  report.status = error instanceof Blocked ? 'BLOCKED' : 'FAIL';
  report.reason = /^[A-Z0-9_]{1,100}$/.test(error.message || '') ? error.message : 'NATIVE_ASSERTION_FAILED';
  if (report.reason === 'PREPARATION_ONLY_POLICY_GATE' || report.reason === 'HISTORICAL_REVISION_NOT_APPROVED')
    for (const row of report.scenarios) { row.status = 'BLOCKED'; row.reason = report.reason; }
} finally {
  const cleanup = report.scenarios.find(row => row.id === 'cleanup');
  if (root) {
    try {
      // No directory removal while any owned process or unexplained new zombie remains.
      if (audit) await audit.finish();
      if (driver) await driver.dispose();
      ownedPath(root, join(root, '.owner')); assert.equal(readFileSync(join(root, '.owner'), 'utf8'), owner);
      rmSync(root, { recursive: true }); assert(!existsSync(root));
      report.cleanup.push({ path: root, removed: true, reason: 'OWNED_ROOT_REMOVED' });
      cleanup.status = 'PASS'; cleanup.reason = 'IDENTITIES_AND_REMOVAL_CHECKED';
    } catch {
      cleanup.status = 'BLOCKED'; cleanup.reason = 'PROCESS_OR_FILESYSTEM_CLEANUP_UNVERIFIED';
      report.cleanup.push({ path: root, removed: false, reason: cleanup.reason });
      if (report.status !== 'FAIL') report.status = 'BLOCKED'; report.reason = cleanup.reason;
    }
    try { if (driver) await driver.closeServices(); } catch { if (report.status !== 'FAIL') report.status = 'BLOCKED'; report.reason = 'SERVICE_CLEANUP_UNVERIFIED'; }
  }
  persist();
  console.log(`${report.status}: ${report.reason}`);
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2;
}
