import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import { ExecutionEventStore } from "../src/lib/local/execution-events";
import { LOCAL_USER_ID } from "../src/lib/runtime";

test("RC7 event store: project/assistant scopes, append order, persistence and cascade deletion", () => {
  const dir = mkdtempSync(join(tmpdir(), "siaas-event-store-"));
  const db = new LocalDatabase(dir);
  try {
    const projectA = db.put("projects", { tenant_id: LOCAL_USER_ID, name: "A" });
    const projectB = db.put("projects", { tenant_id: LOCAL_USER_ID, name: "B" });
    const a = db.put("assistants", { tenant_id: LOCAL_USER_ID, project_id: projectA.id, name: "A1" });
    const b = db.put("assistants", { tenant_id: LOCAL_USER_ID, project_id: projectA.id, name: "A2" });
    const other = db.put("assistants", { tenant_id: LOCAL_USER_ID, project_id: projectB.id, name: "B1" });
    const store = new ExecutionEventStore(db);
    const sessionId = randomUUID(), traceId = randomUUID();
    const first = store.append({projectId:projectA.id, assistantId:a.id, sessionId, traceId, kind:"session.started"});
    const second = store.append({projectId:projectA.id, assistantId:b.id, sessionId, traceId, kind:"assistant.delegated", details:{step_index:2}});
    assert.deepEqual([first.sequence, second.sequence], [1,2]);
    assert.equal(store.listProject(projectA.id).length,2);
    assert.equal(store.listAssistant(projectA.id,a.id).length,1);
    assert.equal(store.listAssistant(projectA.id,b.id).length,1);
    assert.equal(store.listProject(projectB.id).length,0);
    assert.equal(store.listSession(projectA.id,sessionId)[1].details.step_index,2);
    assert.throws(()=>store.append({projectId:projectB.id,assistantId:other.id,sessionId,traceId,kind:"session.started"}),/another project/);
    assert.throws(()=>store.append({projectId:projectA.id,assistantId:other.id,sessionId,traceId,kind:"session.started"}),/does not belong/);
    assert.throws(()=>store.append({projectId:projectA.id,assistantId:a.id,sessionId,traceId,kind:"model.completed",details:{private_prompt:"secret"} as never}),/unsupported private metadata/);
    for (const details of [{ status: "private document text" }, { tool_key: "/home/private" }, { input_tokens: "secret" }]) {
      assert.throws(() => store.append({ projectId: projectA.id, sessionId, traceId, kind: "router.decision", details }), /Invalid execution event/);
    }
    assert.throws(()=>db.sql.prepare("UPDATE execution_events SET kind = 'execution.completed' WHERE id = ?").run(first.id),/immutable/);
    db.sql.prepare("DELETE FROM projects WHERE id = ?").run(projectA.id);
    assert.equal(db.sql.prepare("SELECT COUNT(*) AS count FROM execution_events").get()?.count,0);
    const restarted = new ExecutionEventStore(db);
    assert.equal(restarted.listProject(projectB.id).length,0);
  } finally {
    db.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test("RC7 event store persists original events across database reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "siaas-event-restart-"));
  let db = new LocalDatabase(dir);
  try {
    const project = db.put("projects", {tenant_id:LOCAL_USER_ID,name:"Persist"});
    const sessionId = randomUUID(), traceId = randomUUID();
    new ExecutionEventStore(db).append({projectId:project.id,sessionId,traceId,kind:"session.started",details:{execution_path:"deterministic"}});
    db.close();
    db = new LocalDatabase(dir);
    assert.equal(new ExecutionEventStore(db).listSession(project.id,sessionId).length,1);
  } finally {
    try { db.close(); } catch { /* closed in test */ }
    rmSync(dir,{recursive:true,force:true});
  }
});

test("schema 4 migrates on open and child traces must stay within their parent session", () => {
  const dir = mkdtempSync(join(tmpdir(), "siaas-trace-migration-"));
  let db = new LocalDatabase(dir);
  try {
    const project = db.put("projects", { tenant_id: LOCAL_USER_ID, name: "Existing" });
    db.sql.exec("DROP TABLE execution_events; PRAGMA user_version=4");
    db.close();
    db = new LocalDatabase(dir);
    assert.equal(db.sql.prepare("PRAGMA user_version").get()?.user_version, 8);
    assert.equal(db.get("projects", project.id)?.name, "Existing");
    const store = new ExecutionEventStore(db);
    const root = {
      projectId: project.id, sessionId: randomUUID(), traceId: randomUUID(),
      kind: "session.started" as const,
    };
    store.append(root);
    const child = { ...root, traceId: randomUUID(), parentTraceId: root.traceId };
    store.append(child);
    assert.throws(() => store.append({ ...child, parentTraceId: undefined }), /parent cannot change/);
    assert.throws(() => store.append({ ...child, traceId: randomUUID(), sessionId: randomUUID() }), /Invalid parent/);
    assert.equal(store.listSession(project.id, root.sessionId).length, 2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
