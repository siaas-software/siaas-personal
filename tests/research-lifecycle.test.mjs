// Mocked CLI only: the fake Docker executable never accesses a Docker daemon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("reasoning setup preserves legacy token during data-directory migration and targets only its service", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "siaas-lifecycle-"));
  const home = join(root, "home"), data = join(root, "desktop-data"), bin = join(root, "bin"), calls = join(root, "calls.jsonl");
  mkdirSync(join(home, ".siaas"), { recursive: true }); mkdirSync(bin);
  const token = "migration-test-token-".repeat(4);
  writeFileSync(join(home, ".siaas/research-services.json"), JSON.stringify({ laya: "http://127.0.0.1:7821", morphic: "http://127.0.0.1:7822", token }));
  writeFileSync(join(bin, "docker"), `#!${process.execPath}\nconst {appendFileSync}=require('node:fs'); const args=process.argv.slice(2); appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]==='--version') console.log('Docker 27');
else if(args[0]==='compose' && args[1]==='version') console.log('2.30.0');
else if(args[0]==='info') console.log(JSON.stringify({ServerVersion:'27.0.0',OSType:'linux',Architecture:'x86_64'}));
else if(args[0]==='compose') { if(process.env.SIAAS_RESEARCH_TOKEN!==${JSON.stringify(token)}) process.exit(99); }
else process.exit(98);`, { mode: 0o755 });
  try {
    execFileSync(process.execPath, [resolve("scripts/research-services.mjs"), "setup", "reasoning"], { env: { ...process.env, HOME: home, SIAAS_DATA_DIR: data, SIAAS_RESEARCH_TOKEN: "", PATH: bin } });
    assert.equal(JSON.parse(readFileSync(join(data, "research-services.json"), "utf8")).token, token);
    const invocations = readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
    const start = invocations.find(args => args.includes("up"));
    assert.equal(start.at(-1), "laya"); assert(start.includes("--no-deps")); assert(!start.includes("searxng"));
    execFileSync(process.execPath, [resolve("scripts/research-services.mjs"), "stop", "reasoning"], { env: { ...process.env, HOME: home, SIAAS_DATA_DIR: data, SIAAS_RESEARCH_TOKEN: "", PATH: bin } });
    const stopped = readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse).find(args => args.includes("stop"));
    assert.equal(stopped.at(-1), "laya"); assert(!stopped.includes("down"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
