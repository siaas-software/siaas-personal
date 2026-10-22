// Native release gate: run on each packaged OS in the existing release workflow.
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const executable = process.env.SIAAS_PACKAGED_EXECUTABLE;
if (!executable) throw new Error("Set SIAAS_PACKAGED_EXECUTABLE to the unpacked app executable.");
const profile = await mkdtemp(join(tmpdir(), "siaas-package-"));
const fixture = createServer((req,res)=>{
  res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify(req.url === "/api/version" ? {version:"0.35.1"} : {models:[]}));
});
await new Promise(r=>fixture.listen(0,"127.0.0.1",r));
const env={...process.env,PATH:"",XDG_CONFIG_HOME:profile,APPDATA:profile,OLLAMA_BASE_URL:`http://127.0.0.1:${fixture.address().port}`};
for(const key of ["SIAAS_NODE_EXECUTABLE","SIAAS_RUNTIME","SIAAS_DATA_DIR","ELECTRON_RUN_AS_NODE","OLLAMA_HOST"]) delete env[key];
let app;
try {
  app=await electron.launch({executablePath:resolve(executable),args:[`--user-data-dir=${profile}`,...(process.getuid?.()===0?["--no-sandbox"]:[])],env,timeout:60000});
  const page=await app.firstWindow({timeout:60000}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.getByRole("heading",{name:"Your projects."}).waitFor();
  assert.equal(await app.evaluate(({app})=>app.isPackaged),true);
  assert.equal((await fetch(new URL("/api/workspace",page.url()))).status,403);
  assert.equal(await page.evaluate(async()=>(await fetch('/api/workspace')).status),200);
  const setup=await page.evaluate(()=>window.siaasDesktop.setupOllama());
  assert.equal(setup.ok,true,"Guest reuses compatible Ollama without downloading");
  const project=await page.evaluate(async()=>{
    const r=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Guest package verification',description:'Temporary test',color:'#ffffff'})});
    if(!r.ok) throw new Error(await r.text()); return r.json();
  });
  assert(project.id);
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await page.getByRole("heading",{name:"Application updates"}).waitFor();
  assert.equal(await page.getByLabel("Password",{exact:true}).count(),0);
  const workspace=await page.evaluate(async()=>(await(await fetch('/api/workspace')).json()));
  assert(workspace.projects.some(p=>p.id===project.id),'Opening settings preserves local data and API access');
  const update=await page.evaluate(()=>window.siaasDesktop.checkUpdate());
  assert(['unsupported','current','available','failed'].includes(update.phase));
  await page.reload();
  await page.getByRole('heading',{name:'Your projects.'}).waitFor();
  await mkdir('test-results/package',{recursive:true});
  await page.screenshot({path:'test-results/package/packaged-app.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: packaged guest startup, Ollama reuse, local write, account-free settings and preserved workspace; no system Node/npm/Git.');
} finally {
  if(app) await app.close();
  fixture.closeAllConnections(); await new Promise(r=>fixture.close(r));
  await rm(profile,{recursive:true,force:true});
}
