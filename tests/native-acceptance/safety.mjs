// Test-only boundaries. No application module is imported by this file.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

export class Blocked extends Error {}
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 ** 2 }).trim();
export function within(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}
export function ownedPath(root, path) {
  assert(within(root, path), 'PATH_ESCAPES_ROOT');
  // Check every existing component, including Windows junctions. Fail closed on a
  // canonical-path mismatch (including an unrecognized native reparse behavior).
  let cursor = resolve(root);
  for (const part of ['', ...relative(cursor, resolve(path)).split(sep).filter(Boolean)]) {
    cursor = part ? join(cursor, part) : cursor;
    let stat;
    try { stat = lstatSync(cursor); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    assert(!stat.isSymbolicLink(), 'LINK_IN_OWNED_PATH');
    assert.equal(realpathSync(cursor), cursor, 'CANONICAL_PATH_MISMATCH');
  }
  return resolve(path);
}
export function cleanEnvironment(root, inherited = process.env) {
  const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC',
    'PATHEXT', 'LANG', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];
  const env = Object.fromEntries(allowed.filter(k => inherited[k] !== undefined).map(k => [k, inherited[k]]));
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
    if (env[name]) { const u = new URL(env[name]); assert(!u.username && !u.password, 'CREDENTIAL_BEARING_PROXY'); }
  }
  const paths = Object.fromEntries(['home', 'tmp', 'config', 'cache', 'data', 'runtime', 'appdata', 'localappdata', 'npm-cache', 'electron-cache']
    .map(name => [name, ownedPath(root, join(root, name))]));
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const npmrc = join(root, 'empty.npmrc'); writeFileSync(npmrc, '', { flag: 'wx', mode: 0o600 });
  return { ...env, CI: 'true', NEXT_TELEMETRY_DISABLED: '1', NODE_USE_ENV_PROXY: '1',
    HOME: paths.home, USERPROFILE: paths.home, TMPDIR: paths.tmp, TMP: paths.tmp, TEMP: paths.tmp,
    XDG_CONFIG_HOME: paths.config, XDG_CACHE_HOME: paths.cache, XDG_DATA_HOME: paths.data,
    XDG_RUNTIME_DIR: paths.runtime, APPDATA: paths.appdata, LOCALAPPDATA: paths.localappdata,
    npm_config_cache: paths['npm-cache'], npm_config_userconfig: npmrc,
    electron_config_cache: paths['electron-cache'] };
}
export function versionOrder(a, b) {
  const parse = value => {
    assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.test(value), 'INVALID_VERSION');
    const [core, rc] = value.split('-rc.'); return [...core.split('.').map(Number), rc === undefined ? Infinity : Number(rc)];
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export function sourceIndex(tree, sha) {
  assert.equal(git(tree, 'rev-parse', 'HEAD'), sha, 'CHECKOUT_SHA_MISMATCH');
  assert(/^https:\/\/github\.com\/siaas-software\/siaas-personal(?:\.git)?$/.test(git(tree, 'remote', 'get-url', 'origin')), 'CHECKOUT_REPOSITORY');
  assert.equal(git(tree, 'status', '--porcelain', '--untracked-files=no'), '', 'DIRTY_SOURCE');
  const entries = execFileSync('git', ['ls-tree', '-rz', '--full-tree', sha], { cwd: tree, timeout: 20000, maxBuffer: 32 * 1024 ** 2 }).toString().split('\0').filter(Boolean);
  assert(entries.length > 0 && entries.length < 10000, 'SOURCE_FILE_LIMIT');
  return entries.map(entry => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    assert(match && !/[\\:\x00-\x1f]/.test(match[3]) && match[3].split('/').every(s => s && s !== '.' && s !== '..') && !isAbsolute(match[3]), 'UNSAFE_SOURCE_ENTRY');
    return { path: match[3], blob: match[2] };
  });
}
export function verifyInstalled(root, folder, index) {
  const directory = ownedPath(root, join(root, 'versions', folder));
  for (const item of index) {
    const file = ownedPath(root, join(directory, item.path));
    assert(lstatSync(file).isFile(), 'INSTALLED_FILE_TYPE');
    const bytes = readFileSync(file);
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blob, item.blob, `INSTALLED_SOURCE_MISMATCH:${item.path}`);
  }
  return directory;
}
