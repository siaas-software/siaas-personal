// Browser + compiled local server + SQLite. The Electron bridge is a UI fixture.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { join,resolve } from 'node:path';
import assert from 'node:assert/strict';
import { runTest, requireBuild, freePort, waitForReady, cleanEnv, launchBrowser } from './helpers/runtime.mjs';

await runTest('guest-ui', async run => {
await requireBuild();
const dir=await run.tempDir();
const ollama=await run.server(createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:[]}));}));
const port=await freePort();
const origin=`http://127.0.0.1:${port}`,key='guest-test-key-'.repeat(4);
const server=run.child(process.execPath,[resolve('.next/standalone/server.js')],{env:cleanEnv({OLLAMA_BASE_URL:`http://127.0.0.1:${ollama.address().port}`,PORT:String(port),HOSTNAME:'127.0.0.1',NODE_ENV:'production',VERCEL:'0',SIAAS_RUNTIME:'desktop',SIAAS_DESKTOP_DEV:'0',SIAAS_DESKTOP_KEY:key,SIAAS_DESKTOP_ORIGIN:origin,SIAAS_DATA_DIR:dir})});
let browser;
  await waitForReady(origin,{child:server,headers:{'x-siaas-desktop-key':key}});
  browser=await launchBrowser(run, chromium);
  const page=await browser.newPage({extraHTTPHeaders:{'x-siaas-desktop-key':key},viewport:{width:1440,height:1000}}),errors=[];
  await run.context(page.context());
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
  await page.screenshot({path:join(run.out,'settings.png'),fullPage:true});
  await page.reload();await page.getByRole('heading',{name:'Your projects.'}).waitFor();assert.deepEqual(errors,[]);
  console.log('PASS: first guest load, actual SQLite write, account-free updates UI, preserved data, reload and local API protection.');
});
