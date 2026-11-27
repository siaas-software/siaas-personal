import { randomUUID } from "node:crypto";
import { ActionError } from "../actions";
import { LOCAL_USER_ID } from "../runtime";
import { resolveToolPermission } from "../tool-permission-gateway";
import type { LocalDatabase } from "./database";
import {
  ExecutionEventStore,
  type ExecutionEventKind,
} from "./execution-events";
import { waitForApproval } from "./operation-approval";

const operations = {
  list_sources: "documents.read",
  search_documents: "documents.read",
  read_document: "documents.read",
  retrieve_sources: "documents.read",
  inspect_datasets: "datasets.query",
  plan_dataset_query: "datasets.query",
  query_datasets: "datasets.query",
  calculate_dataset: "datasets.query",
  create_report: "reports.create",
} as const;
export type NativeOperation = keyof typeof operations;
export type ToolTrace = {
  projectId: string;
  sessionId: string;
  traceId: string;
  parentTraceId?: string;
};

export async function runNativeOperation<T>(
  db: LocalDatabase,
  assistantId: string,
  trace: ToolTrace | undefined,
  signal: AbortSignal,
  operation: NativeOperation,
  parameters: object,
  execute: (revalidate: () => void) => T | Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const scope = {
    ...(trace ?? {
      projectId: db.get("assistants", assistantId)?.project_id,
      traceId: randomUUID(),
      sessionId: randomUUID(),
    }),
    assistantId,
  };
  const capability = operations[operation];
  function policy() {
    const project = db.get("projects", scope.projectId);
    const assistant = db.get("assistants", assistantId);
    const member =
      project?.tenant_id === LOCAL_USER_ID &&
      assistant?.tenant_id === LOCAL_USER_ID &&
      assistant.project_id === scope.projectId;
    if (!member)
      throw new ActionError(403, "Assistant or project unavailable.");
    return resolveToolPermission({
      capability,
      registered: Object.hasOwn(operations, operation),
      assistantScopeAllowed: member,
      projectPermissions: project.permissions,
    });
  }
  const decision = policy();
  const store = new ExecutionEventStore(db);
  const audit = (kind: ExecutionEventKind) =>
    store.append({
      ...scope,
      kind,
      assistantId:
        db.get("assistants", assistantId)?.project_id === scope.projectId
          ? assistantId
          : null,
      details: { tool_key: capability },
    });
  store.append({
    ...scope,
    kind: "tool.permission_checked",
    details: {
      permission: decision.decision,
      reason_code: decision.reason,
      tool_key: capability,
    },
  });
  if (decision.decision === "deny")
    throw new ActionError(403, "Tool operation denied.");
  const revision = () =>
    db.sql
      .prepare("SELECT revision FROM approval_revisions WHERE project_id=?")
      .get(scope.projectId)?.revision ?? 0;
  const originalRevision = revision();
  const snapshot = JSON.stringify(parameters);
  function revalidate() {
    signal.throwIfAborted();
    if (
      policy().decision !== decision.decision ||
      originalRevision !== revision() ||
      JSON.stringify(parameters) !== snapshot
    )
      throw new ActionError(403, "Operation authorization changed.");
  }
  if (decision.decision === "ask") {
    if (!trace) throw new ActionError(403, "User approval required.");
    audit("approval.requested");
    const deadline = Date.now() + 60_000;
    let outcome = await waitForApproval(
      db,
      scope,
      assistantId,
      operation,
      snapshot,
      signal,
      () => {
        try {
          revalidate();
          return true;
        } catch {
          return false;
        }
      },
    );
    if (outcome === "approved") {
      if (Date.now() >= deadline) outcome = "expired";
      else
        try {
          revalidate();
        } catch {
          outcome = signal.aborted ? "cancelled" : "invalidated";
        }
    }
    // If the assistant moved while waiting, log the outcome only in the original project view.
    const stillMember =
      db.get("assistants", assistantId)?.project_id === scope.projectId;
    store.append({
      ...scope,
      assistantId: stillMember ? assistantId : null,
      kind: `approval.${outcome}`,
      details: { tool_key: capability },
    });
    if (outcome !== "approved")
      throw new ActionError(403, "Approval " + outcome + ".");
  }
  revalidate();
  audit("tool.started");
  let result: T;
  try {
    result = await execute(revalidate);
  } catch (error) {
    audit(signal.aborted ? "tool.cancelled" : "tool.failed");
    throw error;
  }
  audit("tool.completed");
  return result;
}
