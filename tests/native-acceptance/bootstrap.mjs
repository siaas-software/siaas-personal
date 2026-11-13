// Public bootstrap acceptance is separate from --prepared manager testing.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { machine } from 'node:os';
import { join } from 'node:path';
import { Blocked, digest, ownedPath } from './safety.mjs';
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$(?![\s\S])/.test(value);
export const bootstrapStages = ['public-resolution', 'published-manifest', 'public-entrypoint', 'installed-source-runtime', 'automatic-gui', 'launcher', 'uninstall-preservation'];
export function validateBootstrapReceipt(receipt) {
  assert.deepEqual(Object.keys(receipt).sort(), ['schemaVersion', 'kind', 'repository', 'applicationSha', 'target', 'releaseId', 'status', 'stages'].sort());
  assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.kind, 'public-bootstrap'); assert.equal(receipt.repository, 'siaas-software/siaas-personal');
  assert(typeof receipt.applicationSha === 'string' && /^[a-f0-9]{40}$(?![\s\S])/.test(receipt.applicationSha));
  assert(/^(linux|windows|macos)-(x64|arm64)$(?![\s\S])/.test(receipt.target));
  assert(Number.isSafeInteger(receipt.releaseId) && receipt.releaseId > 0);
  assert.deepEqual(receipt.stages.map(x => x.id), bootstrapStages);
  for (const stage of receipt.stages) { assert.deepEqual(Object.keys(stage).sort(), ['id', 'status']); assert(['PASS', 'FAIL', 'BLOCKED', 'NOT RUN'].includes(stage.status)); }
  const status = receipt.stages.some(x => x.status === 'FAIL') ? 'FAIL' : receipt.stages.every(x => x.status === 'PASS') ? 'PASS' : 'BLOCKED';
  assert.equal(receipt.status, status); assert(Buffer.byteLength(JSON.stringify(receipt)) <= 4096); return receipt;
}
export function bootstrapApproval(config, role, target) {
  assert.equal(config.repository, 'siaas-software/siaas-personal');
  assert(['baseline', 'candidate'].includes(role) && Object.hasOwn(config.platforms, target), 'BOOTSTRAP_TARGET');
  const approval = config.publicBootstrapApprovals?.[role]?.[target];
  if (!approval) throw new Blocked('PUBLIC_BOOTSTRAP_REVISION_NOT_APPROVED');
  assert.deepEqual(Object.keys(approval).sort(), ['approval', 'entrySha256', 'manifestSha256', 'releaseId', 'sha', 'sourceSha256', 'sourceSize', 'tag', 'tsvSha256'].sort());
  assert.equal(approval.sha, config[role], 'BOOTSTRAP_REVISION_MISMATCH');
  assert(typeof approval.approval === 'string' && approval.approval.trim() && approval.approval.length <= 500);
  assert(Number.isSafeInteger(approval.releaseId) && approval.releaseId > 0);
  assert(typeof approval.tag === 'string' && /^v\d+\.\d+\.\d+(?:-rc\.\d+)?$(?![\s\S])/.test(approval.tag));
  for (const key of ['entrySha256', 'manifestSha256', 'sourceSha256', 'tsvSha256']) assert(sha(approval[key]));
  assert(Number.isSafeInteger(approval.sourceSize) && approval.sourceSize > 0 && approval.sourceSize < 500_000_000);
  // Stable bootstrap resolves the mutable public downloads API internally; do not patch it or race
  // an unapproved resolution and call that exact-commit testing.
  if (!approval.tag.includes('-rc.')) throw new Blocked('UNPINNED_STABLE_BOOTSTRAP_RESOLUTION');
  return approval;
}
export function publicPlan(config, role, target, release, tagCommit, manifestBytes, entryBytes, tsvBytes) {
  const a = bootstrapApproval(config, role, target), platform = config.platforms[target];
  assert.equal(tagCommit, a.sha, 'PUBLIC_TAG_COMMIT_MISMATCH');
  assert.equal(release.id, a.releaseId); assert.equal(release.tag_name, a.tag);
  assert.equal(release.draft, false); assert.equal(release.prerelease, true);
  const entry = platform.os === 'win32' ? 'install-rc.ps1' : 'install-rc.sh';
  const manifestName = 'rc-manifests.json';
  const source = `SIAAS-Personal-${a.tag.slice(1)}-source.zip`;
  const base = `https://github.com/${config.repository}/releases/download/${a.tag}/`;
  for (const name of [entry, manifestName, 'rc-manifests.tsv', source]) {
    const assets = release.assets.filter(x => x.name === name); assert.equal(assets.length, 1);
    assert.equal(assets[0].browser_download_url, base + name, 'PUBLIC_ASSET_URL');
  }
  assert.equal(digest(entryBytes), a.entrySha256, 'PUBLIC_ENTRY_INTEGRITY');
  assert.equal(digest(manifestBytes), a.manifestSha256, 'PUBLIC_MANIFEST_INTEGRITY');
  assert.equal(digest(tsvBytes), a.tsvSha256, 'PUBLIC_TSV_INTEGRITY');
  const all = JSON.parse(manifestBytes.toString());
  const keys = ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'];
  assert.deepEqual(Object.keys(all).sort(), keys.sort(), 'PUBLIC_MANIFEST_SET');
  const lines = tsvBytes.toString().trim().split(/\r?\n/); assert.equal(lines.length, 6);
  const expectedLines = Object.values(all).map(m => [m.platform, m.arch, m.version, m.name, m.size, m.sha256, m.downloadUrl, m.runtime.version, m.runtime.name, m.runtime.sha256, m.runtime.url].join('\t'));
  assert.deepEqual(lines.sort(), expectedLines.sort(), 'PUBLIC_JSON_TSV_MISMATCH');
  const selected = Object.values(all).filter(x => x.platform === platform.os && x.arch === platform.arch);
  assert.equal(selected.length, 1); const m = selected[0];
  assert.equal(m.schemaVersion, 1); assert.equal(m.version, a.tag.slice(1));
  assert.equal(m.name, source); assert.equal(m.downloadUrl, base + source);
  assert.equal(m.sha256, a.sourceSha256); assert.equal(m.size, a.sourceSize);
  assert.equal(m.runtime.version, config.node); assert(sha(m.runtime.sha256));
  const runtimeName = `node-v${config.node}-${platform.os === 'win32' ? 'win' : platform.os}-${platform.arch}.${platform.os === 'win32' ? 'zip' : 'tar.gz'}`;
  assert.equal(m.runtime.name, runtimeName); assert.equal(m.runtime.url, `https://nodejs.org/dist/v${config.node}/${runtimeName}`);
  return { entry, tag: a.tag, sha: a.sha, releaseId: a.releaseId, sourceSha256: m.sha256 };
}
export async function boundedPublicBytes(url, limit) {
  const allowed = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com']);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const u = new URL(url); assert(u.protocol === 'https:' && allowed.has(u.hostname) && !u.username && !u.password && !u.port, 'PUBLIC_HTTPS_DESTINATION');
    let response;
    try { response = await fetch(u, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Blocked('PUBLIC_NETWORK_UNAVAILABLE'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get('location'), u).href; await response.body?.cancel(); continue; }
    if (!response.ok) throw new Blocked('PUBLIC_DOWNLOAD_UNAVAILABLE');
    let total = 0; const chunks = [];
    for await (const chunk of response.body) { total += chunk.length; assert(total <= limit, 'PUBLIC_DOWNLOAD_SIZE'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  throw new Blocked('PUBLIC_REDIRECT_LIMIT');
}
export function bootstrapEnvironment(platform, env, host = { os: process.platform, arch: process.arch, machine: machine().toLowerCase() }) {
  const machines = { x64: ['x86_64', 'amd64'], arm64: ['aarch64', 'arm64'] };
  if (host.os !== platform.os || host.arch !== platform.arch || !machines[platform.arch]?.includes(host.machine))
    throw new Blocked('BOOTSTRAP_NATIVE_ARCHITECTURE_UNVERIFIED');
  const clean = { ...env };
  delete clean.PROCESSOR_ARCHITEW6432;
  if (platform.os === 'win32') clean.PROCESSOR_ARCHITECTURE = platform.arch === 'arm64' ? 'ARM64' : 'AMD64';
  return clean;
}
export async function exercisePublicBootstrap({ config, role, target, root, env, audit, profileProofs, checks, get = boundedPublicBytes }) {
  // This module has its own non-input gate; importing/planning is inert.
  if (config.executionEnabled !== true) throw new Blocked('PREPARATION_ONLY_POLICY_GATE');
  const approval = bootstrapApproval(config, role, target);
  if (!profileProofs.has(approval.sha)) throw new Blocked('GENERATION_PROFILE_PROOF_UNAVAILABLE');
  env = bootstrapEnvironment(config.platforms[target], env);
  const receipt = { schemaVersion: 1, kind: 'public-bootstrap', repository: config.repository, applicationSha: approval.sha, target,
    releaseId: approval.releaseId, status: 'BLOCKED', stages: bootstrapStages.map(id => ({ id, status: 'NOT RUN' })) };
  const step = async (id, fn) => { const row = receipt.stages.find(x => x.id === id); try { await fn(); row.status = 'PASS'; } catch (e) { row.status = e instanceof Blocked ? 'BLOCKED' : 'FAIL'; throw e; } };
  try {
    let release, tagCommit, manifestBytes, entryBytes, tsvBytes, plan;
    await step('public-resolution', async () => {
      release = JSON.parse(await get(`https://api.github.com/repos/${config.repository}/releases/${approval.releaseId}`, 256000));
      const ref = JSON.parse(await get(`https://api.github.com/repos/${config.repository}/git/ref/tags/${approval.tag}`, 16000));
      if (ref.object.type !== 'commit') throw new Blocked('ANNOTATED_TAG_REQUIRES_REVIEW');
      tagCommit = ref.object.sha; assert.equal(tagCommit, approval.sha); assert.equal(release.tag_name, approval.tag); assert.equal(release.draft, false);
    });
    await step('published-manifest', async () => {
      const base = `https://github.com/${config.repository}/releases/download/${approval.tag}/`;
      manifestBytes = await get(base + 'rc-manifests.json', 256000);
      tsvBytes = await get(base + 'rc-manifests.tsv', 256000);
      entryBytes = await get(base + (config.platforms[target].os === 'win32' ? 'install-rc.ps1' : 'install-rc.sh'), 128000);
      plan = publicPlan(config, role, target, release, tagCommit, manifestBytes, entryBytes, tsvBytes);
    });
    await step('public-entrypoint', async () => {
      const directory = ownedPath(root, join(root, 'public-entrypoint')); mkdirSync(directory, { recursive: true });
      const entryPath = ownedPath(root, join(directory, plan.entry)); writeFileSync(entryPath, entryBytes, { flag: 'wx', mode: 0o600 });
      const windows = config.platforms[target].os === 'win32';
      await audit.command('PUBLIC_BOOTSTRAP', windows ? 'powershell.exe' : 'bash',
        windows ? ['-NoProfile', '-NonInteractive', '-File', entryPath] : [entryPath],
        { cwd: directory, env: { ...env, SIAAS_RELEASE_TAG: plan.tag, SIAAS_INSTALL_DIR: ownedPath(root, join(root, 'installations/bootstrap')) }, timeout: 25 * 60_000 });
    });
    // Callbacks inspect actual installation/runtime, GUI, launcher and preserved data.
    // No --prepared invocation or locally synthesized manifest counts as bootstrap.
    for (const id of ['installed-source-runtime', 'automatic-gui', 'launcher', 'uninstall-preservation']) {
      await step(id, async () => { if (typeof checks[id] !== 'function') throw new Blocked('BOOTSTRAP_CHECK_UNAVAILABLE'); await checks[id](); });
    }
    receipt.status = 'PASS';
  } catch (e) { receipt.status = e instanceof Blocked ? 'BLOCKED' : 'FAIL'; e.bootstrapReceipt = validateBootstrapReceipt(receipt); throw e; }
  return validateBootstrapReceipt(receipt);
}
