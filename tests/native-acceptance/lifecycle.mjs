// Executable test scenarios, independent of host commands. Never fabricates versions.
import assert from 'node:assert/strict';
import { Blocked, versionOrder } from './safety.mjs';
import { runScenario } from './cleanup.mjs';
export const scenarioIds = ['legacy-install', 'automatic-gui-startup', 'sandboxed-smoke', 'profile-metadata',
  'launcher-execution', 'repeat-install', 'real-update', 'rollback', 'retained-manager',
  'stable-rc-isolation', 'stable-launcher', 'uninstall', 'unrelated-data',
  'invalid-source', 'exclusive-lock', 'interruption', 'adapter-rejection', 'preparation', 'public-bootstrap', 'baseline-candidate-comparison', 'cleanup'];
export const initialScenarios = () => scenarioIds.map(id => ({ id, status: 'NOT RUN', reason: 'NOT_EXECUTED' }));
export async function exerciseLifecycle(driver, scenarios, persist = () => {}) {
  const step = (id, body) => runScenario(scenarios, id, body, persist);
  // History must be explicitly authorized, genuinely older, and of the right channel.
  const { target, previous, stable } = driver.generations;
  if (!previous || !stable) throw new Blocked('HISTORICAL_REVISION_NOT_APPROVED');
  assert(versionOrder(previous.version, target.version) < 0, 'UPDATE_REQUIRES_OLDER_VERSION');
  assert(previous.sha !== target.sha && stable.sha !== target.sha, 'DISTINCT_GENERATIONS_REQUIRED');
  assert(previous.version.includes('-rc.') && target.version.includes('-rc.') && !stable.version.includes('-'), 'CHANNEL_MISMATCH');
  await driver.sentinels();
  await step('legacy-install', async () => {
    await driver.install('fresh', target, 'install');
    await driver.verify('fresh', target);
  });
  await step('automatic-gui-startup', async () => { await driver.observe('fresh'); await driver.stop(); });
  await step('sandboxed-smoke', () => driver.smoke('fresh'));
  await step('profile-metadata', async () => { await driver.metadata('fresh', target); await driver.profile('fresh'); });
  await step('launcher-execution', async () => { await driver.launcher('fresh'); await driver.observe('fresh'); await driver.stop(); });
  await step('repeat-install', async () => {
    const before = await driver.snapshot('fresh');
    await driver.install('fresh', target, 'install');
    assert.deepEqual(await driver.snapshot('fresh'), before, 'REPEAT_CHANGED_METADATA');
    await driver.noApplication(); // Existing same-version behavior: no extra GUI launch.
  });
  await exerciseUpgrade(driver, scenarios, persist);
  await exerciseCoexistence(driver, scenarios, persist);
  await step('uninstall', async () => {
    for (const root of ['fresh', 'upgrade', 'stable']) {
      await driver.userSentinel(root);
      const before = await driver.retained(root);
      await driver.wrapper(root, 'uninstall');
      await driver.uninstalled(root, before);
      await driver.checkUserSentinel(root);
    }
  });
  await step('unrelated-data', () => driver.checkSentinels());
  await step('invalid-source', () => driver.invalidSource());
  await step('exclusive-lock', () => driver.exclusiveLock());
  await step('interruption', () => driver.interruption());
  await step('adapter-rejection', () => driver.rejectAdapter());
  // The runner executes the separate public bootstrap checks. Cross-job comparison
  // is performed offline; a role cannot certify its own comparison row.
  // The outer runner performs cleanup even after a failure, then sets this row.
}

// Scenario A can be characterized independently of the stable-generation fixture.
export async function exerciseUpgrade(driver, scenarios, persist = () => {}) {
  const { target, previous } = driver.generations;
  if (!previous) throw new Blocked('HISTORICAL_REVISION_NOT_APPROVED');
  assert(previous.sha !== target.sha && versionOrder(previous.version, target.version) < 0, 'UPDATE_REQUIRES_OLDER_VERSION');
  assert(previous.version.includes('-rc.') && target.version.includes('-rc.'), 'CHANNEL_MISMATCH');
  const step = (id, body) => runScenario(scenarios, id, body, persist);
  await step('real-update', async () => {
    await driver.install('upgrade', previous, 'install');
    await driver.verify('upgrade', previous);
    await driver.observe('upgrade'); await driver.stop();
    await driver.userSentinel('upgrade');
    await driver.install('upgrade', target, 'update');
    await driver.verify('upgrade', target);
    await driver.previous('upgrade', previous);
    await driver.observe('upgrade'); await driver.stop();
    await driver.checkUserSentinel('upgrade');
  });
  await step('rollback', async () => {
    await driver.wrapper('upgrade', 'rollback');
    await driver.verify('upgrade', previous);
    await driver.checkUserSentinel('upgrade');
    await driver.noApplication();
  });
  await step('retained-manager', async () => {
    await driver.dispatcher('upgrade', previous);
    await driver.launcher('upgrade'); await driver.observe('upgrade'); await driver.stop();
  });
}
// Scenario B assumes the caller has installed/verified the owned 'fresh' RC root.
export async function exerciseCoexistence(driver, scenarios, persist = () => {}) {
  const { target, stable } = driver.generations;
  if (!stable) throw new Blocked('HISTORICAL_REVISION_NOT_APPROVED');
  assert(stable.sha !== target.sha && !stable.version.includes('-') && target.version.includes('-rc.'), 'CHANNEL_MISMATCH');
  const step = (id, body) => runScenario(scenarios, id, body, persist);
  await step('stable-rc-isolation', async () => {
    const candidate = await driver.snapshot('fresh');
    await driver.install('stable', stable, 'install');
    await driver.verify('stable', stable); await driver.observe('stable'); await driver.stop();
    assert.deepEqual(await driver.snapshot('fresh'), candidate, 'STABLE_CHANGED_CANDIDATE');
    await driver.isolation('stable', 'fresh');
  });
  await step('stable-launcher', async () => { await driver.launcher('stable'); await driver.observe('stable'); await driver.stop(); });
}
