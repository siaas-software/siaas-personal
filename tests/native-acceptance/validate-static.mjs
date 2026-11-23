// Static checks only: never imports prepare.mjs/run.mjs or launches the application.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { validatePlan } from './plan.mjs';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml'); // Already in the committed dependency lockfile.
const root = 'tests/native-acceptance';
const text = readFileSync('.github/workflows/personal-engine-native-acceptance.yml', 'utf8');
const workflow = yaml.load(text);
const config = JSON.parse(readFileSync(join(root, 'reviewed.json')));
assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
assert.deepEqual(workflow.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(workflow.jobs), ['plan', 'native']);
assert.equal(config.executionEnabled, false, 'Preparation gate must remain closed');
assert.equal(config.repository, 'siaas-software/siaas-personal');
assert.deepEqual(Object.values(config.platforms).map(p => p.runner),
  ['ubuntu-24.04', 'ubuntu-24.04-arm', 'windows-2022', 'windows-11-arm', 'macos-15-intel', 'macos-15']);
assert.equal(workflow.jobs.plan['runs-on'], 'ubuntu-24.04');
assert.equal(workflow.jobs.native['runs-on'], '${{ matrix.runner }}');
assert.equal(workflow.jobs.native.needs, 'plan');
assert.deepEqual(workflow.jobs.native.strategy, { 'fail-fast': false, 'max-parallel': 1,
  matrix: '${{ fromJSON(needs.plan.outputs.matrix) }}' });
assert.equal(workflow.concurrency['cancel-in-progress'], false);
assert.equal(workflow.jobs.plan['timeout-minutes'], 5);
assert.equal(workflow.jobs.native['timeout-minutes'], 60);
assert(!/secrets\.|id-token|pull_request|workflow_run|schedule:|sudo\b/.test(text));
const pins = new Set(['actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02']);
let shellBlocks = 0;
for (const job of Object.values(workflow.jobs)) {
  assert(!job.permissions && !job.container && !job.environment && !job['continue-on-error']);
  for (const step of job.steps) {
    assert(!step['continue-on-error']);
    if (step.uses) assert(pins.has(step.uses), 'Unreviewed action');
    if (step.uses?.startsWith('actions/checkout@')) {
      assert.equal(step.with.repository, config.repository);
      assert.equal(step.with['persist-credentials'], false);
      assert(['${{ github.workflow_sha }}', '${{ needs.plan.outputs.baseline }}',
        '${{ needs.plan.outputs.candidate }}'].includes(step.with.ref));
    }
    if (step.uses?.startsWith('actions/upload-artifact@')) {
      assert.equal(step.with['retention-days'], 3);
      assert.equal(step.with.path, 'evidence/*.json');
      assert.equal(step.with['include-hidden-files'], false);
      assert.equal(step.if, 'always()');
    }
    if (step.run) {
      assert.equal(step.shell, 'bash');
      assert(!step.run.includes('${{'), 'Inputs must not be interpolated into shell code');
      assert.equal(spawnSync('bash', ['-n'], { input: step.run }).status, 0);
      shellBlocks++;
    }
  }
}
const inputs = workflow.on.workflow_dispatch.inputs;
assert.equal(inputs.baseline.default, config.baseline);
assert.equal(inputs.candidate.default, config.candidate);
assert.deepEqual(inputs.authorization.options, ['PREPARATION_ONLY']);
const context = { repository: config.repository, event: 'workflow_dispatch',
  hosted: 'github-hosted', workflowSha: 'a'.repeat(40) };
const good = { baseline: config.baseline, candidate: config.candidate, platforms: 'linux-x64', authorization: 'PREPARATION_ONLY' };
for (const platforms of inputs.platforms.options) {
  const p = validatePlan(config, { ...good, platforms }, context);
  assert(p.matrix.include.length > 0 && p.matrix.include.length <= 6);
  for (const item of p.matrix.include) assert.deepEqual(config.platforms[item.target],
    { runner: item.runner, os: item.os, arch: item.arch });
}
let rejected = 0;
for (const bad of [
  { candidate: 'main' }, { candidate: 'b'.repeat(40) }, { candidate: config.candidate.toUpperCase() },
  { candidate: config.candidate + '\n' }, { baseline: config.candidate },
  { platforms: '__proto__' }, { platforms: 'self-hosted' }, { platforms: 'macos-15-xlarge' },
  { platforms: 'linux-x64,windows-x64' }, { authorization: 'RUN_NOW' },
]) { assert.throws(() => validatePlan(config, { ...good, ...bad }, context)); rejected++; }
for (const bad of [{ repository: 'other/repository' }, { event: 'push' },
  { hosted: 'self-hosted' }, { workflowSha: 'main' }, { workflowSha: 'a'.repeat(40) + '\n' }]) {
  assert.throws(() => validatePlan(config, good, { ...context, ...bad })); rejected++;
}
const provenance = JSON.parse(readFileSync(join(root, 'vendor/pr20/provenance.json')));
assert.equal(provenance.commit, '1496298a6619708e56bba1b1a2d08c0b542b2d80');
assert.equal(Object.keys(provenance.files).length, 4);
for (const [path, data] of Object.entries(provenance.files)) {
  assert.equal(createHash('sha256').update(readFileSync(join(root, 'vendor/pr20', path))).digest('hex'), data.sha256);
}
function syntax(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) syntax(p);
    else if (p.endsWith('.mjs')) assert.equal(spawnSync(process.execPath, ['--check', p]).status, 0, p);
  }
}
syntax(root);
const document = 'docs/design/native-acceptance-actions.md';
let localLinks = 0;
for (const match of readFileSync(document, 'utf8').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  if (/^https?:/.test(match[1])) continue;
  assert(existsSync(resolve(dirname(document), match[1].split('#')[0])), `Missing link: ${match[1]}`);
  localLinks++;
}
console.log(JSON.stringify({ status: 'PASS', scope: 'static-only', nativeTestsExecuted: 0,
  yamlParsed: true, manualTriggerOnly: true, runnerTargets: 6, shellBlocks,
  validPlatformSelections: inputs.platforms.options.length, rejectedInputCases: rejected,
  verifiedPR20Files: 4, localLinks, executionEnabled: false }, null, 2));
