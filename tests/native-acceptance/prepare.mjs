import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validatePlan, requireHistory } from './plan.mjs';

const config = JSON.parse(readFileSync(new URL('./reviewed.json', import.meta.url)));
const output = resolve('evidence');
mkdirSync(output, { recursive: true });
try {
  const plan = validatePlan(config, {
    baseline: process.env.INPUT_BASELINE, candidate: process.env.INPUT_CANDIDATE,
    platforms: process.env.INPUT_PLATFORMS, authorization: process.env.INPUT_AUTHORIZATION,
  }, { repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME,
    hosted: process.env.RUNNER_ENVIRONMENT, workflowSha: process.env.GITHUB_WORKFLOW_SHA, ref: process.env.GITHUB_REF });
  writeFileSync(join(output, 'plan.json'), JSON.stringify({ ...plan, status: 'BLOCKED',
    reason: 'PREPARATION_ONLY_POLICY_GATE', nativeAcceptance: 'NOT RUN' }, null, 2) + '\n');
  // Reviewed code gate, not an input or repository variable. No source builds while disabled.
  if (config.executionEnabled !== true) throw Error('PREPARATION_ONLY_POLICY_GATE');
  const history = requireHistory(config);
  // Anonymous, bounded API reads: exact allowlisted commits in the fixed repository.
  for (const revision of [plan.baseline, plan.candidate, history.stable.sha, history.previousCandidate.sha]) {
    const response = await fetch(`https://api.github.com/repos/${config.repository}/commits/${revision}`,
      { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok || (await response.json()).sha !== revision) throw Error('REPOSITORY_REVISION_UNVERIFIED');
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(plan.matrix)}\nstable=${history.stable.sha}\nprevious=${history.previousCandidate.sha}\n`);
  writeFileSync(join(output, 'plan.json'), JSON.stringify({ ...plan, status: 'VALIDATED_PLAN',
    nativeAcceptance: 'NOT RUN' }, null, 2) + '\n');
} catch (error) {
  const known = ['UNTRUSTED_WORKFLOW_CONTEXT', 'UNREVIEWED_REVISION', 'INVALID_ACKNOWLEDGEMENT',
    'INVALID_PLATFORM_SELECTION', 'PREPARATION_ONLY_POLICY_GATE', 'REPOSITORY_REVISION_UNVERIFIED',
    'HISTORICAL_REVISION_NOT_APPROVED', 'INVALID_HISTORICAL_CHANNEL', 'UNKNOWN_INPUT'];
  const reason = known.includes(error.message) ? error.message : 'PREFLIGHT_UNAVAILABLE';
  writeFileSync(join(output, 'blocked.json'), JSON.stringify({ status: 'BLOCKED', reason, nativeAcceptance: 'NOT RUN' }) + '\n');
  console.error(reason);
  process.exitCode = 2;
}
