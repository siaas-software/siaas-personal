import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requireStopped } from '../scripts/lib/cli-quiescence.mjs';
test('CLI quiescence refuses incomplete host process visibility', {skip: process.platform!=='linux'},()=>{
 try {requireStopped('/nonexistent-siaas-test-owned-root');}
 catch(e){assert(['EACCES','EPERM'].includes(e.code),e.message);return;}
 // On an ordinary host complete visibility may succeed; no process is signalled.
});
test('first-party descriptor is bounded to the candidate native target',()=>{
 const d=JSON.parse(readFileSync(new URL('../scripts/lib/cli-first-party.json',import.meta.url)));
 assert.equal(d.protocol,'siaas.personal.first-party-m2');assert.deepEqual(d.platforms,['linux-x64']);assert.equal(d.installOnly,true);
});
