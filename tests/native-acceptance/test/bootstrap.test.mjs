// Approved-looking synthetic metadata is local fixture data, not executable approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest, Blocked } from '../safety.mjs';
import { bootstrapApproval, publicPlan, exercisePublicBootstrap, bootstrapStages, bootstrapEnvironment, validateBootstrapReceipt } from '../bootstrap.mjs';
const reviewed = JSON.parse(readFileSync(new URL('../reviewed.json', import.meta.url)));
function fixture() {
  const config = structuredClone(reviewed); config.executionEnabled = true;
  const tag = 'v1.1.0-rc.3', source = `SIAAS-Personal-${tag.slice(1)}-source.zip`, base = `https://github.com/${config.repository}/releases/download/${tag}/`;
  const all = {};
  for (const { os, arch } of Object.values(config.platforms)) {
    const name = `node-v${config.node}-${os === 'win32' ? 'win' : os}-${arch}.${os === 'win32' ? 'zip' : 'tar.gz'}`;
    all[os + '-' + arch] = { schemaVersion: 1, version: tag.slice(1), platform: os, arch, name: source, size: 99, sha256: 'a'.repeat(64), downloadUrl: base + source,
      runtime: { version: config.node, name, sha256: 'b'.repeat(64), url: `https://nodejs.org/dist/v${config.node}/${name}` } };
  }
  const manifest = Buffer.from(JSON.stringify(all)), entry = Buffer.from('# UNIT TEST ONLY; never executed\n');
  const tsv = Buffer.from(Object.values(all).map(m => [m.platform,m.arch,m.version,m.name,m.size,m.sha256,m.downloadUrl,m.runtime.version,m.runtime.name,m.runtime.sha256,m.runtime.url].join('\t')).join('\n')+'\n');
  const approval = { approval: 'SYNTHETIC FIXTURE ONLY', sha: config.baseline, tag, releaseId: 1, sourceSha256: 'a'.repeat(64), sourceSize: 99,
    entrySha256: digest(entry), manifestSha256: digest(manifest), tsvSha256: digest(tsv) };
  config.publicBootstrapApprovals = { baseline: Object.fromEntries(Object.keys(config.platforms).map(k => [k, { ...approval }])) };
  const release = { id: 1, tag_name: tag, draft: false, prerelease: true, assets: ['install-rc.sh','install-rc.ps1','rc-manifests.json','rc-manifests.tsv',source].map(name => ({name,browser_download_url:base+name})) };
  return { config, approval, release, manifest, entry, tsv };
}
const plan = f => publicPlan(f.config,'baseline','linux-x64',f.release,f.config.baseline,f.manifest,f.entry,f.tsv);
test('all six public bootstrap plans select exact published scripts with matching JSON/TSV/runtime identity', () => {
  const f=fixture();
  for (const target of Object.keys(f.config.platforms)) {
    const p=publicPlan(f.config,'baseline',target,f.release,f.config.baseline,f.manifest,f.entry,f.tsv);
    assert.equal(p.entry,target.startsWith('windows')?'install-rc.ps1':'install-rc.sh');
  }
});
test('real config has no public bootstrap approval and stable mutable resolution is blocked', () => {
  assert.throws(() => bootstrapApproval(reviewed,'baseline','linux-x64'),/PUBLIC_BOOTSTRAP_REVISION_NOT_APPROVED/);
  const f=fixture();f.config.publicBootstrapApprovals.baseline['linux-x64'].tag='v1.0.0';assert.throws(()=>plan(f),/UNPINNED_STABLE_BOOTSTRAP_RESOLUTION/);
});
for (const mutation of ['tag','draft','entry','manifest','tsv','url','sha']) test('public bootstrap rejects untrusted '+mutation, () => {
  const f=fixture();
  if(mutation==='tag') f.release.tag_name='v9.0.0-rc.1';
  if(mutation==='draft') f.release.draft=true;
  if(['entry','manifest','tsv'].includes(mutation)) f[mutation]=Buffer.from('tampered');
  if(mutation==='url') f.release.assets[0].browser_download_url='https://untrusted.invalid/script';
  if(mutation==='sha') f.config.publicBootstrapApprovals.baseline['linux-x64'].sha='c'.repeat(40);
  assert.throws(()=>plan(f));
});
test('public executor invokes downloaded entrypoint unchanged, never direct prepared-source command', async () => {
  const f=fixture(),root=realpathSync(mkdtempSync(join(tmpdir(),'siaas-bootstrap-unit-'))),calls=[],checks=[];
  try {
    const get=async url=> url.includes('/releases/1')?Buffer.from(JSON.stringify(f.release)):url.includes('/git/ref/')?Buffer.from(JSON.stringify({object:{type:'commit',sha:f.config.baseline}})):url.endsWith('.json')?f.manifest:url.endsWith('.tsv')?f.tsv:f.entry;
    const report=await exercisePublicBootstrap({config:f.config,role:'baseline',target:'linux-x64',root,env:{},profileProofs:new Set([f.config.baseline]),get,
      audit:{async command(...args){calls.push(args);assert.deepEqual(readFileSync(args[2][0]),f.entry);}},
      checks:Object.fromEntries(bootstrapStages.slice(3).map(id=>[id,async()=>{checks.push(id);}]))});
    assert.equal(report.status,'PASS');assert.equal(calls.length,1);assert.equal(calls[0][1],'bash');assert.equal(calls[0][2].length,1);
    assert.equal(calls[0][3].env.SIAAS_RELEASE_TAG,'v1.1.0-rc.3');assert.equal(calls[0][3].env.SIAAS_INSTALL_DIR,join(root,'installations/bootstrap'));
    assert.deepEqual(checks,bootstrapStages.slice(3));
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('closed gate and missing profile proof prevent even downloads', async () => {
  let reads=0;const get=async()=>{reads++;throw Error('unexpected');};
  await assert.rejects(exercisePublicBootstrap({config:reviewed,get}),/PREPARATION_ONLY_POLICY_GATE/);
  const f=fixture();await assert.rejects(exercisePublicBootstrap({config:f.config,role:'baseline',target:'linux-x64',profileProofs:new Set(),get}),/GENERATION_PROFILE_PROOF_UNAVAILABLE/);
  assert.equal(reads,0);
});
test('bootstrap resolver failure preserves partial stages and never claims GUI success', async () => {
  const f=fixture();let seen;
  try {await exercisePublicBootstrap({config:f.config,role:'baseline',target:'linux-x64',profileProofs:new Set([f.config.baseline]),get:async()=>{throw new Blocked('NETWORK_UNAVAILABLE');}});}
  catch(e){seen=e;}
  assert.equal(seen.bootstrapReceipt.status,'BLOCKED');assert.equal(seen.bootstrapReceipt.stages[0].status,'BLOCKED');
  assert(seen.bootstrapReceipt.stages.slice(1).every(x=>x.status==='NOT RUN'));
});

test('Windows bootstrap architecture is derived from matching native facts, never inherited emulation flags', () => {
  for(const arch of ['x64','arm64']) {
    const env=bootstrapEnvironment({os:'win32',arch},{PROCESSOR_ARCHITEW6432:'unsafe',PROCESSOR_ARCHITECTURE:'wrong'},{os:'win32',arch,machine:arch==='x64'?'amd64':'arm64'});
    assert.equal(env.PROCESSOR_ARCHITECTURE,arch==='x64'?'AMD64':'ARM64');assert(!('PROCESSOR_ARCHITEW6432' in env));
  }
  assert.throws(()=>bootstrapEnvironment({os:'win32',arch:'arm64'},{},{os:'win32',arch:'x64',machine:'arm64'}),/BOOTSTRAP_NATIVE_ARCHITECTURE_UNVERIFIED/);
});

test('bootstrap receipt rejects incomplete PASS, omitted stages and unknown fields', () => {
  const r={schemaVersion:1,kind:'public-bootstrap',repository:reviewed.repository,applicationSha:reviewed.baseline,target:'linux-x64',releaseId:1,status:'BLOCKED',stages:bootstrapStages.map(id=>({id,status:'NOT RUN'}))};
  validateBootstrapReceipt(r);assert.throws(()=>validateBootstrapReceipt({...r,status:'PASS'}));
  assert.throws(()=>validateBootstrapReceipt({...r,stages:r.stages.slice(1)}));assert.throws(()=>validateBootstrapReceipt({...r,extra:true}));
});
