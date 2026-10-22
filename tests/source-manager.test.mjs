import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runtimeAsset } from '../scripts/lib/distribution.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('managed source installation stages updates, retains matching rollback, and preserves state after failed builds', {skip:process.platform!=='linux'}, () => {
 const base=mkdtempSync(join(tmpdir(),'siaas-manager-')),root=join(base,'Application space'),runtimeFolder=join(root,'runtimes',`node-v${process.versions.node}-linux-${process.arch}`);
 try {
  mkdirSync(join(runtimeFolder,'bin'),{recursive:true});
  const node=join(runtimeFolder,'bin/node'),npm=join(runtimeFolder,'npm-fixture.mjs');copyFileSync(process.execPath,node);
  writeFileSync(npm,`import {readFileSync} from 'node:fs'; const pkg=JSON.parse(readFileSync('package.json')); if(pkg.failBuild) process.exit(17); if(process.env.SIAAS_SOURCE_NODE!==process.execPath)throw Error('Wrong runtime'); if(process.env.NPM_CONFIG_PREFIX)throw Error('Global npm prefix leaked');`);
  writeFileSync(join(runtimeFolder,'runtime.json'),JSON.stringify({folder:runtimeFolder,node,npm,version:process.versions.node,binarySha256:hash(readFileSync(node))}));
  const env={...process.env,HOME:base,SIAAS_INSTALL_DIR:root,NPM_CONFIG_PREFIX:'/do-not-touch',NVM_DIR:join(base,'nvm')};
  delete env.NODE_OPTIONS;delete env.NODE_PATH;
  const run=(script,args)=>spawnSync(node,[script,...args],{env,encoding:'utf8',timeout:20000});
  const manager=resolve('scripts/source-manager.mjs');
  function install(version,failBuild=false){
   const source=join(base,'source-'+version),prepared=join(base,'prepared-'+version);mkdirSync(source);mkdirSync(prepared);
   cpSync(resolve('scripts'),join(source,'scripts'),{recursive:true});
   mkdirSync(join(source,'node_modules/electron-builder'),{recursive:true});
   writeFileSync(join(source,'node_modules/electron-builder/cli.js'),`const fs=require('node:fs');fs.mkdirSync('dist/unpacked',{recursive:true});fs.writeFileSync('dist/unpacked/siaas','#!/bin/sh\\nexit 0\\n',{mode:0o755});`);
   writeFileSync(join(source,'package.json'),JSON.stringify({version,failBuild}));writeFileSync(join(source,'runtime.json'),JSON.stringify({nodeVersion:process.versions.node}));
   const archive=join(prepared,'source.zip');assert.equal(spawnSync('zip',['-qr',archive,'.'],{cwd:source}).status,0);
   const bytes=readFileSync(archive),name=`SIAAS-Personal-${version}-source.zip`;
   const m={schemaVersion:1,version,platform:process.platform,arch:process.arch,name,size:bytes.length,sha256:hash(bytes),downloadUrl:`https://github.com/siaas-software/siaas-personal/releases/download/v${version}/${name}`,runtime:{version:process.versions.node,...runtimeAsset(process.versions.node,process.platform,process.arch),sha256:'a'.repeat(64)}};
   writeFileSync(join(prepared,'manifest.json'),JSON.stringify(m));
   return run(manager,['install','--prepared',prepared,'--manifest',join(prepared,'manifest.json')]);
  }
  let result=install('1.2.0');assert.equal(result.status,0,result.stdout+result.stderr);
  const current=()=>JSON.parse(readFileSync(join(root,'current.json'),'utf8'));
  const first=current();assert.equal(first.runtime.node,node);assert(existsSync(join(base,'.local/share/applications/siaas-personal.desktop')));
  writeFileSync(join(root,'personal.txt'),'preserve');
  result=install('1.0.0');assert.notEqual(result.status,0);assert.match(result.stderr,/automatic downgrade is refused/);assert.deepEqual(current(),first);assert.equal(readFileSync(join(root,'personal.txt'),'utf8'),'preserve');
  result=install('1.3.0');assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(current().previous.folder,first.folder);
  result=run(join(root,'source-manager.mjs'),['rollback']);assert.equal(result.status,0,result.stderr);assert.equal(current().version,'1.2.0');
  result=run(join(root,'source-manager.mjs'),['rollback']);assert.equal(result.status,0,result.stderr);assert.equal(current().version,'1.3.0');
  const before=current();result=install('1.4.0',true);assert.notEqual(result.status,0);assert.deepEqual(current(),before);
  result=install('1.5.0');assert.equal(result.status,0,result.stdout+result.stderr);assert(!existsSync(join(root,'versions',first.folder)));assert.equal(current().previous.version,'1.3.0');
  assert.equal(readFileSync(join(root,'personal.txt'),'utf8'),'preserve');assert(!existsSync(join(base,'nvm')));assert(!existsSync(join(root,'.operation-lock')));
 } finally {rmSync(base,{recursive:true,force:true});}
});
