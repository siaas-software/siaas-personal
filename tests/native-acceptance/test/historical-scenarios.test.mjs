// Orchestration-only fixtures: no historical source is imported or executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseUpgrade, exerciseCoexistence, initialScenarios } from '../lifecycle.mjs';
import { requireHistory } from '../plan.mjs';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../reviewed.json', import.meta.url)));
function fixture() {
  const calls = [];
  const driver = { calls, generations: { target:{sha:config.baseline,version:'1.1.0-rc.3'},
    previous:{sha:'84a1ffab4e5f339519bc80844d88ddcd573f561f',version:'1.1.0-rc.2'},
    stable:{sha:'1bce852cabbefb2459aeafc5aa42146eabd6283b',version:'1.0.0'} } };
  for (const name of ['install','verify','observe','stop','userSentinel','previous','checkUserSentinel','wrapper','noApplication','dispatcher','launcher','isolation'])
    driver[name] = async (...args) => calls.push([name,...args.map(x => x?.version || x)]);
  driver.snapshot = async root => { calls.push(['snapshot',root]); return 'synthetic-unchanged-metadata'; };
  return driver;
}
test('A: RC2 seed verified before real RC3 update; rollback verifies original RC2 and dispatcher', async () => {
  const d=fixture(); delete d.generations.stable;
  const rows=initialScenarios(); await exerciseUpgrade(d,rows);
  assert.deepEqual(d.calls.filter(c=>['install','verify','wrapper','dispatcher'].includes(c[0])),[
    ['install','upgrade','1.1.0-rc.2','install'],['verify','upgrade','1.1.0-rc.2'],
    ['install','upgrade','1.1.0-rc.3','update'],['verify','upgrade','1.1.0-rc.3'],
    ['wrapper','upgrade','rollback'],['verify','upgrade','1.1.0-rc.2'],['dispatcher','upgrade','1.1.0-rc.2']]);
  assert.equal(d.calls.filter(c=>c[0]==='checkUserSentinel').length,2);
  assert(rows.filter(r=>['real-update','rollback','retained-manager'].includes(r.id)).every(r=>r.status==='PASS'));
  assert.equal(rows.find(r=>r.id==='stable-rc-isolation').status,'NOT RUN');
});
for(const previous of [null,{sha:config.baseline,version:'1.1.0-rc.2'},{sha:'b'.repeat(40),version:'1.1.0-rc.3'},{sha:'b'.repeat(40),version:'1.1.0-rc.4'},{sha:'b'.repeat(40),version:'1.0.0'}])
  test('A: absent/same/reversed/wrong-channel history is rejected: '+JSON.stringify(previous),async()=>{
    const d=fixture();d.generations.previous=previous;await assert.rejects(exerciseUpgrade(d,initialScenarios()));assert.equal(d.calls.length,0);
  });
test('A: failed old-source verification prevents the update and subsequent rollback', async () => {
  const d=fixture();d.verify=async()=>{throw Error('INSTALLED_SOURCE_MISMATCH');};const rows=initialScenarios();
  await assert.rejects(exerciseUpgrade(d,rows),/INSTALLED_SOURCE_MISMATCH/);
  assert.equal(d.calls.filter(c=>c[0]==='install').length,1);assert.equal(rows.find(r=>r.id==='rollback').status,'NOT RUN');
});
test('B: stable coexistence is separate from update and checks unchanged RC metadata plus both launchers/profiles', async () => {
  const d=fixture();delete d.generations.previous;const rows=initialScenarios();await exerciseCoexistence(d,rows);
  assert.deepEqual(d.calls.filter(c=>c[0]==='install'),[['install','stable','1.0.0','install']]);
  assert.deepEqual(d.calls.filter(c=>c[0]==='snapshot'),[['snapshot','fresh'],['snapshot','fresh']]);
  assert(d.calls.some(c=>c[0]==='isolation'&&c[1]==='stable'&&c[2]==='fresh'));
  assert.equal(rows.find(r=>r.id==='real-update').status,'NOT RUN');
});
test('B: changed candidate metadata blocks stable launcher acceptance', async () => {
  const d=fixture();let n=0;d.snapshot=async()=>++n;const rows=initialScenarios();
  await assert.rejects(exerciseCoexistence(d,rows),/STABLE_CHANGED_CANDIDATE/);
  assert.equal(rows.find(r=>r.id==='stable-launcher').status,'NOT RUN');
});
test('C: role SHAs differ but RC3 version equivalence does not authorize an update or historical execution', () => {
  assert.notEqual(config.baseline,config.candidate);assert.equal(config.executionEnabled,false);
  assert.deepEqual(config.historicalRevisions,{stable:null,previousCandidate:null});assert.throws(()=>requireHistory(config),/HISTORICAL_REVISION_NOT_APPROVED/);
});
