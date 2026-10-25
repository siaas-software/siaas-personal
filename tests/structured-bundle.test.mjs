import {buildStructuredParser} from '../scripts/build-structured-parser.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'siaas-notices-'));
try{await buildStructuredParser(dir);const inventory=JSON.parse(await readFile(join(dir,'structured-licenses/manifest.json')));assert(!inventory.some(p=>['buffers','chainsaw','binary','unzipper'].includes(p.name)));for(const name of ['exceljs','papaparse','yauzl'])assert(inventory.find(p=>p.name===name)?.notices.length,name);console.log('PASS parser excludes unused legacy streams and retains notices:',inventory.length,'components')}finally{await rm(dir,{recursive:true,force:true})}
