// Test infrastructure only. Importing this file performs no IO or execution.
export function validatePlan(config, input, context) {
  if (context.repository !== config.repository || context.event !== 'workflow_dispatch' ||
      context.hosted !== 'github-hosted') throw Error('UNTRUSTED_WORKFLOW_CONTEXT');
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
    matrix: { include: selected.map(target => ({ target, ...config.platforms[target] })) } };
}
