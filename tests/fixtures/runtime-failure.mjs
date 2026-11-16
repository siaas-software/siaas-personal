// Fault injection for lifecycle tests; no application/UI coverage.
import { runTest, delay } from '../helpers/runtime.mjs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const mode = process.argv[2];
await runTest('lifecycle-fault', async run => {
  const directory = await run.tempDir();
  const db = new DatabaseSync(join(directory, 'siaas.sqlite'));
  db.exec('CREATE TABLE isolation_evidence(value TEXT);');
  db.close();
  const child = run.child(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(JSON.stringify({ grandchild: grandchild.pid }));
    setInterval(() => {}, 1000);
  `]);
  const grandchild = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', data => resolve(JSON.parse(String(data)).grandchild));
  });
  console.log('FIXTURE:' + JSON.stringify({ directory, pid: child.pid, grandchild, out: run.out }));
  if (mode === 'throw') throw new Error('Injected setup failure after acquiring resources');
  if (mode === 'timeout') await delay(60000);
  if (mode === 'signal') {
    if (process.platform === 'win32') process.emit('SIGINT');
    else process.kill(process.pid, 'SIGTERM');
  }
  await delay(100);
}, { timeout: mode === 'timeout' ? 1500 : 20000, mode: 'infrastructure-fault-injection' });
