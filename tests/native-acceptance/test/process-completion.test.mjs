// Synthetic child events, clocks and identity-bound termination only. No native signals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ProcessAudit, nativeTerminate } from '../native-host.mjs';
import { cleanupOwned, runScenario } from '../cleanup.mjs';
import { initialScenarios } from '../lifecycle.mjs';
import { Blocked } from '../safety.mjs';
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const child = new EventEmitter(); child.pid = 4242; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const timers = new Map(), drain = defer(); let active = false, signals = 0, intervals = 0;
  let identity = { pid: 4242, ppid: process.pid, identity: '900', executable: '/owned/child', state: 'S' };
  const host = {
    census: () => active ? [{ ...identity }] : [],
    spawn: () => { active = true; return child; },
    setTimeout: (fn, ms) => { const id = {}; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: () => { intervals++; return {}; }, clearInterval: () => { intervals--; }, wait: async () => {},
    terminate: async p => { assert.equal(p.identity, '900'); signals++; await drain.promise; active = false; },
  };
  const report = { observations: [], processes: [] }, audit = new ProcessAudit(['/owned'], report, host);
  return { audit, report, child, drain, host, timers, get signals() { return signals; }, get intervals() { return intervals; },
    fire(ms) { const entry = [...timers.values()].find(x => x.ms === ms); assert(entry); entry.fn(); },
    close(code = 0) { active = false; child.emit('close', code, null); },
    replace(p) { identity = { ...identity, ...p }; },
  };
}
test('timeout awaits termination and child close, then reports timeout rather than cleanup PASS', async () => {
  const f = fixture(); let settled = false;
  const result = f.audit.command('UNIT', '/unit', [], { timeout: 10 });
  void result.finally(() => { settled = true; }).catch(() => {});
  f.fire(10); f.close(1); await flush(); assert.equal(settled, false); assert.equal(f.signals, 1);
  f.drain.resolve(); await assert.rejects(result, /COMMAND_TIMEOUT/);
  await f.audit.finish(); assert.equal(f.intervals, 0); assert.equal(f.timers.size, 0);
});
test('cancellation and concurrent repeated stop share one termination barrier', async () => {
  const f = fixture(), abort = new AbortController();
  const result = f.audit.command('UNIT', '/unit', [], { signal: abort.signal, timeout: 10 });
  abort.abort(); const first = f.audit.stop(), second = f.audit.stop(); assert.equal(first, second);
  await assert.rejects(f.audit.command('OVERLAP', '/unit', []), /CLEANUP_IN_PROGRESS/);
  assert.equal(f.signals, 1); f.close(1); f.drain.resolve();
  await assert.rejects(result, /COMMAND_CANCELLED/); await first;
  const a = f.audit.finish(), b = f.audit.finish(); assert.equal(a, b); await a;
  await assert.rejects(f.audit.command('LATE', '/unit', []), /PROCESS_AUDIT_FINISHED/);
});
test('exit event alone is not a stream drain barrier', async () => {
  const f = fixture(); let settled = false;
  const result = f.audit.command('UNIT', '/unit', [], { timeout: 10 }); void result.then(() => { settled = true; });
  f.child.emit('exit', 0, null); await flush(); assert.equal(settled, false);
  f.close(); await result; await f.audit.finish(); assert.equal(f.signals, 0);
});
test('partial termination failure is awaited and prevents filesystem deletion', async () => {
  const f = fixture(); const result = f.audit.command('UNIT', '/unit', [], { timeout: 10 });
  f.fire(10); f.close(1); f.drain.reject(new Blocked('TERMINATION_FAILED'));
  await assert.rejects(result, /TERMINATION_FAILED/);
  await assert.rejects(f.audit.finish(), /TERMINATION_FAILED/);
  const report = { status: 'FAIL', reason: 'INSTALL_FAILED', scenarios: initialScenarios(), cleanup: [] }; let removed = false;
  await cleanupOwned({ report, root: '/owned', audit: { finish: async () => { throw new Blocked('TERMINATION_FAILED'); } }, remove: async () => { removed = true; } });
  assert.equal(removed, false); assert.equal(report.reason, 'INSTALL_FAILED');
  assert.equal(report.scenarios.find(x => x.id === 'cleanup').reason, 'TERMINATION_FAILED');
  assert.equal(report.cleanup[0].removed, false);
});
test('initial census failure starts no sampler; missing audit cannot claim checked cleanup', async () => {
  let timers = 0;
  assert.throws(() => new ProcessAudit([], {}, { census() { throw new Blocked('PROCESS_CENSUS_UNAVAILABLE'); }, setInterval() { timers++; } }));
  assert.equal(timers, 0); let removed = false;
  const report = { status: 'FAIL', reason: 'PROCESS_CENSUS_UNAVAILABLE', scenarios: initialScenarios(), cleanup: [] };
  await cleanupOwned({ report, root: '/owned', remove: async () => { removed = true; } });
  assert.equal(removed, false); assert.equal(report.cleanup[0].reason, 'PROCESS_AUDIT_NOT_INITIALIZED');
  assert.equal(report.reason, 'PROCESS_CENSUS_UNAVAILABLE');
});
test('cleanup preserves ordering and accurate removal evidence on service failure', async () => {
  const order = [], report = { status: 'PASS', reason: 'UNIT', scenarios: initialScenarios(), cleanup: [] };
  await cleanupOwned({ report, root: '/owned', audit: { finish: async () => { order.push('drain'); } },
    dispose: async () => { order.push('dispose'); }, remove: async () => { order.push('remove'); },
    closeServices: async () => { order.push('service'); throw new Blocked('SERVICE_CLOSE_FAILED'); } });
  assert.deepEqual(order.slice(0, 4), ['drain', 'dispose', 'remove', 'service']);
  assert.equal(report.status, 'BLOCKED'); assert.equal(report.cleanup[0].removed, true);
  assert.equal(report.scenarios.find(x => x.id === 'cleanup').status, 'BLOCKED');
});
test('scenario attribution preserves timeout and persistence failures', async () => {
  const rows = initialScenarios();
  await assert.rejects(runScenario(rows, 'real-update', async () => { throw new Blocked('COMMAND_TIMEOUT'); }), /COMMAND_TIMEOUT/);
  assert.equal(rows.find(x => x.id === 'real-update').reason, 'COMMAND_TIMEOUT');
  await assert.rejects(runScenario(rows, 'rollback', async () => {}, () => { throw Error('disk full'); }));
  assert.equal(rows.find(x => x.id === 'rollback').reason, 'RECEIPT_PERSISTENCE_FAILED');
});
test('native termination is blocked; no PID-only or Windows tree fallback exists', async () => {
  await assert.rejects(nativeTerminate({ pid: 4242, identity: '900' }), /NATIVE_IDENTITY_TERMINATOR_UNVERIFIED/);
});
test('reused identity is never passed to the termination backend for an old observation', async () => {
  const f = fixture(); f.host.spawn(); f.audit.sample();
  let reads = 0;
  f.audit.host.census = () => [{ pid: 4242, ppid: 1, identity: ++reads === 1 ? '900' : '901', executable: reads === 1 ? '/owned/child' : '/system/other', state: 'S' }];
  await f.audit.stop(); assert.equal(f.signals, 0);
  await assert.rejects(f.audit.finish(), /UNATTRIBUTED_NEW_PROCESSES/);
});
test('drain deadline cannot turn missing close into success', async () => {
  const f = fixture(), result = f.audit.command('UNIT', '/unit', [], { timeout: 10 });
  f.fire(15010); f.drain.resolve();
  await assert.rejects(result, /COMMAND_DRAIN_UNVERIFIED/);
  await assert.rejects(f.audit.finish(), /COMMAND_DRAIN_UNVERIFIED/);
});

test('whole cleanup repeats share one barrier and never repeat disposal/removal', async () => {
  const gate = defer(), calls = [], report = { status: 'PASS', reason: 'UNIT', scenarios: initialScenarios(), cleanup: [] };
  const options = { report, root: '/owned', audit: { finish: async () => { calls.push('finish'); await gate.promise; } },
    dispose: async () => { calls.push('dispose'); }, remove: async () => { calls.push('remove'); } };
  const a = cleanupOwned(options), b = cleanupOwned(options); assert.equal(a, b);
  gate.resolve(); await a; await cleanupOwned(options);
  assert.deepEqual(calls, ['finish', 'dispose', 'remove']); assert.equal(report.cleanup.length, 1);
});

test('detached descendant birth identity remains owned and changed parent/executable are recorded', async () => {
  const f=fixture();f.host.spawn();f.audit.sample();
  f.replace({ppid:99,executable:'/system/helper'});const rows=f.audit.sample();
  assert.equal(rows.length,1);assert.equal(rows[0].identity,'900');
  assert.equal(f.report.processes.at(-1).ppid,99);assert.equal(f.report.processes.at(-1).executable,'/system/helper');
  f.close();await f.audit.finish();
});

test('finalization drains outstanding command settlements even when termination fails', async () => {
  const audit=Object.create(ProcessAudit.prototype), gate=defer();let settled=false;
  audit.stop=async()=>{throw new Blocked('TERMINATION_FAILED');};audit.commands=new Set([gate.promise]);
  const result=audit.finish();void result.finally(()=>{settled=true;}).catch(()=>{});
  await flush();assert.equal(settled,false);gate.resolve();await assert.rejects(result,/TERMINATION_FAILED/);
});

test('first spawn observation with another parent is not registered as an owned identity', async () => {
  const f=fixture();f.replace({ppid:1,executable:'/system/unrelated'});
  const result=f.audit.command('UNIT','/unit',[],{timeout:10});
  f.child.emit('close',1,null);
  await assert.rejects(result,/SPAWN_IDENTITY_UNVERIFIED/);assert.equal(f.audit.known.size,0);assert.equal(f.signals,0);
  await assert.rejects(f.audit.finish(),/UNATTRIBUTED_NEW_PROCESSES/);
});

test('child error still waits for close and the shared termination barrier', async () => {
  const f=fixture();let settled=false;const result=f.audit.command('UNIT','/unit',[],{timeout:10});
  void result.finally(()=>{settled=true;}).catch(()=>{});
  f.child.emit('error',new Error('CHILD_FAILED'));f.drain.resolve();await flush();assert.equal(settled,false);
  f.close(1);await assert.rejects(result,/CHILD_FAILED/);await f.audit.finish();
});
