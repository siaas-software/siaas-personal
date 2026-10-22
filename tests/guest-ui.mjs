// Browser + compiled local server + SQLite. The Electron bridge is a UI fixture.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'siaas-guest-ui-'));
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,key='guest-test-key-'.repeat(4);
const server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,PORT:String(port),HOSTNAME:'127.0.0.1',NODE_ENV:'production',VERCEL:'0',SIAAS_RUNTIME:'desktop',SIAAS_DESKTOP_DEV:'0',SIAAS_DESKTOP_KEY:key,SIAAS_DESKTOP_ORIGIN:origin,SIAAS_DATA_DIR:dir},stdio:'ignore'});
let browser;
try {
  for(let i=0;i<80;i++){try{if((await fetch(origin,{headers:{'x-siaas-desktop-key':key}})).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({extraHTTPHeaders:{'x-siaas-desktop-key':key},viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.siaasDesktop={updateState:async()=>({version:'1.2.0',phase:'idle',supported:true,message:''}),checkUpdate:async()=>({version:'1.2.0',phase:'current',supported:true,message:'Up to date'}),onUpdateState:()=>()=>{}};
  });
  await page.goto(origin);await page.getByRole('heading',{name:'Your projects.'}).waitFor();
  assert.equal((await fetch(origin+'/api/workspace')).status,403);
  const created=await page.evaluate(async()=>{const r=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Guest persists',description:'',color:'#ffffff'})});return {status:r.status,body:await r.json()};});
  assert.equal(created.status,201);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('heading',{name:'Application updates'}).waitFor();
  await page.getByRole('button',{name:'Check for updates',exact:true}).click();
  assert.equal(await page.getByLabel('Password',{exact:true}).count(),0);
  const data=await page.evaluate(async()=>(await(await fetch('/api/workspace')).json()));assert(data.projects.some(p=>p.name==='Guest persists'));
  await mkdir('test-results/guest',{recursive:true});await page.screenshot({path:'test-results/guest/settings.png',fullPage:true});
  await page.reload();await page.getByRole('heading',{name:'Your projects.'}).waitFor();assert.deepEqual(errors,[]);
  console.log('PASS: first guest load, actual SQLite write, account-free updates UI, preserved data, reload and local API protection.');
} finally {if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true});}
