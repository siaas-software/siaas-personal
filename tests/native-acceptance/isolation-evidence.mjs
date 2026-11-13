// Validates reported native observations, not their authenticity. No observer is
// implemented here. Synthetic unit receipts never establish native acceptance.
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { Blocked } from './safety.mjs';
export function validateIsolationEvidence(proof, expected) {
  const fail = code => { throw new Blocked(code); };
  if (!proof || proof.kind !== 'personal-native-observation') fail('PERSONAL_PROFILE_OBSERVATION_MISSING');
  assert.deepEqual(Object.keys(proof).sort(), ['kind','sourceSha','platform','arch','root','environmentHome','nodeHome','nativeHome','nativeAppData','nativePrograms','electronUserData','launcher','canonicalPaths','writes','observer'].sort());
  for (const k of ['sourceSha','platform','arch','root']) if (proof[k] !== expected[k]) fail('ISOLATION_CONTEXT_MISMATCH');
  if (!/^[a-f0-9]{40}$(?![\s\S])/.test(proof.sourceSha) || !['linux','win32','darwin'].includes(proof.platform) || !['x64','arm64'].includes(proof.arch)) fail('ISOLATION_CONTEXT_MISMATCH');
  const path = proof.platform === 'win32' ? win32 : posix;
  const normal = value => {
    if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value) || !path.isAbsolute(value)) fail('NATIVE_PATH_INVALID');
    if (proof.platform === 'win32' && (value.slice(2).includes(':') || value.split(/[\\/]/).some(part => /[. ]$/.test(part)))) fail('WINDOWS_PATH_ALIAS_UNSUPPORTED');
    const result = path.normalize(value); return proof.platform === 'win32' ? result.toLowerCase() : result;
  };
  const root = normal(expected.root);
  const owned = value => { const rel = path.relative(root, normal(value)); return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)); };
  const paths = ['environmentHome','nodeHome','nativeHome','nativeAppData','nativePrograms','electronUserData','launcher'];
  assert.deepEqual(Object.keys(proof.canonicalPaths).sort(), [...paths].sort());
  for (const key of paths) {
    if (!owned(proof[key]) || normal(proof[key]) !== normal(proof.canonicalPaths[key])) fail('NATIVE_PATH_ESCAPES_OR_REDIRECTS');
  }
  if (normal(proof.environmentHome) !== normal(proof.nodeHome) || normal(proof.nodeHome) !== normal(proof.nativeHome)) fail('NATIVE_HOME_DISAGREES');
  if (normal(proof.electronUserData) !== normal(expected.userData) || normal(proof.launcher) !== normal(expected.launcher)) fail('PROFILE_OR_LAUNCHER_MISMATCH');
  assert.deepEqual(Object.keys(proof.observer).sort(), ['backend','treeComplete','startedBeforeSpawn','endedAfterExit','droppedEvents','sandbox','personalProcessIdentity','ownedProcessIdentities'].sort());
  const o = proof.observer;
  if (typeof o.backend !== 'string' || !o.backend || o.backend.length > 100 || o.treeComplete !== true || o.startedBeforeSpawn !== true || o.endedAfterExit !== true || o.droppedEvents !== 0 || o.sandbox !== true ||
      typeof o.personalProcessIdentity !== 'string' || !o.personalProcessIdentity || o.personalProcessIdentity.length > 200) fail('NATIVE_OBSERVER_INCOMPLETE');
  if (!Array.isArray(o.ownedProcessIdentities) || o.ownedProcessIdentities.length > 2000 || !o.ownedProcessIdentities.includes(o.personalProcessIdentity) || new Set(o.ownedProcessIdentities).size !== o.ownedProcessIdentities.length || !o.ownedProcessIdentities.every(x => typeof x === 'string' && x.length > 0 && x.length <= 200)) fail('NATIVE_OWNERSHIP_EVIDENCE_MISSING');
  if (!Array.isArray(proof.writes) || proof.writes.length === 0 || proof.writes.length > 10000) fail('NATIVE_WRITE_EVIDENCE_MISSING');
  let profileWrite = false, launcherWrite = false;
  for (const event of proof.writes) {
    assert.deepEqual(Object.keys(event).sort(), ['path','canonicalPath','processIdentity'].sort());
    if (typeof event.processIdentity !== 'string' || !event.processIdentity || event.processIdentity.length > 200 || !o.ownedProcessIdentities.includes(event.processIdentity) || !owned(event.path) || normal(event.path) !== normal(event.canonicalPath)) fail('UNOWNED_OR_REDIRECTED_WRITE');
    const rel = path.relative(normal(expected.userData), normal(event.path));
    if (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) && event.processIdentity === o.personalProcessIdentity) profileWrite = true;
    if (normal(event.path) === normal(expected.launcher)) launcherWrite = true;
  }
  if (!profileWrite || !launcherWrite) fail('PROFILE_OR_LAUNCHER_WRITES_UNOBSERVED');
  return proof;
}
