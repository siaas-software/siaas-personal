// Opt-in. Requires a running local Ollama and an already downloaded >=8B tool model.
// This tests real connectivity/inference/tools, not end-to-end analytical chat.
import assert from 'node:assert/strict';
import { agentEligibility } from '../src/lib/agent-policy.ts';
const base=process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434';
const model=process.env.SIAAS_REAL_MODEL||'qwen3:8b';
const url=new URL(base);assert.equal(url.protocol,'http:');assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',body:body&&JSON.stringify(body),signal:AbortSignal.timeout(180000)});const j=await r.json();assert(r.ok,JSON.stringify(j));return j;}
console.log('Ollama',await api('/api/version'));
const tags=await api('/api/tags');assert(tags.models.some(m=>m.name===model));
const info=await api('/api/show',{model});assert(agentEligibility(info).enabled,'Requires verified local >=8B model with tools');
console.log('PASS discovery and eligibility',model,info.model_info['general.parameter_count']);
const missing=await fetch(base+'/api/show',{method:'POST',body:JSON.stringify({model:'siaas-unavailable-test:missing'}),signal:AbortSignal.timeout(10000)});assert.equal(missing.status,404);
const common={model,stream:false,think:false,options:{temperature:0,num_ctx:2048,num_predict:128}};
const answer=await api('/api/chat',{...common,messages:[{role:'user',content:'Reply with exactly READY.'}]});assert.match(answer.message.content,/READY/);
const tool=await api('/api/chat',{...common,messages:[{role:'user',content:'Call inspect_dataset for dataset orders. Do not answer without the tool.'}],tools:[{type:'function',function:{name:'inspect_dataset',description:'Inspect an authorized dataset schema',parameters:{type:'object',properties:{dataset:{type:'string',enum:['orders']}},required:['dataset']}}}]});
assert.equal(tool.message.tool_calls?.[0]?.function.name,'inspect_dataset');assert.equal(tool.message.tool_calls[0].function.arguments.dataset,'orders');
console.log('PASS real inference, unavailable model and native tool-call generation; analytical chat must be validated separately');
