// Native observation/cleanup only. Import is inert; local tests do not call census.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Blocked, within } from './safety.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = (exe, args) => execFileSync(exe, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 ** 2, windowsHide: true });
const query = (exe, args) => {
  const result = spawnSync(exe, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 ** 2, windowsHide: true });
  if (result.error || result.status !== 0 || !result.pid) throw new Blocked('PROCESS_CENSUS_UNAVAILABLE');
  return result;
};
export function parseProc(pid, stat, executable) {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  assert(fields.length >= 20 && /^\d+$/.test(fields[19]), 'PROCESS_IDENTITY_UNAVAILABLE');
  return { pid: Number(pid), ppid: Number(fields[1]), identity: fields[19], state: fields[0], executable };
}
export function parsePs(text) {
  return text.trim().split('\n').filter(Boolean).map(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!m) throw new Blocked('PROCESS_IDENTITY_UNAVAILABLE');
    return { pid: Number(m[1]), ppid: Number(m[2]), identity: m[3], state: m[4], executable: m[5] };
  });
}
export function census() {
  if (process.platform === 'linux') return readdirSync('/proc').filter(x => /^\d+$/.test(x)).flatMap(pid => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      let exe = ''; try { exe = readlinkSync(`/proc/${pid}/exe`); } catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
      return [parseProc(pid, stat, exe)];
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return []; throw error; }
  });
  if (process.platform === 'darwin') {
    const result = query('ps', ['-axo', 'pid=,ppid=,lstart=,stat=,comm=']);
    return parsePs(result.stdout).filter(p => p.pid !== result.pid);
  }
  if (process.platform === 'win32') {
    const result = query('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,@{N='Birth';E={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress"]);
    return [].concat(JSON.parse(result.stdout)).map(p => ({ pid: Number(p.ProcessId), ppid: Number(p.ParentProcessId),
      identity: String(p.Birth || ''), state: 'LIVE', executable: p.ExecutablePath || '' })).filter(p => p.pid !== result.pid);
  }
  throw new Blocked('PROCESS_CENSUS_UNAVAILABLE');
}
export const processKey = p => `${p.pid}:${p.identity}`;
export const unattributed = (rows, initial, selected) => {
  const keys = new Set(selected.map(processKey));
  return rows.filter(p => p.pid > 1 && !initial.has(processKey(p)) && !keys.has(processKey(p)));
};
// A recycled parent PID is not ancestry evidence. Ambiguous birth ordering is
// left unattributed (and blocks cleanup); it must never authorize a signal.
export function bornAfter(child, parent) {
  if (/^\d+$/.test(child) && /^\d+$/.test(parent)) return BigInt(child) > BigInt(parent);
  const a = Date.parse(child), b = Date.parse(parent);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}
export function selectOwned(rows, roots, known) {
  const owned = new Map(rows.filter(p => known.has(processKey(p)) ||
    (p.executable && roots.some(root => within(root, p.executable)))).map(p => [p.pid, p]));
  let added;
  do { added = false; for (const p of rows) if (!owned.has(p.pid) && owned.has(p.ppid) && bornAfter(p.identity, owned.get(p.ppid).identity)) { owned.set(p.pid, p); added = true; } } while (added);
  return [...owned.values()];
}
// No portable Node primitive binds termination to the observed birth identity.
// Do not fall back to kill(pid), taskkill /T, or a check-then-kill race.
export async function nativeTerminate() { throw new Blocked('NATIVE_IDENTITY_TERMINATOR_UNVERIFIED'); }
export class ProcessAudit {
  constructor(roots, report, backend = {}) {
    this.host = { census, spawn, wait, setTimeout, clearTimeout, setInterval, clearInterval, terminate: nativeTerminate, ...backend };
    this.commands = new Set(); this.stopping = null; this.finishing = null;
    this.roots = roots; this.report = report; this.known = new Set(); this.failure = null;
    const initial = this.host.census(); this.initial = new Set(initial.map(processKey));
    this.initialZombies = new Set(initial.filter(p => p.state.startsWith('Z')).map(processKey));
    this.last = new Map(); this.timer = this.host.setInterval(() => { try { this.sample(); } catch (e) { this.failure = e; } }, 250);
  }
  sample() {
    if (this.failure) throw this.failure;
    const rows = this.host.census(); const selected = selectOwned(rows, this.roots, this.known);
    for (const p of selected) {
      assert(p.identity, 'PROCESS_IDENTITY_UNAVAILABLE');
      const key = processKey(p); this.known.add(key);
      const observation = JSON.stringify([p.ppid, p.executable, p.state]);
      if (this.last.get(key) !== observation) {
        assert(this.report.processes.length < 1900, 'PROCESS_EVIDENCE_LIMIT');
        this.report.processes.push({ ...p, event: this.last.has(key) ? 'STATE' : 'OBSERVED' });
        this.last.set(key, observation);
      }
    }
    this.newZombies = rows.filter(p => p.state.startsWith('Z') && !this.initialZombies.has(processKey(p)));
    this.unattributed = unattributed(rows, this.initial, selected).filter(p => !p.state.startsWith('Z'));
    return selected;
  }
  command(label, exe, args, options = {}) {
    if (this.finishing) return Promise.reject(new Blocked('PROCESS_AUDIT_FINISHED'));
    if (this.stopping) return Promise.reject(new Blocked('CLEANUP_IN_PROGRESS'));
    const operation = this.runCommand(label, exe, args, options);
    this.commands.add(operation);
    void operation.finally(() => this.commands.delete(operation)).catch(() => {});
    return operation;
  }
  async runCommand(label, exe, args, { cwd, env, timeout = 15 * 60_000, expected = 0, interruptOn, signal } = {}) {
    if (signal?.aborted) throw new Blocked('COMMAND_CANCELLED');
    this.sample();
    const child = this.host.spawn(exe, args, { cwd, env, shell: false, detached: process.platform !== 'win32',
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '', interrupted = false, stopping, stopError, failureReason, childError;
    const requestStop = reason => {
      failureReason ||= reason;
      stopping ||= this.stop().catch(error => { stopError = error; });
    };
    const consume = bytes => {
      text = (text + bytes.toString()).slice(-131072);
      if (interruptOn && !interrupted && text.includes(interruptOn)) { interrupted = true; requestStop(null); }
    };
    // 'close', not 'exit': child exit alone does not establish stdout/descendant drain.
    const outcome = new Promise(yes => {
      child.once('error', error => { childError = error; requestStop(null); });
      child.once('close', (code, signal) => yes({ code, signal }));
    });
    void outcome.catch(() => {});
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    const abort = () => requestStop('COMMAND_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = this.host.setTimeout(() => requestStop('COMMAND_TIMEOUT'), timeout);
    let deadline, result, commandError, drainError;
    const drained = Promise.race([outcome, new Promise((_, reject) => {
      deadline = this.host.setTimeout(() => reject(new Blocked('COMMAND_DRAIN_UNVERIFIED')), timeout + 15000);
    })]);
    void drained.catch(() => {});
    try {
      const identity = this.host.census().find(p => p.pid === child.pid);
      if (!identity?.identity || identity.ppid !== process.pid) throw new Blocked('SPAWN_IDENTITY_UNVERIFIED');
      this.known.add(processKey(identity));
      this.sample();
    } catch (error) { commandError = error; requestStop(null); }
    try { result = await drained; }
    catch (error) { drainError = error; requestStop(null); }
    finally {
      this.host.clearTimeout(timer); this.host.clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      // Both barriers are awaited on success AND partial/spawn/observation failure.
      if (stopping) await stopping;
      child.stdout.removeListener('data', consume); child.stderr.removeListener('data', consume);
    }
    if (drainError) { this.failure = drainError; throw drainError; }
    if (stopError) { this.failure = stopError; throw stopError; }
    if (this.failure) throw this.failure;
    if (commandError) throw commandError;
    if (childError) throw childError;
    if (failureReason) throw new Blocked(failureReason);
    this.report.observations.push({ kind: 'command:' + label, expected: JSON.stringify({ exe, args, cwd }), observed: JSON.stringify(result) });
    if (interruptOn) assert(interrupted && (result.code !== 0 || result.signal), 'INTERRUPTION_NOT_OBSERVED');
    else assert.equal(result.code, expected, label + '_EXIT');
    return text;
  }
  stop() {
    if (this.stopping) return this.stopping;
    const operation = this.terminateAndDrain();
    this.stopping = operation;
    void operation.finally(() => { if (this.stopping === operation) this.stopping = null; }).catch(() => {});
    return operation;
  }
  async terminateAndDrain() {
    const rows = this.sample().filter(p => !p.state.startsWith('Z') && p.pid !== process.pid && p.pid > 1);
    // Only identities observed as owned. Never kill by image, command substring or PID 1.
    for (const item of rows.reverse()) {
      const current = this.host.census().find(p => p.pid === item.pid);
      if (!current || processKey(current) !== processKey(item)) continue;
      // Backend must atomically bind the signal to this identity, not just this PID.
      await this.host.terminate(Object.freeze({ ...current }));
    }
    for (let n = 0; n < 40; n++) {
      if (!this.sample().some(p => !p.state.startsWith('Z'))) return;
      await this.host.wait(100);
    }
    // Do not silently call an unsuccessful forced/normal cleanup PASS.
    throw new Blocked('OWNED_LIVE_PROCESS_REMAINS');
  }
  finish() {
    if (!this.finishing) this.finishing = this.finishOnce();
    return this.finishing;
  }
  async finishOnce() {
    try {
      let terminationError;
      try { await this.stop(); } catch (error) { terminationError = error; }
      await Promise.allSettled([...(this.commands || [])]);
      if (terminationError) throw terminationError;
      await (this.host?.wait || wait)(500);
      const live = this.sample().filter(p => !p.state.startsWith('Z'));
      if (live.length) {
        for (const p of live.slice(0, 50)) this.report.processes.push({ ...p, event: 'OWNED_LIVE_REMAINS' });
        throw new Blocked('OWNED_LIVE_PROCESS_REMAINS');
      }
      if (this.unattributed.length) {
        for (const p of this.unattributed.slice(0, 50)) this.report.processes.push({ ...p, event: 'UNATTRIBUTED_LIVE' });
        throw new Blocked('UNATTRIBUTED_NEW_PROCESSES');
      }
      if (this.newZombies.length) {
        for (const p of this.newZombies.slice(0, 50)) this.report.processes.push({ ...p, event: 'UNRESOLVED_ZOMBIE' });
        throw new Blocked('UNEXPLAINED_NEW_ZOMBIES');
      }
    }
    finally { (this.host?.clearInterval || clearInterval)(this.timer); }
  }
}
export async function visibleWindow(pids) {
  if (!pids.length) return false;
  if (process.platform === 'win32') {
    const result = output('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `@(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0}).Count`]);
    return Number(result.trim()) > 0;
  }
  if (process.platform === 'darwin') {
    for (const pid of pids) {
      try { if (Number(output('osascript', ['-e', `tell application "System Events" to count windows of (first application process whose unix id is ${pid})`]).trim()) > 0) return true; }
      catch { throw new Blocked('MACOS_WINDOW_OBSERVATION_PERMISSION'); }
    }
    return false;
  }
  let tree;
  try { tree = output('xwininfo', ['-root', '-tree']); } catch { throw new Blocked('X11_OBSERVER_UNAVAILABLE'); }
  const ids = [...new Set(tree.match(/0x[0-9a-f]+/g) || [])].slice(0, 128);
  for (const id of ids) {
    try {
      const pid = Number(output('xprop', ['-id', id, '_NET_WM_PID']).match(/=\s*(\d+)/)?.[1]);
      if (pids.includes(pid) && /Map State: IsViewable/.test(output('xwininfo', ['-id', id]))) return true;
    } catch { /* A window can disappear between two read-only observations. */ }
  }
  return false;
}
