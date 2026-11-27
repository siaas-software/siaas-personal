import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { runNativeOperation } from "../src/lib/local/native-permissions";
import { decideApproval, pendingApprovals } from "../src/lib/local/operation-approval";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "operation-approval-"));
  const db = new LocalDatabase(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const project = db.put("projects", { tenant_id: LOCAL_USER_ID, name: "A",
    permissions: { rules: [{ capability: "reports.create", decision: "ask" }] } });
  const assistant = db.put("assistants", { tenant_id: LOCAL_USER_ID, project_id: project.id, name: "Writer" });
  const scope = { projectId: project.id, sessionId: randomUUID(), traceId: randomUUID() };
  const parameters = { title: "Never retain this private title" };
  const controller = new AbortController();
  let writes = 0;
  const result = runNativeOperation(db, assistant.id, scope, controller.signal,
    "create_report", parameters, () => ++writes);
  const [pending] = pendingApprovals(db, project.id);
  assert(pending);
  return { db, project, assistant, parameters, controller, result, pending, writes: () => writes };
}

test("approval expires before a non-idempotent operation and private arguments stay out of SQLite events", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const f = fixture(t);
  t.mock.timers.tick(60_001);
  await assert.rejects(f.result, /expired/);
  assert.equal(f.writes(), 0);
  assert.equal(decideApproval(f.db, f.project.id, f.pending.id, "approved"), false);
  const events = f.db.sql.prepare("SELECT * FROM execution_events ORDER BY sequence").all();
  assert.equal(events.at(-1)?.kind, "approval.expired");
  assert(!JSON.stringify(events).includes(f.parameters.title));
});

test("changed parameters invalidate the exact suspended operation", async t => {
  const f = fixture(t);
  f.parameters.title = "Changed";
  assert.equal(decideApproval(f.db, f.project.id, f.pending.id, "approved"), false);
  await assert.rejects(f.result, /invalidated/);
  assert.equal(f.writes(), 0);
});

test("membership revocation between approval and continuation prevents execution", async t => {
  const f = fixture(t);
  assert(decideApproval(f.db, f.project.id, f.pending.id, "approved"));
  const other = f.db.put("projects", { tenant_id: LOCAL_USER_ID, name: "B" });
  f.db.put("assistants", { ...f.assistant, project_id: other.id }, true);
  await assert.rejects(f.result, /invalidated/);
  assert.equal(f.writes(), 0);
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM execution_events WHERE project_id=?").get(other.id)?.n, 0);
});

test("fresh runtime opening the same profile cannot accept a prior runtime's pending request", async t => {
  const f = fixture(t);
  const child = spawnSync(process.execPath, ["--import", "tsx", "-e", `
    const { LocalDatabase } = require("./src/lib/local/database.ts");
    const { pendingApprovals, decideApproval } = require("./src/lib/local/operation-approval.ts");
    const [dir, project, id] = process.argv.slice(1);
    const db = new LocalDatabase(dir);
    try { if (pendingApprovals(db, project).length || decideApproval(db, project, id, "approved")) process.exitCode = 1; }
    finally { db.close(); }
  `, f.db.directory, f.project.id, f.pending.id], { timeout: 15_000 });
  assert.equal(child.status, 0, child.stderr.toString());
  f.controller.abort();
  await assert.rejects(f.result, /cancelled/);
  assert.equal(f.writes(), 0);
});
