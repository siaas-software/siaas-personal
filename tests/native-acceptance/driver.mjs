// Real legacy entry points. Unit tests stub command execution; only the gated
// native runner may start an application.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, cpSync, statfsSync, lstatSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { digest, ownedPath, within, sourceIndex, verifyInstalled, Blocked } from './safety.mjs';
import { exercisePublicBootstrap } from './bootstrap.mjs';
import { visibleWindow } from './native-host.mjs';
import { bounded } from './vendor/pr20/helpers/runtime.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export class NativeDriver {
  constructor({ root, env, audit, report, config, trees, sha, vendor }) {
    Object.assign(this, { root, env, audit, report, config, trees, sha, vendor });
    this.active = new Map(); this.userFiles = new Map(); this.profileProofs = new Set(); this.profilePreflights = new Set();
  }
  record(kind, expected, observed) { this.report.observations.push({ kind, expected: String(expected), observed: String(observed) }); }
  fact(kind, value) { if (kind.endsWith(':bootstrap')) return; this.record('behavior:' + kind, 'semantic-v1', JSON.stringify(value)); }
  path(name) { return ownedPath(this.root, join(this.root, 'installations', name)); }
  async initialize() {
    this.generations = {};
    for (const [name, tree] of Object.entries(this.trees)) {
      const sha = name === 'target' ? this.sha : this.config.historicalRevisions[name === 'previous' ? 'previousCandidate' : 'stable'].sha;
      const index = sourceIndex(tree, sha);
      const pkg = JSON.parse(readFileSync(join(tree, 'package.json')));
      const lock = digest(readFileSync(join(tree, 'package-lock.json')));
      if (name === 'target') assert.equal(lock, this.config.applicationLockSha256, 'REVIEWED_LOCK_MISMATCH');
      this.record('dependency-lock:' + name, sha, lock);
      this.record('package-version:' + name, sha, pkg.version);
      const runtime = JSON.parse(readFileSync(join(tree, 'runtime.json')));
      assert.equal(runtime.nodeVersion, this.config.node, 'HISTORICAL_RUNTIME_REQUIRES_REVIEW');
      if (name !== 'target') assert.equal(pkg.version, this.config.historicalRevisions[name === 'previous' ? 'previousCandidate' : 'stable'].version);
      // Reject an unfamiliar default-profile implementation before starting legacy code.
      const desktop = readFileSync(join(tree, 'desktop/main.cjs'), 'utf8');
      assert(desktop.includes('join(app.getPath("appData"), "SIAAS")') &&
        (!pkg.version.includes('-rc.') || desktop.includes('app.commandLine.getSwitchValue("user-data-dir")')), 'PROFILE_CONTRACT_REQUIRES_REVIEW');
      const prepared = ownedPath(this.root, join(this.root, 'prepared', name)); mkdirSync(prepared, { recursive: true });
      const archive = join(prepared, 'source.zip');
      execFileSync('git', ['archive', '--format=zip', '--output', archive, sha], { cwd: tree, timeout: 60000 });
      const bytes = readFileSync(archive); assert(bytes.length < 500_000_000, 'SOURCE_SIZE');
      const runtimeName = `node-v${runtime.nodeVersion}-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
      const response = await fetch(`https://nodejs.org/dist/v${runtime.nodeVersion}/SHASUMS256.txt`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Blocked('OFFICIAL_RUNTIME_CHECKSUM_UNAVAILABLE');
      let sums = ''; for await (const part of response.body) { sums += Buffer.from(part).toString(); if (sums.length > 100000) throw Error('CHECKSUM_SIZE'); }
      const matches = sums.split(/\r?\n/).map(s => s.trim().split(/\s+/)).filter(s => s[1] === runtimeName);
      assert(matches.length === 1 && /^[a-f0-9]{64}$/.test(matches[0][0]), 'OFFICIAL_RUNTIME_CHECKSUM');
      const manifest = { schemaVersion: 1, version: pkg.version, platform: process.platform, arch: process.arch,
        name: `SIAAS-Personal-${pkg.version}-source.zip`, size: bytes.length, sha256: digest(bytes),
        downloadUrl: `https://github.com/${this.config.repository}/releases/download/v${pkg.version}/SIAAS-Personal-${pkg.version}-source.zip`,
        runtime: { version: runtime.nodeVersion, name: runtimeName, sha256: matches[0][0], url: `https://nodejs.org/dist/v${runtime.nodeVersion}/${runtimeName}` } };
      writeFileSync(join(prepared, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx' });
      this.generations[name] = { sha, version: pkg.version, tree, index, prepared, manifest };
      this.record('prepared-source:' + name, sha, manifest.sha256);
    }
    // Resolve dependencies only in the disposable target checkout. These are trusted
    // reviewed lifecycle scripts, not a hostile-code containment boundary.
    const npm = process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') :
      resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
    if (!existsSync(npm)) throw new Blocked('MANAGED_NPM_UNAVAILABLE');
    assert(!existsSync(join(this.trees.target, 'node_modules')), 'DEPENDENCY_DESTINATION_EXISTS');
    this.dependencies = join(this.trees.target, 'node_modules');
    await this.audit.command('DEPENDENCIES', process.execPath, [npm, 'ci', '--no-audit', '--no-fund'], { cwd: this.trees.target, env: this.env });
    await this.audit.command('ELECTRON_DOWNLOAD', process.execPath, ['node_modules/electron/install.js'], { cwd: this.trees.target, env: this.env, timeout: 180000 });
    for (const name of ['electron', 'playwright', 'playwright-core']) this.record('dependency-version:' + name,
      this.config.applicationLockSha256, JSON.parse(readFileSync(join(this.trees.target, 'node_modules', name, 'package.json'))).version);
    await this.probeProfile();
    this.mock = createServer((request, response) => { response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(request.url === '/api/version' ? { version: '0.35.1' } : { models: [] })); });
    await new Promise((yes, no) => { this.mock.once('error', no); this.mock.listen(0, '127.0.0.1', yes); });
    this.env.OLLAMA_BASE_URL = `http://127.0.0.1:${this.mock.address().port}`;
  }
  async probeProfile() {
    // The probe selects its own disposable profile BEFORE readiness; it only reads
    // the native appData path. If the legacy default would escape, no install runs.
    const copy = join(this.trees.target, '.native-acceptance');
    assert(!existsSync(copy), 'HARNESS_COPY_EXISTS');
    cpSync(this.vendor, copy, { recursive: true, errorOnExist: true, force: false }); this.harnessCopy = copy;
    const { getElectron } = await import(pathToFileURL(join(copy, 'helpers/playwright-electron.mjs')));
    const probe = join(this.root, 'profile-probe.cjs'), profile = join(this.root, 'probe-profile');
    mkdirSync(profile);
    writeFileSync(probe, "const {app,BrowserWindow}=require('electron');app.setPath('userData',app.commandLine.getSwitchValue('user-data-dir'));app.whenReady().then(()=>{global.w=new BrowserWindow({show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadURL('about:blank');});", { flag: 'wx' });
    const electronRoot = join(this.trees.target, 'node_modules/electron');
    const executablePath = join(electronRoot, 'dist', readFileSync(join(electronRoot, 'path.txt'), 'utf8').trim());
    let app;
    try {
      app = await getElectron().launch({ executablePath, chromiumSandbox: true, args: [probe, `--user-data-dir=${profile}`], env: this.env, timeout: 60000 });
      await app.firstWindow({ timeout: 60000 });
      const paths = await app.evaluate(({ app, BrowserWindow }) => ({ appData: app.getPath('appData'), userData: app.getPath('userData'), sandbox: BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences().sandbox }));
      assert.equal(paths.userData, profile, 'PROBE_PROFILE'); assert.equal(paths.sandbox, true, 'SANDBOX_NOT_ENABLED');
      this.stableProfile = join(paths.appData, 'SIAAS');
      if (!within(this.root, this.stableProfile)) throw new Blocked('NATIVE_DEFAULT_PROFILE_ESCAPES_OWNED_ROOT');
      ownedPath(this.root, this.stableProfile);
      const home = execFileSync(process.execPath, ['-p', 'require("node:os").homedir()'], { env: this.env, encoding: 'utf8', timeout: 10000 }).trim();
      assert.equal(home, this.env.HOME, 'NATIVE_HOME_MISMATCH');
      // Generic Electron preflight is not an observation of Personal's actual
      // userData, launcher or complete filesystem writes. It grants no proof.
      this.profilePreflights.add(this.sha);
      this.record('native-home', this.env.HOME, home); this.record('native-appData', this.root, paths.appData);
    } catch (e) { if (e instanceof Blocked) throw e; throw new Blocked('SANDBOX_OR_PROFILE_PROBE_FAILED'); }
    finally { if (app) await bounded(app.close(), 5000, 'probe close').catch(() => {}); await this.audit.stop(); }
  }
  command(root, action, args = [], options = {}, managerTree = this.trees.target) {
    return this.audit.command('MANAGER_' + action.toUpperCase(), process.execPath,
      [join(managerTree, 'scripts/source-manager.mjs'), action, ...args],
      { cwd: managerTree, env: { ...this.env, SIAAS_INSTALL_DIR: this.path(root) }, timeout: 25 * 60_000, ...options });
  }
  async install(root, generation, action) {
    if (!this.profileProofs.has(generation.sha)) throw new Blocked('GENERATION_PROFILE_PROOF_UNAVAILABLE');
    const space = statfsSync(this.root);
    if (space.bavail * space.bsize < 2 * 1024 ** 3) throw new Blocked('INSTALL_DISK_HEADROOM_UNAVAILABLE');
    const managerTree = action === 'install' ? generation.tree : this.trees.target;
    this.record('manager-tree:' + action, managerTree, managerTree);
    const text = await this.command(root, action, ['--prepared', generation.prepared, '--manifest', join(generation.prepared, 'manifest.json')], {}, managerTree);
    assert(text.includes('Activated SIAAS Personal ' + generation.version) || text.includes('Already installed: ' + generation.version), 'INSTALL_COMPLETION_MISSING');
    this.active.set(root, generation);
  }
  snapshot(root) { return readFileSync(ownedPath(this.root, join(this.path(root), 'current.json')), 'utf8'); }
  current(root) { return JSON.parse(this.snapshot(root)); }
  profilePath(root) { return this.current(root).profile || this.stableProfile; }
  async verify(root, generation) {
    const current = this.current(root); assert.equal(current.version, generation.version);
    assert.equal(current.tag, 'v' + generation.version);
    const directory = verifyInstalled(this.path(root), current.folder, generation.index);
    assert(current.runtime && within(this.path(root), current.runtime.node));
    assert.equal(current.runtime.version, this.config.node, 'INSTALLED_RUNTIME_VERSION');
    const node = ownedPath(this.root, current.runtime.node);
    assert.equal(digest(readFileSync(node)), current.runtime.binarySha256, 'INSTALLED_RUNTIME_HASH');
    this.active.set(root, generation);
    this.fact('metadata:' + root, { version: current.version, tag: current.tag, nodeVersion: current.runtime.version,
      profile: current.profile ? 'candidate' : 'native-default', previousVersion: current.previous?.version || null });
    this.record('installed-source:' + root, generation.sha, generation.sha);
    this.record('installed-directory:' + root, this.path(root), directory);
  }
  async metadata(root, generation) {
    await this.verify(root, generation);
    assert.equal(this.current(root).profile, join(this.path(root), 'profile'));
    assert(!existsSync(join(this.path(root), '.operation-lock')));
    await this.dispatcher(root, generation);
  }
  async dispatcher(root, generation) {
    const text = await this.audit.command('RETAINED_DISPATCHER', this.current(root).runtime.node,
      [join(this.path(root), 'source-manager.mjs'), 'status'], { cwd: this.path(root), env: this.env });
    assert.equal(JSON.parse(text).version, generation.version);
  }
  async profile(root) {
    const path = ownedPath(this.root, this.profilePath(root));
    assert(existsSync(join(path, 'siaas.sqlite')), 'ACTUAL_PROFILE_DATABASE_MISSING');
    this.record('observed-profile-database:' + root, path, join(path, 'siaas.sqlite'));
  }
  async smoke(root) {
    const tree = join(this.path(root), 'versions', this.current(root).folder);
    const harness = join(tree, '.native-acceptance'); assert(!existsSync(harness));
    cpSync(this.vendor, harness, { recursive: true, errorOnExist: true, force: false });
    const results = join(tree, 'test-results');
    const before = new Set(existsSync(results) ? readdirSync(results) : []);
    await this.audit.command('SANDBOXED_ELECTRON_SMOKE', this.current(root).runtime.node,
      [join(harness, 'desktop-smoke.mjs')], { cwd: tree, env: this.env, timeout: 240000 });
    const names = readdirSync(results).filter(name => name.startsWith('desktop-smoke-') && !before.has(name));
    assert.equal(names.length, 1, 'SMOKE_RESULT_MISSING');
    const result = JSON.parse(readFileSync(join(results, names[0], 'result.json')));
    assert.equal(result.status, 'PASS'); assert(within(this.root, result.electronProfile));
    assert(result.cleanup.every(item => item.result === 'PASS'));
    this.record('smoke-observed-userData', this.root, result.electronProfile);
    rmSync(harness, { recursive: true });
  }
  async observe(root) {
    const prefix = join(this.path(root), 'versions');
    for (let n = 0; n < 60; n++) {
      const rows = this.audit.sample().filter(p => p.executable && within(prefix, p.executable) && !p.state.startsWith('Z'));
      if (await visibleWindow(rows.map(p => p.pid)) && existsSync(join(this.profilePath(root), 'siaas.sqlite'))) {
        await this.profile(root); this.fact('gui:' + root, { visible: true, profile: this.current(root).profile ? 'candidate' : 'native-default' }); this.record('visible-window:' + root, prefix, rows.map(p => p.pid).join(',')); return;
      }
      await pause(1000);
    }
    throw new Blocked('NATIVE_GUI_OR_PROFILE_NOT_OBSERVED');
  }
  stop() { return this.audit.stop(); }
  async noApplication() { await pause(1000); assert.equal(this.audit.sample().filter(p => p.executable && within(join(this.root, 'installations'), p.executable) && !p.state.startsWith('Z')).length, 0); }
  launcherPath(root) {
    if (this.current(root).profile) return join(this.path(root), process.platform === 'win32' ? 'launch-rc.cmd' : 'launch-rc.sh');
    return process.platform === 'win32' ? join(this.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/SIAAS Personal.cmd') :
      process.platform === 'darwin' ? join(this.env.HOME, 'Applications/SIAAS Personal.command') : join(this.env.HOME, '.local/share/applications/siaas-personal.desktop');
  }
  async launcher(root) {
    const path = ownedPath(this.root, this.launcherPath(root)); assert(existsSync(path));
    const body = readFileSync(path, 'utf8'); assert(body.includes('source-manager.mjs') && body.includes('launch'));
    this.fact('launcher:' + root, { name: basename(path), profile: this.current(root).profile ? 'candidate' : 'native-default' });
    this.record('launcher:' + root, this.root, path);
    if (process.platform === 'win32') await this.audit.command('CMD_LAUNCHER', 'cmd.exe', ['/d', '/c', `"${path}"`], { env: this.env, timeout: 60000 });
    else if (path.endsWith('.desktop')) await this.audit.command('DESKTOP_LAUNCHER', 'gio', ['launch', path], { env: this.env, timeout: 60000 });
    else await this.audit.command('SHELL_LAUNCHER', '/bin/sh', [path], { env: this.env, timeout: 60000 });
  }
  async previous(root, generation) {
    const previous = this.current(root).previous; assert.equal(previous.version, generation.version);
    verifyInstalled(this.path(root), previous.folder, generation.index);
  }
  async wrapper(root, action) {
    const script = join(this.trees.target, 'scripts', `${action}.${process.platform === 'win32' ? 'ps1' : 'sh'}`);
    await this.audit.command('WRAPPER_' + action.toUpperCase(), process.platform === 'win32' ? 'powershell.exe' : 'bash',
      process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-File', script] : [script],
      { env: { ...this.env, SIAAS_INSTALL_DIR: this.path(root) }, timeout: 60000 });
  }
  async isolation(a, b) {
    assert.notEqual(this.profilePath(a), this.profilePath(b)); assert.notEqual(this.launcherPath(a), this.launcherPath(b));
    await this.userSentinel(a); await this.userSentinel(b); await this.checkUserSentinel(a); await this.checkUserSentinel(b);
    assert(!this.current(a).profile && this.current(b).profile);
  }
  async userSentinel(root) {
    const file = ownedPath(this.root, join(this.profilePath(root), 'acceptance-preserve.txt'));
    writeFileSync(file, 'preserve:' + root); this.userFiles.set(root, file);
  }
  async checkUserSentinel(root) { assert.equal(readFileSync(ownedPath(this.root, this.userFiles.get(root)), 'utf8'), 'preserve:' + root); }
  profileDigest(directory) {
    const files = {}; let bytes = 0;
    const walk = (path, prefix) => {
      for (const entry of readdirSync(ownedPath(this.root, path), { withFileTypes: true })) {
        const file = ownedPath(this.root, join(path, entry.name)), key = prefix + entry.name;
        if (entry.isDirectory()) walk(file, key + '/');
        else {
          const stat = lstatSync(file); assert(stat.isFile() && stat.nlink === 1, 'PROFILE_FILE_TYPE');
          bytes += stat.size; assert(bytes <= 500_000_000 && Object.keys(files).length < 10000, 'PROFILE_SCAN_LIMIT');
          files[key] = digest(readFileSync(file));
        }
      }
    };
    walk(directory, ''); return files;
  }
  async retained(root) { const profile = this.profilePath(root); return { versions: readdirSync(join(this.path(root), 'versions')).sort(), launcher: this.launcherPath(root), profile, profileHashes: this.profileDigest(profile) }; }
  async uninstalled(root, before) {
    assert(!existsSync(join(this.path(root), 'current.json')) && !existsSync(before.launcher));
    assert.deepEqual(readdirSync(join(this.path(root), 'versions')).sort(), before.versions);
    assert.deepEqual(this.profileDigest(before.profile), before.profileHashes, 'UNINSTALL_CHANGED_PROFILE');
  }
  async sentinels() { this.sentinel = join(this.root, 'unrelated.txt'); writeFileSync(this.sentinel, 'unrelated-user-data', { flag: 'wx' }); }
  async checkSentinels() { assert.equal(readFileSync(this.sentinel, 'utf8'), 'unrelated-user-data'); }
  async invalidSource() {
    const prepared = join(this.root, 'invalid-source'); mkdirSync(prepared); writeFileSync(join(prepared, 'source.zip'), 'invalid');
    const text = await this.command('invalid', 'install', ['--prepared', prepared, '--manifest', join(this.generations.target.prepared, 'manifest.json')], { expected: 1 });
    assert(text.includes('Source archive integrity verification failed.'));
    assert(!existsSync(join(this.path('invalid'), 'current.json')) && !existsSync(join(this.path('invalid'), '.operation-lock')));
    assert(!readdirSync(this.path('invalid')).some(p => p.startsWith('stage-'))); await this.checkSentinels();
  }
  async exclusiveLock() {
    const lock = join(this.path('locked'), '.operation-lock'); mkdirSync(lock, { recursive: true });
    const text = await this.command('locked', 'install', [], { expected: 1 });
    assert(text.includes('Another operation is running.') && existsSync(lock));
  }
  async interruption() {
    await this.command('interrupted', 'install', ['--prepared', this.generations.target.prepared, '--manifest', join(this.generations.target.prepared, 'manifest.json')],
      { interruptOn: 'Installing application dependencies with the managed runtime' });
    await this.stop(); assert(!existsSync(join(this.path('interrupted'), 'current.json')));
    const remnants = readdirSync(this.path('interrupted')).filter(p => p.startsWith('stage-') || p === '.operation-lock');
    this.fact('interruption', { lock: remnants.includes('.operation-lock'), stages: remnants.filter(p => p.startsWith('stage-')).length });
    this.record('interruption-remnants', 'legacy behavior; no automatic repair promised', remnants.join(','));
    await this.checkSentinels();
  }
  async rejectAdapter() { const text = await this.command('unsupported', 'capabilities', [], { expected: 1 }); assert(text.includes('Expected install, update, check, launch, rollback, status or uninstall.')); }
  async publicBootstrap() {
    const role = this.sha === this.config.baseline ? 'baseline' : 'candidate';
    const target = Object.keys(this.config.platforms).find(k => this.config.platforms[k].os === process.platform && this.config.platforms[k].arch === process.arch);
    try {
      const receipt = await exercisePublicBootstrap({ config: this.config, role, target, root: this.root, env: this.env,
        audit: this.audit, profileProofs: this.profileProofs, checks: {
          'installed-source-runtime': () => this.verify('bootstrap', this.generations.target),
          'automatic-gui': async () => { await this.observe('bootstrap'); await this.stop(); },
          launcher: async () => { await this.launcher('bootstrap'); await this.observe('bootstrap'); await this.stop(); },
          'uninstall-preservation': async () => {
            await this.userSentinel('bootstrap'); const before = await this.retained('bootstrap');
            await this.wrapper('bootstrap', 'uninstall'); await this.uninstalled('bootstrap', before); await this.checkUserSentinel('bootstrap');
          },
        } });
      this.record('public-bootstrap-receipt', this.sha, JSON.stringify(receipt));
    } catch (error) {
      if (error.bootstrapReceipt) this.record('public-bootstrap-receipt', this.sha, JSON.stringify(error.bootstrapReceipt));
      throw error;
    }
  }
  async dispose() {
    await this.closeServices();
    if (this.harnessCopy) rmSync(ownedPath(this.trees.target, this.harnessCopy), { recursive: true, force: true });
    if (this.dependencies) rmSync(ownedPath(this.trees.target, this.dependencies), { recursive: true, force: true });
  }
  async closeServices() {
    if (this.mock?.listening) { this.mock.closeAllConnections(); await bounded(new Promise(resolve => this.mock.close(resolve)), 5000, 'mock close'); }
  }
}
