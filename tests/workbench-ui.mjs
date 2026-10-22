// Real browser -> compiled desktop API -> temporary SQLite; deterministic Ollama.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'siaas-workbench-'));
const ollama=createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
 res.setHeader('Content-Type','application/json');
 if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'qwen2.5:1.5b',digest:'b'.repeat(64)},{name:'embeddinggemma:latest',digest:'a'.repeat(64)}]}));
 if(req.url==='/api/show')return res.end(JSON.stringify({capabilities:['completion'],details:{parameter_size:'1.5B'}}));
 if(req.url==='/api/embed')return res.end(JSON.stringify({embeddings:body.input.map(()=>Array.from({length:768},(_,i)=>i===0?1:0))}));
 if(req.url==='/api/chat'){
  const prompt=body.messages.at(-1).content;
  const content=prompt.includes('data table')?'| Model | Interval |\n| --- | --- |\n| Test machine | 500 hours [1] |':'Maintenance is required every 500 hours [1].';
  return res.end(JSON.stringify({message:{content},done:true,prompt_eval_count:30,eval_count:15})+'\n');
 }
 res.statusCode=404;res.end('{}');
});
await new Promise(r=>ollama.listen(0,'127.0.0.1',r));
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,key='workbench-test-key-'.repeat(4);
const headers={'x-siaas-desktop-key':key,origin,'Content-Type':'application/json'};
let logs='';
const server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,PORT:String(port),HOSTNAME:'127.0.0.1',NODE_ENV:'production',VERCEL:'0',SIAAS_RUNTIME:'desktop',SIAAS_DESKTOP_DEV:'0',SIAAS_DESKTOP_KEY:key,SIAAS_DESKTOP_ORIGIN:origin,SIAAS_DATA_DIR:dir,OLLAMA_BASE_URL:`http://127.0.0.1:${ollama.address().port}`},stdio:['ignore','pipe','pipe']});
server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
let browser;
async function api(path,method='GET',body){const r=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert(r.ok,`${path}: ${r.status} ${JSON.stringify(data)} ${logs}`);return data;}
try{
 for(let i=0;i<100;i++){try{if((await fetch(origin,{headers})).ok)break;}catch{}await new Promise(r=>setTimeout(r,150));}
 const p=await api('/api/projects','POST',{name:'Workshop',description:'',color:'#ffffff'});
 const a=await api('/api/assistants','POST',{project_id:p.id,name:'Maintenance assistant',description:'Technical knowledge',instructions:'Use sources.',model_id:'ollama/qwen2.5:1.5b'});
 const doc=await api('/api/documents','POST',{assistant_id:a.id,title:'Machine manual',kind:'text',text:'The test machine requires scheduled maintenance every 500 hours.'});
 await api(`/api/documents/${doc.id}/process`,'POST');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({extraHTTPHeaders:{'x-siaas-desktop-key':key},viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/?assistant=${a.id}`);
 await page.getByRole('heading',{name:/File management/}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'Knowledge'}).count(),0);
 const workspace=await api('/api/workspace');
 assert.equal(await page.locator('.app-version').innerText(), `Version ${workspace.version}`);
 assert.equal(await page.getByRole('tab',{name:'Export',exact:true}).count(),0);
 assert.equal((await fetch(`${origin}/api/assistants/${a.id}/export`,{headers})).status,404);
 assert.equal(await page.locator('.upload-zone').count(),0);
 const website=await page.getByRole('heading',{name:'Website configuration'}).boundingBox();
 const files=await page.getByRole('heading',{name:/File management/}).boundingBox();
 assert(website.y<files.y,'Website configuration must precede file management');
 const knowledge=await page.locator('.knowledge-panel').boundingBox(),chat=await page.locator('.workbench-chat').boundingBox();
 assert(knowledge.x+knowledge.width<=chat.x,'Knowledge must be left of chat');
 await page.getByText('The assistant can make mistakes. Please verify its responses.').waitFor();
 assert.equal(await page.locator('.shortcut-action').count(),5);
 await page.getByLabel('Source URI').fill('https://127.0.0.1/private');
 await page.getByRole('button',{name:'Add URI',exact:true}).click();
 await page.getByRole('alert').filter({hasText:/Unable to read|public/}).waitFor();
 // Markdown Actions send the typed draft once; Data Cell still preserves it.
 await page.getByPlaceholder('Type a message…').fill('Unsent draft');
 await page.getByRole('button',{name:'Report',exact:true}).click();
 await page.locator('.message.assistant').filter({hasText:'Maintenance is required every 500 hours'}).waitFor();
 await page.getByRole('button',{name:'Data table',exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('.shortcut-table').disabled);
 assert.equal(await page.getByPlaceholder('Type a message…').inputValue(),'');
 await page.getByPlaceholder('Type a message…').fill('Separate table draft');
 await page.getByRole('button',{name:'Data table',exact:true}).click();
 await page.getByRole('heading',{name:'Create a data table'}).waitFor();
 await page.getByLabel('What would you like in the table?').fill('Columns: model and maintenance interval');
 await page.getByRole('button',{name:'Create table',exact:true}).click();
 await page.locator('.chat-table th').filter({hasText:'Interval'}).waitFor();
 assert.equal(await page.getByPlaceholder('Type a message…').inputValue(),'Separate table draft');
 await page.waitForFunction(()=>!document.querySelector('.shortcut-table').disabled);
 const convs=await api(`/api/conversations?assistant=${a.id}`);assert.equal(convs.length,1);
 const saved=await api(`/api/conversations/${convs[0].id}`);assert.equal(saved.messages.filter(m=>m.role==='user').length,2);
 assert(saved.messages.some(m=>m.content.includes('Columns: model and maintenance interval')));
 await page.reload();await page.locator('.chat-table').waitFor();
 await mkdir('test-results/workbench',{recursive:true});await page.screenshot({path:'test-results/workbench/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/workbench/mobile.png',fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page must not overflow');
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(`${origin}/?assistant=${a.id}&lang=it`);
 await page.getByRole('heading',{name:'Scorciatoie',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Configurazione siti web',exact:true}).waitFor();
 await page.getByRole('button',{name:'Importa file',exact:true}).waitFor();
 await page.getByRole('tab',{name:'Configurazione',exact:true}).click();
 await page.getByRole('heading',{name:'Configura assistente',exact:true}).waitFor();
 await page.getByRole('tab',{name:'Modelli',exact:true}).click();
 assert.equal(await page.getByRole('tab',{name:'Modelli'}).getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('.app-version').innerText(), `Versione ${workspace.version}`);
 await page.screenshot({path:'test-results/workbench/italian-models.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: columns, English UI, five Shortcuts, URI error feedback, direct report consuming draft, preserved Data Cell draft, table modal/rendering, SQLite persistence, reload, responsive layout.');
}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));await new Promise(r=>ollama.close(r));await rm(dir,{recursive:true,force:true});}
