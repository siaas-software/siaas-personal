import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../src/lib/local/database";
import { LOCAL_USER_ID } from "../src/lib/runtime";
import { BUILTIN_ACTIONS, actionInvocation, type ActionSkill } from "../src/lib/actions";
import { executeNativeAction } from "../src/lib/local/native-actions";
import { deleteAction, saveAction } from "../src/lib/local/actions";

test("native built-in Actions are immutable and never treated as executable Markdown", () => {
  const action = BUILTIN_ACTIONS.find((a) => a.id === "builtin:list-sources")!;
  assert(action);
  assert.equal(action.kind, "builtin");
  assert.equal(action.execution, "native");
  assert.equal(actionInvocation("Show my sources", action), "Show my sources");
  const directory = mkdtempSync(join(tmpdir(), "siaas-native-action-"));
  const db = new LocalDatabase(directory);
  try {
    assert.throws(() => deleteAction(db, action.id), /read-only/);
    assert.throws(() => saveAction(db, {
      id: action.id,
      name: action.name,
      markdown: action.markdown,
    }), /read-only/);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("native source Action reads only this assistant's enabled ready metadata", async () => {
  const directory = mkdtempSync(join(tmpdir(), "siaas-native-action-"));
  const db = new LocalDatabase(directory);
  try {
    const project = db.put("projects", { tenant_id: LOCAL_USER_ID, name: "P" });
    const first = db.put("assistants", { tenant_id: LOCAL_USER_ID, project_id: project.id, name: "A" });
    const second = db.put("assistants", { tenant_id: LOCAL_USER_ID, project_id: project.id, name: "B" });
    const add = (assistantId: string, title: string, status = "ready", enabled = true) =>
      db.put("documents", {
        tenant_id: LOCAL_USER_ID, assistant_id: assistantId,
        title, status, enabled, kind: "pdf",
      });
    add(first.id, "Authorized.pdf");
    add(first.id, "Disabled.pdf", "ready", false);
    add(first.id, "Incomplete.pdf", "queued");
    add(second.id, "Other-assistant.pdf");
    const action = BUILTIN_ACTIONS.find((a) => a.id === "builtin:list-sources")!;
    const actual = await executeNativeAction(db, first.id, action, new AbortController().signal);
    assert.match(actual.content, /Authorized\.pdf/);
    assert(!actual.content.includes("Disabled.pdf"));
    assert(!actual.content.includes("Incomplete.pdf"));
    assert(!actual.content.includes("Other-assistant.pdf"));
    assert.equal(actual.result, null);
    assert.deepEqual(actual.sources, []);
    await assert.rejects(() => executeNativeAction(db, first.id, {
      ...action, kind: "custom",
    } as ActionSkill, new AbortController().signal), /non autorizzata/);
    for (const decision of ["ask", "deny"]) {
      db.put("projects", { ...project, permissions: { rules: [{ capability: "documents.read", decision }] } }, true);
      await assert.rejects(() => executeNativeAction(db, first.id, action, new AbortController().signal),
        decision === "ask" ? /approval required/ : /denied/);
    }
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => executeNativeAction(db, first.id, action, controller.signal));
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
