// Static-only validator; never imports native execution or installs dependencies.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { validatePlan, requireHistory } from './plan.mjs';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml'); // Existing locked development dependency; no package changes.
const root = 'tests/native-acceptance';
const text = readFileSync('.github/workflows/personal-engine-native-acceptance.yml', 'utf8');
const workflow = yaml.load(text);
const config = JSON.parse(readFileSync(join(root, 'reviewed.json')));
assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(workflow.jobs), ['plan', 'native']);
assert.equal(config.executionEnabled, false);
assert.throws(() => requireHistory(config), /HISTORICAL_REVISION_NOT_APPROVED/);
assert.equal(config.mainBaseline, '04bd232d27cbbaa8317a3ba8444ddedaa0e92a1e');
assert.deepEqual(Object.values(config.platforms).map(p => p.runner),
  ['ubuntu-24.04', 'ubuntu-24.04-arm', 'windows-2022', 'windows-11-arm', 'macos-15-intel', 'macos-15']);
assert.equal(workflow.jobs.plan['runs-on'], 'ubuntu-24.04');
assert.equal(workflow.jobs.plan.if, undefined, 'Untrusted contexts must fail validation, not produce an all-skipped green run');
assert.equal(workflow.jobs.native['runs-on'], '${{ matrix.runner }}');
assert.equal(workflow.jobs.native.needs, 'plan');
assert.deepEqual(workflow.jobs.native.strategy, { 'fail-fast': false, 'max-parallel': 1,
  matrix: '${{ fromJSON(needs.plan.outputs.matrix) }}' });
assert.deepEqual(workflow.concurrency, { group: 'personal-engine-native-acceptance', 'cancel-in-progress': false });
assert.equal(workflow.jobs.plan['timeout-minutes'], 5);
assert.equal(workflow.jobs.native['timeout-minutes'], 120);
assert(!/secrets\.|id-token|pull_request|workflow_run|schedule:|sudo\b|--no-sandbox/.test(text));
const pins = new Set(['actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02']);
let shellBlocks = 0;
for (const job of Object.values(workflow.jobs)) {
  assert(!job.permissions && !job.container && !job.environment && !job['continue-on-error']);
  for (const step of job.steps) {
    assert(!step['continue-on-error']);
    if (step.uses) assert(pins.has(step.uses));
    if (step.uses?.startsWith('actions/checkout@')) {
      assert.equal(step.with.repository, config.repository); assert.equal(step.with['persist-credentials'], false);
      assert(['${{ github.workflow_sha }}', '${{ matrix.sha }}', '${{ needs.plan.outputs.stable }}', '${{ needs.plan.outputs.previous }}'].includes(step.with.ref));
    }
    if (step.uses?.startsWith('actions/upload-artifact@')) {
      assert.equal(step.with.path, 'evidence-native/native.json'); assert.equal(step.with['retention-days'], 3);
      assert.equal(step.with['include-hidden-files'], false); assert.equal(step.with['if-no-files-found'], 'error');
      assert.equal(step.if, "always() && steps.evidence.outcome == 'success'");
    }
    if (step.id === 'evidence') assert.deepEqual(step.env, {
      ACCEPTANCE_TARGET: '${{ matrix.target }}', ACCEPTANCE_ROLE: '${{ matrix.role }}' });
    if (step.run) {
      assert.equal(step.shell, 'bash'); assert(!step.run.includes('${{'));
      assert.equal(spawnSync('bash', ['-n'], { input: step.run }).status, 0); shellBlocks++;
    }
  }
}
const inputs = workflow.on.workflow_dispatch.inputs;
assert.deepEqual(Object.keys(inputs).sort(), ['authorization', 'baseline', 'candidate', 'platforms']);
assert.equal(inputs.baseline.default, config.baseline); assert.equal(inputs.candidate.default, config.candidate);
assert.deepEqual(inputs.authorization.options, ['PREPARATION_ONLY']);
const good = { baseline: config.baseline, candidate: config.candidate, platforms: 'all', authorization: 'PREPARATION_ONLY' };
const context = { repository: config.repository, event: 'workflow_dispatch', hosted: 'github-hosted', workflowSha: 'a'.repeat(40), ref: 'refs/heads/main' };
for (const platforms of inputs.platforms.options) {
  const jobs = validatePlan(config, { ...good, platforms }, context).matrix.include;
  assert(jobs.length > 0 && jobs.length <= 12);
  for (const target of new Set(jobs.map(j => j.target))) assert.deepEqual(jobs.filter(j => j.target === target).map(j => j.role), ['baseline', 'candidate']);
}
const provenance = JSON.parse(readFileSync(join(root, 'vendor/pr20/provenance.json')));
assert.equal(provenance.commit, '1496298a6619708e56bba1b1a2d08c0b542b2d80');
assert.equal(Object.keys(provenance.files).length, 4);
for (const [path, info] of Object.entries(provenance.files)) assert.equal(
  createHash('sha256').update(readFileSync(join(root, 'vendor/pr20', path))).digest('hex'), info.sha256);
let modules = 0;
function syntax(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) syntax(path);
    else if (path.endsWith('.mjs')) { assert.equal(spawnSync(process.execPath, ['--check', path]).status, 0, path); modules++; }
    else if (path.endsWith('.json')) JSON.parse(readFileSync(path));
  }
}
syntax(root);
let localLinks = 0;
for (const document of ['docs/design/isolated-native-acceptance-actions.md', 'docs/design/isolated-native-acceptance-review.md']) {
for (const match of readFileSync(document, 'utf8').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  if (/^https?:/.test(match[1])) continue;
  assert(existsSync(resolve(dirname(document), match[1].split('#')[0])), `Missing link: ${match[1]}`); localLinks++;
}
}
console.log(JSON.stringify({ status: 'PASS', scope: 'static-only', nativeTestsExecuted: 0,
  yamlParsed: true, manualTriggerOnly: true, runnerTargets: 6, separateRevisionJobs: 12,
  shellBlocks, modules, validPlatformSelections: inputs.platforms.options.length,
  verifiedPR20Files: 4, localLinks, executionEnabled: false, historicalApprovals: 0 }, null, 2));
