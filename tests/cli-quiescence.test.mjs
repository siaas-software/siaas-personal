import test from 'node:test';
import * as requireFS from 'node:fs';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {leaseRunning,requireStopped} from '../scripts/lib/cli-quiescence.mjs';
const record={schemaVersion:1,pid:42,start:'900',boot:'11111111-1111-1111-1111-111111111111',executable:'/owned/versions/1/dist/siaas'};
const stat=(start='900',state='S')=>'42 (name with brackets)) '+[state,'1',...Array(17).fill('0'),start].join(' ');
function host({start='900',state='S',error,exe=record.executable}={}){let exeReads=0;return {readFileSync(p){if(p.endsWith('boot_id'))return record.boot+'\n';if(error)throw Object.assign(Error(error),{code:error});return stat(start,state)},readlinkSync(){exeReads++;return exe},get exeReads(){return exeReads}};}
test('known live owned process blocks regardless of arguments',()=>assert.equal(leaseRunning(record,'/owned',host()),true));
test('reused PID and stale zombie never query unrelated executable',()=>{for(const h of [host({start:'901'}),host({state:'Z'})]){assert.equal(leaseRunning(record,'/owned',h),false);assert.equal(h.exeReads,0)}});
test('inaccessible known process fails closed; vanished process is stale',()=>{assert.throws(()=>leaseRunning(record,'/owned',host({error:'EACCES'})),/EACCES/);assert.equal(leaseRunning(record,'/owned',host({error:'ENOENT'})),false)});
test('mismatched executable or invalid lease cannot authorize mutation',()=>{assert.throws(()=>leaseRunning(record,'/owned',host({exe:'/other'})),/identity changed/);assert.throws(()=>leaseRunning({...record,pid:1},'/owned',host()),/Invalid/)});
test('fresh claimed root does not enumerate any global processes; partial roots refuse',()=>{
 const root=mkdtempSync(join(tmpdir(),'siaas-fresh-'));
 try{assert.throws(()=>requireStopped(root,null));writeFileSync(join(root,'cli-owner.json'),JSON.stringify({schemaVersion:1,protocol:'siaas.personal.first-party-m2',root}));mkdirSync(join(root,'.cli-lock'));requireStopped(root,null);mkdirSync(join(root,'versions','partial'),{recursive:true});assert.throws(()=>requireStopped(root,null),/partial/)}finally{rmSync(root,{recursive:true,force:true})}
});
test('old managed generations without lease protocol fail closed',()=>{const root=mkdtempSync(join(tmpdir(),'siaas-lease-'));try{assert.throws(()=>requireStopped(root,{cliManaged:1}),/protocol/);requireStopped(root,{cliManaged:1,instanceProtocol:1})}finally{rmSync(root,{recursive:true,force:true})}});

test('native Linux lease observes only its owned child and detects exit', {skip:process.platform!=='linux'}, async()=>{
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {copyFileSync,chmodSync}=await import('node:fs');
 const {captureLease}=await import('../scripts/lib/cli-quiescence.mjs');
 const root=mkdtempSync(join(tmpdir(),'siaas-native-lease-'));
 let child;
 try{
  const dir=join(root,'versions','fixture');mkdirSync(dir,{recursive:true});
  const binary=join(dir,'sleep');copyFileSync('/bin/sleep',binary);chmodSync(binary,0o700);
  child=spawn(binary,['0.3'],{stdio:'ignore'});const exited=once(child,'close');await once(child,'spawn');
  const lease=captureLease(child.pid,binary);writeFileSync(join(root,'instance.json'),JSON.stringify(lease));
  assert.equal(leaseRunning(lease,root),true);assert.throws(()=>requireStopped(root,{cliManaged:1,instanceProtocol:1}),/running/);
  await exited;assert.equal(leaseRunning(lease,root),false);requireStopped(root,{cliManaged:1,instanceProtocol:1});
 }finally{if(child?.exitCode===null)await once(child,'close');rmSync(root,{recursive:true,force:true})}
});

test('managed launch refuses an existing operation lock and cleans its own lock', {skip:process.platform!=='linux'},async()=>{
 const {createSourceDesktop}=await import('../scripts/lib/source-desktop.mjs');
 const {copyFileSync,existsSync}=await import('node:fs');
 const {createHash}=await import('node:crypto');
 const {readFileSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'siaas-launch-lock-'));
 try{
  const source=join(root,'versions','fixture');mkdirSync(join(source,'dist','unpacked'),{recursive:true});
  // /bin/true is an actual native executable; no profile/GUI, no sandbox flags.
  const exe=join(source,'dist','unpacked','siaas');copyFileSync('/bin/true',exe);
  const runtime={version:process.versions.node,node:process.execPath,npm:process.execPath,binarySha256:createHash('sha256').update(readFileSync(process.execPath)).digest('hex')};
  const item={cliManaged:1,instanceProtocol:1,runtime};
  const desktop=createSourceDesktop({root,installed:()=>item,folder:()=>source});
  mkdirSync(join(root,'.operation-lock'));
  await assert.rejects(desktop.launch(item),/EEXIST/);rmSync(join(root,'.operation-lock'),{recursive:true});
  await desktop.launch(item);assert.equal(existsSync(join(root,'.operation-lock')),false);
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('missing boot identity and numeric birth fields are ambiguous, not stale',()=>{
 assert.throws(()=>leaseRunning({...record,boot:undefined},'/owned',host()),/Invalid/);
 assert.throws(()=>leaseRunning({...record,start:900},'/owned',host()),/Invalid/);
});

test('cold backup preserves profile files and refuses links',()=>{
 // Native local filesystem only; no database engine or application is launched.
 const root=mkdtempSync(join(tmpdir(),'siaas-backup-'));
 return import('../scripts/lib/cli-profile.mjs').then(({coldBackup})=>{
  const {readFileSync,readdirSync,symlinkSync}=requireFS;
  try{mkdirSync(join(root,'profile'));writeFileSync(join(root,'profile','data'),'preserve');coldBackup(root);
   const backups=readdirSync(join(root,'backups'));assert.equal(readFileSync(join(root,'backups',backups[0],'data'),'utf8'),'preserve');assert.equal(readFileSync(join(root,'profile','data'),'utf8'),'preserve');
   symlinkSync('/outside',join(root,'profile','link'));assert.throws(()=>coldBackup(root));
  }finally{rmSync(root,{recursive:true,force:true})}
 });
});
