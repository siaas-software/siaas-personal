import { randomUUID } from "node:crypto";
import { ActionError } from "../actions";
import { LOCAL_USER_ID } from "../runtime";
import { resolveToolPermission } from "../tool-permission-gateway";
import type { LocalDatabase } from "./database";
import { ExecutionEventStore } from "./execution-events";

const nativeCapabilities = new Set(["documents.read", "datasets.query", "reports.create"]);

export type ToolTrace = {
  projectId: string;
  sessionId: string;
  traceId: string;
  parentTraceId?: string;
};

/** Called with an application-owned capability at the operation boundary. */
export function checkNativePermission(
  db: LocalDatabase,
  assistantId: string,
  capability: string,
  trace?: ToolTrace,
) {
  const assistant = db.get("assistants", assistantId);
  const projectId = trace?.projectId ?? assistant?.project_id;
  const project = projectId && db.get("projects", projectId);
  if (assistant?.tenant_id !== LOCAL_USER_ID || project?.tenant_id !== LOCAL_USER_ID ||
      assistant.project_id !== project.id)
    throw new ActionError(403, "Assistant or project unavailable.");
  const decision = resolveToolPermission({
    capability,
    projectPermissions: project.permissions,
    registered: nativeCapabilities.has(capability),
    assistantScopeAllowed: true,
  });
  new ExecutionEventStore(db).append({
    ...(trace ?? { projectId, sessionId: randomUUID(), traceId: randomUUID() }),
    assistantId, kind: "tool.permission_checked",
    details: {
      permission: decision.decision,
      reason_code: decision.reason,
      ...(nativeCapabilities.has(capability) ? { tool_key: capability } : {}),
    },
  });
  if (decision.decision !== "allow")
    throw new ActionError(403, decision.decision === "ask" ? "User approval required." : "Tool operation denied.");
}
