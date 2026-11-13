// Test-only orchestration. Disabled by reviewed.json; never a production installer.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync,
  rmSync, statfsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import * as os from 'node:os';
import { runTest, bounded, stopChild, PrerequisiteError } from './vendor/pr20/helpers/runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'reviewed.json')));
const workspace = resolve(process.env.GITHUB_WORKSPACE || '.');
const evidence = join(workspace, 'evidence');
const target = process.env.ACCEPTANCE_TARGET;
const platform = config.platforms[target];
const report = { schemaVersion: 1, status: 'BLOCKED', target,
  workflowSha: process.env.GITHUB_WORKFLOW_SHA, baseline: config.baseline, candidate: config.candidate,
  node: process.versions.node, os: os.platform(), osVersion: os.version(), kernel: os.release(),
  machine: os.machine(), processArch: process.arch, imageOS: process.env.ImageOS,
  imageVersion: process.env.ImageVersion, revisions: [],
  scenarios: Object.fromEntries(['legacy-install', 'automatic-install-launch', 'launcher-execution',
    'stable-rc-isolation', 'installed-metadata', 'repeat-install', 'update', 'rollback', 'uninstall',
    'unrelated-data-preservation', 'failure-recovery', 'retained-generations'].map(name => [name, 'NOT RUN'])),
  fullProcessReaping: 'UNVERIFIED', reason: 'FULL_INSTALLER_SCENARIOS_AND_ZOMBIE_AUDIT_MISSING' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15000 }).trim();
const persist = () => {
  mkdirSync(evidence, { recursive: true });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (Buffer.byteLength(text) > 1024 * 1024) throw Error('EVIDENCE_LIMIT');
  writeFileSync(join(evidence, 'native.json'), text);
};
function cleanBuildEnv(owned) {
  // Explicit allowlist; no GITHUB/ACTIONS tokens, cloud credentials, HOME overrides,
  // NODE_OPTIONS, NODE_PATH, Electron overrides, or inherited application paths.
  const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC',
    'PATHEXT', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
    'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];
  const env = Object.fromEntries(allowed.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  for (const name of ['tmp', 'config', 'cache', 'data', 'runtime', 'appdata', 'localappdata', 'npm-cache', 'electron-cache'])
    mkdirSync(join(owned, name), { recursive: true, mode: 0o700 });
  const npmrc = join(owned, 'empty.npmrc'); writeFileSync(npmrc, '');
  return { ...env, CI: 'true', NEXT_TELEMETRY_DISABLED: '1', NODE_USE_ENV_PROXY: '1',
    TMPDIR: join(owned, 'tmp'), TEMP: join(owned, 'tmp'), TMP: join(owned, 'tmp'),
    XDG_CONFIG_HOME: join(owned, 'config'), XDG_CACHE_HOME: join(owned, 'cache'),
    XDG_DATA_HOME: join(owned, 'data'), XDG_RUNTIME_DIR: join(owned, 'runtime'),
    APPDATA: join(owned, 'appdata'), LOCALAPPDATA: join(owned, 'localappdata'),
    npm_config_cache: join(owned, 'npm-cache'), npm_config_userconfig: npmrc,
    electron_config_cache: join(owned, 'electron-cache') };
}
try {
  if (config.executionEnabled !== true) throw new PrerequisiteError('PREPARATION_ONLY_POLICY_GATE');
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      process.env.GITHUB_REPOSITORY !== config.repository || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      !/^[0-9a-f]{40}$(?![\s\S])/.test(report.workflowSha || '')) throw new PrerequisiteError('UNTRUSTED_WORKFLOW_CONTEXT');
  if (!platform || process.platform !== platform.os || process.arch !== platform.arch ||
      process.versions.node !== config.node) throw new PrerequisiteError('NATIVE_RUNTIME_MISMATCH');
  const machines = { x64: ['x86_64', 'amd64'], arm64: ['aarch64', 'arm64'] };
  if (!machines[platform.arch].includes(os.machine().toLowerCase())) throw new PrerequisiteError('HOST_ARCHITECTURE_MISMATCH');
  if (process.platform === 'darwin') {
    const translated = spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8', timeout: 5000 });
    if (translated.stdout?.trim() === '1') throw new PrerequisiteError('TRANSLATED_PROCESS');
  }
  if (process.platform === 'linux' && process.getuid?.() === 0) throw new PrerequisiteError('ROOT_ELECTRON_NOT_ALLOWED');
  const space = statfsSync(workspace);
  if (space.bavail * space.bsize < 10 * 1024 ** 3 || os.freemem() < 4 * 1024 ** 3)
    throw new PrerequisiteError('INSUFFICIENT_MEMORY_OR_DISK');
  if (process.platform === 'linux') {
    const display = spawnSync('xvfb-run', ['--help'], { timeout: 5000, stdio: 'ignore' });
    if (display.error || display.status !== 0) throw new PrerequisiteError('XVFB_UNAVAILABLE');
  }
  const provenance = JSON.parse(readFileSync(join(here, 'vendor/pr20/provenance.json')));
  for (const [file, expected] of Object.entries(provenance.files)) {
    if (hash(readFileSync(join(here, 'vendor/pr20', file))) !== expected.sha256) throw Error('HARNESS_INTEGRITY_FAILED');
  }
  const trees = { baseline: join(workspace, 'baseline'), candidate: join(workspace, 'candidate') };
  for (const [name, tree] of Object.entries(trees)) {
    if (realpathSync(tree) !== tree || git(tree, 'rev-parse', 'HEAD') !== config[name] ||
        !/^https:\/\/github\.com\/siaas-software\/siaas-personal(?:\.git)?$/.test(git(tree, 'remote', 'get-url', 'origin')))
      throw Error('CHECKOUT_IDENTITY_FAILED');
    // Inspect exit code only: never print credential-bearing header values.
    const headers = spawnSync('git', ['config', '--local', '--get-regexp', 'http\..*extraheader'], { cwd: tree, stdio: 'ignore' });
    if (headers.status !== 1) throw Error('CHECKOUT_CREDENTIAL_STATE_UNVERIFIED');
  }
  if (hash(readFileSync(join(trees.baseline, 'package-lock.json'))) !== hash(readFileSync(join(trees.candidate, 'package-lock.json'))))
    throw Error('DEPENDENCY_LOCK_MISMATCH');
  const npm = process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') :
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npm)) throw new PrerequisiteError('MANAGED_NPM_UNAVAILABLE');

  persist(); // Preserve incomplete evidence even if the host later interrupts the suite.
  for (const [name, tree] of Object.entries(trees)) {
    const remaining = statfsSync(workspace);
    if (remaining.bavail * remaining.bsize < 10 * 1024 ** 3)
      throw new PrerequisiteError('INSUFFICIENT_DISK_FOR_REVISION');
    const revision = { name, sha: config[name], commands: [], smoke: 'NOT RUN', actualProfile: null,
      temporaryRoots: [], cleanup: [], fullProcessReaping: 'UNVERIFIED' };
    report.revisions.push(revision);
    process.chdir(tree);
    const meta = await runTest(`native-${name}`, async run => {
      const owned = await run.tempDir(); revision.temporaryRoots.push(owned); persist();
      const env = cleanBuildEnv(owned);
      const harness = join(tree, '.native-acceptance');
      if (existsSync(harness)) throw Error('HARNESS_DESTINATION_EXISTS');
      cpSync(join(here, 'vendor/pr20'), harness, { recursive: true, errorOnExist: true, force: false });
      run.defer('test-only harness copy', () => rmSync(harness, { recursive: true, force: true }));
      const command = async (label, executable, args, milliseconds) => {
        const child = run.child(executable, args, { cwd: tree, env });
        const entry = { label, executable, args, pid: child.pid, exitCode: null };
        revision.commands.push(entry); persist();
        let code;
        try {
          code = await bounded(new Promise((ok, no) => { child.once('error', no); child.once('exit', ok); }), milliseconds, label);
        } finally { await stopChild(child); }
        entry.exitCode = code;
        persist();
        if (code !== 0) throw Error(`${label}_FAILED`);
      };
      await command('LOCKED_DEPENDENCIES', process.execPath, [npm, 'ci', '--no-audit', '--no-fund'], 8 * 60_000);
      await command('VERIFIED_ELECTRON', process.execPath, ['node_modules/electron/install.js'], 3 * 60_000);
      await command('DESKTOP_BUILD', process.execPath, [npm, 'run', 'desktop:build'], 12 * 60_000);
      revision.electron = JSON.parse(readFileSync(join(tree, 'node_modules/electron/package.json'))).version;
      const previous = new Set(readdirSync(join(tree, 'test-results')));
      try {
        const args = [join(harness, 'desktop-smoke.mjs')];
        await command('NATIVE_ELECTRON_SMOKE', process.platform === 'linux' ? 'xvfb-run' : process.execPath,
          process.platform === 'linux' ? ['-a', process.execPath, ...args] : args, 3 * 60_000);
      } finally {
        const results = readdirSync(join(tree, 'test-results')).filter(f => f.startsWith('desktop-smoke-') && !previous.has(f));
        if (results.length === 1) {
          const data = JSON.parse(readFileSync(join(tree, 'test-results', results[0], 'result.json')));
          revision.smoke = data.status; revision.actualProfile = data.electronProfile || null;
          revision.smokeTemporaryRoots = data.directories;
          revision.smokeCleanup = data.cleanup;
          revision.smokeErrorClass = /SUID sandbox|No usable sandbox/i.test(data.error || '') ? 'SANDBOX_UNAVAILABLE' :
            /graphical session|Missing X server/i.test(data.error || '') ? 'DISPLAY_UNAVAILABLE' :
              data.status === 'PASS' ? null : 'NATIVE_SMOKE_NOT_PASSED';
        }
      }
      // Smoke success cannot represent installation/lifecycle or complete process-reaping acceptance.
      throw new PrerequisiteError('INSTALLER_SCENARIOS_AND_ZOMBIE_AUDIT_NOT_IMPLEMENTED');
    }, { timeout: 27 * 60_000, mode: 'native-electron-smoke-only' });
    revision.status = meta.status;
    revision.cleanup = meta.cleanup;
    revision.temporaryRootsRemoved = revision.temporaryRoots.every(path => !existsSync(path));
    if (!revision.temporaryRootsRemoved || meta.status === 'FAIL') report.status = 'FAIL';
    persist();
  }
} catch (error) {
  if (report.status !== 'FAIL') report.status = error instanceof PrerequisiteError ? 'BLOCKED' : 'FAIL';
  // Error strings from arbitrary subprocesses are not exported as artifact contents.
  report.reason = /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'PREFLIGHT_OR_HARNESS_UNAVAILABLE';
  console.error(report.reason);
} finally {
  persist();
  process.exitCode = report.status === 'FAIL' ? 1 : 2;
}
