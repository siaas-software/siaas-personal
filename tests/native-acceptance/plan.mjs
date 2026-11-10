// Test infrastructure only. Importing this file performs no IO or execution.
export function validatePlan(config, input, context) {
  if (context.repository !== config.repository || context.event !== 'workflow_dispatch' ||
      context.hosted !== 'github-hosted' || context.ref !== 'refs/heads/main') throw Error('UNTRUSTED_WORKFLOW_CONTEXT');
  if (Object.keys(input).sort().join() !== 'authorization,baseline,candidate,platforms') throw Error('UNKNOWN_INPUT');
  const sha = /^[0-9a-f]{40}$(?![\s\S])/;
  if (!sha.test(context.workflowSha || '') || !sha.test(input.baseline || '') ||
      !sha.test(input.candidate || '') || input.baseline !== config.baseline ||
      input.candidate !== config.candidate) throw Error('UNREVIEWED_REVISION');
  if (input.authorization !== 'PREPARATION_ONLY') throw Error('INVALID_ACKNOWLEDGEMENT');
  const keys = Object.keys(config.platforms);
  const subsets = { all: keys, linux: keys.filter(k => k.startsWith('linux-')),
    windows: keys.filter(k => k.startsWith('windows-')), macos: keys.filter(k => k.startsWith('macos-')) };
  const selected = Object.hasOwn(config.platforms, input.platforms) ? [input.platforms] :
    Object.hasOwn(subsets, input.platforms) ? subsets[input.platforms] : null;
  if (!selected || !selected.length || selected.length > 6) throw Error('INVALID_PLATFORM_SELECTION');
  return { repository: config.repository, workflowSha: context.workflowSha,
    baseline: input.baseline, candidate: input.candidate, node: config.node,
    matrix: { include: selected.flatMap(target => ['baseline', 'candidate'].map(role =>
      ({ target, ...config.platforms[target], role, sha: config[role] }))) } };
}

export function requireHistory(config) {
  const history = config.historicalRevisions;
  for (const name of ['stable', 'previousCandidate']) {
    const item = history?.[name];
    if (!item || Object.keys(item).sort().join() !== 'approval,sha,version' ||
        typeof item.sha !== 'string' || item.sha.length !== 40 || !/^[a-f0-9]+$/.test(item.sha) ||
        typeof item.approval !== 'string' || !item.approval.trim() || item.approval.length > 500 ||
        !/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(item.version || '') ||
        [config.baseline, config.candidate].includes(item.sha))
      throw Error('HISTORICAL_REVISION_NOT_APPROVED');
  }
  if (history.stable.version.includes('-') || !history.previousCandidate.version.includes('-rc.') ||
      history.stable.sha === history.previousCandidate.sha) throw Error('INVALID_HISTORICAL_CHANNEL');
  return history;
}
