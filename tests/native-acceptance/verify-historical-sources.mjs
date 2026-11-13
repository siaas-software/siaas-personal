// Read-only Git blob verification. Never imports/runs the inspected application.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const record = JSON.parse(readFileSync('docs/evidence/isolated-native-acceptance/historical-source-review.json'));
const git = (...args) => execFileSync('git', args, { timeout: 20000, maxBuffer: 32 * 1024 ** 2 });
assert.equal(git('remote','get-url','origin').toString().trim(), 'https://github.com/siaas-software/siaas-personal.git');
const expected = { stable:'1bce852cabbefb2459aeafc5aa42146eabd6283b',rc2:'84a1ffab4e5f339519bc80844d88ddcd573f561f',
  rc3:'17202c5964d9282efd4a1991c548612287c65dbb',candidate:'e7f8feb5185d4d64c23ace6a904b637c726b97ff' };
assert.deepEqual(Object.keys(record.revisions).sort(),Object.keys(expected).sort());
let files=0;
for (const [name, revision] of Object.entries(record.revisions)) {
  assert.equal(revision.sha,expected[name]); assert.equal(revision.historicalExecutionApproved,false);
  for (const [path, info] of Object.entries(revision.files)) {
    assert(/^(?:scripts\/[a-zA-Z0-9/.-]+|desktop\/main\.cjs|package(?:-lock)?\.json|runtime\.json)$/.test(path) && !path.includes('..'));
    const bytes=git('show',revision.sha+':'+path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),info.sha256,path); files++;
  }
  assert.equal(JSON.parse(git('show',revision.sha+':package.json')).version,revision.version);
  assert.equal(JSON.parse(git('show',revision.sha+':runtime.json')).nodeVersion,'24.22.0');
}
console.log(JSON.stringify({status:'PASS',scope:'read-only Git blobs, not application execution',revisions:4,files,nativeTestsExecuted:0}));
