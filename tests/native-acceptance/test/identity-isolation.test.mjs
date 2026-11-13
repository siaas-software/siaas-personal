// Deterministic bridge/observation fixtures. No process creation, syscalls, signals,
// Electron launch, historical imports or native filesystem observers are executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityController } from '../identity-handles.mjs';
import { validateIsolationEvidence } from '../isolation-evidence.mjs';
import { NativeDriver } from '../driver.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fake(platform = 'linux') {
  const handle = Object.freeze({}), ticket = Object.freeze({}), events = [];
  let current = { identity: { platform, pid: 42, birth: '900', scope: 'unit-boot-namespace-or-session' }, state: 'live' };
  const bridge = {
    async claimOwned(value) { assert.equal(value, ticket); events.push('claim'); return { authority: 'owned-spawn', handle, identity: { ...current.identity } }; },
    async inspect(value) { assert.equal(value, handle); events.push('inspect'); return structuredClone(current); },
    async requestTermination(value) { assert.equal(value, handle); events.push('request'); },
    async waitExit(value, timeout) { assert.equal(value, handle); assert.equal(timeout, 4000); events.push('wait'); return true; },
    async close(value) { assert.equal(value, handle); events.push('close'); },
  };
  return { bridge, ticket, events, set(value) { current = value; }, get current() { return current; } };
}
for (const platform of ['linux', 'win32']) test('identity-bound handle contract: ' + platform, async () => {
  const f = fake(platform), controller = identityController(platform, f.bridge), token = await controller.capture(f.ticket);
  const result = await controller.terminate(token);
  assert.equal(result.state, 'EXIT_OBSERVED'); assert.equal(result.reaping, 'UNVERIFIED');
  assert.deepEqual(f.events, ['claim','inspect','inspect','request','wait','close']);
  await controller.terminate(token); assert.equal(f.events.filter(x => x === 'request').length, 1);
});
test('macOS has no justified fallback and fabricated PID tokens are rejected', async () => {
  const f = fake(); assert.throws(() => identityController('darwin', f.bridge), /IDENTITY_BACKEND_UNJUSTIFIED/);
  const controller = identityController('linux', f.bridge);
  await assert.rejects(controller.terminate({ pid: 42 }), /UNKNOWN_OWNERSHIP_TOKEN/); assert.deepEqual(f.events, []);
});
for (const field of ['pid','birth','scope']) test('identity mismatch never signals: ' + field, async () => {
  const f = fake(), controller = identityController('linux', f.bridge), token = await controller.capture(f.ticket);
  f.set({ ...f.current, identity: { ...f.current.identity, [field]: field === 'pid' ? 43 : '901' } });
  await assert.rejects(controller.terminate(token), /HANDLE_IDENTITY_CHANGED/);
  assert(!f.events.includes('request')); assert.equal(f.events.at(-1), 'close');
});
test('unowned capture closes handle and cannot create an authorization token', async () => {
  const f = fake(), original = f.bridge.claimOwned;
  f.bridge.claimOwned = async t => ({ ...await original(t), authority: 'census-only' });
  await assert.rejects(identityController('linux', f.bridge).capture(f.ticket), /OWNERSHIP_NOT_ESTABLISHED/);
  assert.deepEqual(f.events, ['claim','close']);
});
test('identity changes during handle acquisition are rejected before registration', async () => {
  const f = fake(), original = f.bridge.inspect;
  f.bridge.inspect = async h => { const value = await original(h); value.identity.birth = '901'; return value; };
  await assert.rejects(identityController('linux', f.bridge).capture(f.ticket), /HANDLE_IDENTITY_CHANGED/);
  assert(!f.events.includes('request')); assert.equal(f.events.at(-1), 'close');
});
test('successful termination request without exit is BLOCKED and closes handle', async () => {
  const f = fake(); f.bridge.waitExit = async () => false;
  const c = identityController('linux', f.bridge), t = await c.capture(f.ticket);
  await assert.rejects(c.terminate(t), /HANDLE_EXIT_UNVERIFIED/); assert.equal(f.events.at(-1), 'close');
});
test('permission failure has no PID fallback and finalizes exactly once', async () => {
  const f = fake(); f.bridge.requestTermination = async () => { throw Error('ACCESS_DENIED'); };
  const c = identityController('linux', f.bridge), t = await c.capture(f.ticket);
  await assert.rejects(c.terminate(t), /ACCESS_DENIED/); await assert.rejects(c.terminate(t), /ACCESS_DENIED/);
  assert.equal(f.events.filter(x => x === 'close').length, 1);
});
for (const state of ['exited', 'zombie']) test('already ' + state + ' is never signaled or called reaped', async () => {
  const f = fake(); f.set({ ...f.current, state });
  const c = identityController('linux', f.bridge), t = await c.capture(f.ticket), result = await c.terminate(t);
  assert.equal(result.reaping, 'UNVERIFIED'); assert(!f.events.includes('request'));
});
test('concurrent timeout/cancellation callers join the same handle operation', async () => {
  const f = fake(), gate = deferred(); f.bridge.waitExit = async () => { await gate.promise; return true; };
  const c = identityController('linux', f.bridge), t = await c.capture(f.ticket), a = c.terminate(t), b = c.terminate(t);
  assert.equal(a,b); gate.resolve(); await a; assert.equal(f.events.filter(x => x === 'request').length,1);
});
function proof(platform) {
  const root = platform === 'win32' ? 'C:\\unit' : '/unit'; const sep = platform === 'win32' ? '\\' : '/';
  const p = tail => root + sep + tail.split('/').join(sep);
  const expected = { sourceSha: 'a'.repeat(40), platform, arch: 'x64', root, userData: p('rc/profile'), launcher: p('rc/launch') };
  const data = { kind:'personal-native-observation', sourceSha:expected.sourceSha,platform,arch:'x64',root,
    environmentHome:p('home'),nodeHome:p('home'),nativeHome:p('home'),nativeAppData:p('appdata'),nativePrograms:p('programs'),
    electronUserData:expected.userData,launcher:expected.launcher,canonicalPaths:{},
    observer:{backend:'synthetic-unit-observer',treeComplete:true,startedBeforeSpawn:true,endedAfterExit:true,droppedEvents:0,sandbox:true,personalProcessIdentity:'unit-personal-birth',ownedProcessIdentities:['unit-personal-birth','unit-manager-birth']},
    writes:[{path:p('rc/profile/siaas.sqlite'),canonicalPath:p('rc/profile/siaas.sqlite'),processIdentity:'unit-personal-birth'},
      {path:expected.launcher,canonicalPath:expected.launcher,processIdentity:'unit-manager-birth'}] };
  for (const key of ['environmentHome','nodeHome','nativeHome','nativeAppData','nativePrograms','electronUserData','launcher']) data.canonicalPaths[key]=data[key];
  return {data,expected};
}
for (const platform of ['linux','win32','darwin']) test('reported isolation paths validate with explicit platform semantics: '+platform, () => {
  const {data,expected}=proof(platform); assert.equal(validateIsolationEvidence(data,expected),data);
  data.nativeAppData=platform==='win32'?'C:\\Users\\real\\AppData':'/real/appdata';
  assert.throws(()=>validateIsolationEvidence(data,expected),/NATIVE_PATH_ESCAPES_OR_REDIRECTS/);
});
test('environment-only / generic Electron probe cannot grant native installation proof', async () => {
  const {data,expected}=proof('linux'); data.kind='generic-electron-preflight';
  assert.throws(()=>validateIsolationEvidence(data,expected),/PERSONAL_PROFILE_OBSERVATION_MISSING/);
  const driver=new NativeDriver({}); driver.profilePreflights.add(expected.sourceSha);
  await assert.rejects(driver.install('fresh',{sha:expected.sourceSha},'install'),/GENERATION_PROFILE_PROOF_UNAVAILABLE/);
});
for (const mutate of [d=>d.observer.droppedEvents++,d=>d.observer.treeComplete=false,d=>d.observer.startedBeforeSpawn=false,d=>d.observer.endedAfterExit=false,d=>d.observer.sandbox=false,
 d=>d.writes=[],d=>d.writes[0].processIdentity='other',d=>d.writes[1].path='/outside',d=>d.canonicalPaths.launcher='/real/launcher',d=>d.electronUserData='/unit/other']) {
 test('incomplete/escaped native observation fails closed: '+mutate.toString(),()=>{const {data,expected}=proof('linux');mutate(data);assert.throws(()=>validateIsolationEvidence(data,expected));});
}
test('Windows drive escapes and junction redirection are not hidden by environment strings', () => {
  const {data,expected}=proof('win32'); data.writes[0].canonicalPath='D:\\real\\siaas.sqlite';
  assert.throws(()=>validateIsolationEvidence(data,expected),/UNOWNED_OR_REDIRECTED_WRITE/);
});

test('duplicate claim cannot close or reauthorize an already-owned handle', async () => {
  const f=fake(),c=identityController('linux',f.bridge),t=await c.capture(f.ticket);
  await assert.rejects(c.capture(f.ticket),/HANDLE_ALREADY_CLAIMED/);assert(!f.events.includes('close'));
  await c.terminate(t);assert.equal(f.events.filter(x=>x==='close').length,1);
});
test('invalid deadlines never request termination and close failure cannot return exit success', async () => {
  const f=fake(),c=identityController('linux',f.bridge),t=await c.capture(f.ticket);
  for(const ms of [0,10001,NaN]) await assert.rejects(c.terminate(t,ms),/INVALID_TERMINATION_DEADLINE/);
  assert(!f.events.includes('request'));f.bridge.close=async()=>{throw Error('HANDLE_CLOSE_FAILED');};
  await assert.rejects(c.terminate(t),/HANDLE_CLOSE_FAILED/);
});
test('ambiguous write ownership and Windows stream/path aliases are rejected', () => {
  const {data,expected}=proof('win32'); data.writes[0].path+=':stream';data.writes[0].canonicalPath=data.writes[0].path;
  assert.throws(()=>validateIsolationEvidence(data,expected),/WINDOWS_PATH_ALIAS_UNSUPPORTED/);
  const f=proof('linux');f.data.observer.ownedProcessIdentities=[];
  assert.throws(()=>validateIsolationEvidence(f.data,f.expected),/NATIVE_OWNERSHIP_EVIDENCE_MISSING/);
});


test('concurrent captures reserve handle before inspection and cannot double-close', async () => {
  const f = fake(), gate = deferred(), original = f.bridge.inspect;
  f.bridge.inspect = async h => { await gate.promise; return original(h); };
  const c = identityController('linux', f.bridge), first = c.capture(f.ticket);
  await assert.rejects(c.capture(f.ticket), /HANDLE_ALREADY_CLAIMED/);
  assert(!f.events.includes('close')); gate.resolve();
  await c.terminate(await first);
  assert.equal(f.events.filter(x => x === 'request').length, 1);
  assert.equal(f.events.filter(x => x === 'close').length, 1);
});
