import { randomUUID } from "node:crypto";
import { ActionError } from "../actions";
import type { LocalDatabase } from "./database";
import type { ToolTrace } from "./native-permissions";

export type ApprovalOutcome =
  "approved" | "rejected" | "cancelled" | "expired" | "invalidated";
export type ApprovalView = {
  id: string;
  assistantId: string;
  projectId: string;
  traceId: string;
  operation: string;
  parameters: string;
  expiresAt: number;
};
type Pending = {
  view: ApprovalView;
  directory: string;
  valid: () => boolean;
  finish: (outcome: ApprovalOutcome) => void;
};

// Next route bundles share the local server process. A fresh process has no suspended calls.
const runtime = process as NodeJS.Process & {
  siaasPendingApprovals?: Map<string, Pending>;
};
const pending = (runtime.siaasPendingApprovals ??= new Map<string, Pending>());

export function pendingApprovals(db: LocalDatabase, projectId: string) {
  const result: ApprovalView[] = [];
  for (const item of pending.values()) {
    if (item.directory !== db.directory || item.view.projectId !== projectId)
      continue;
    if (Date.now() >= item.view.expiresAt) item.finish("expired");
    else if (!item.valid()) item.finish("invalidated");
    else result.push({ ...item.view });
  }
  return result;
}

export function decideApproval(
  db: LocalDatabase,
  projectId: string,
  id: string,
  outcome: "approved" | "rejected" | "cancelled",
) {
  const item = pending.get(id);
  if (
    !item ||
    item.directory !== db.directory ||
    item.view.projectId !== projectId
  )
    return false;
  if (Date.now() >= item.view.expiresAt) {
    item.finish("expired");
    return false;
  }
  if (!item.valid()) {
    item.finish("invalidated");
    return false;
  }
  item.finish(outcome);
  return true;
}

export function waitForApproval(
  db: LocalDatabase,
  scope: ToolTrace,
  assistantId: string,
  operation: string,
  parameters: string,
  signal: AbortSignal,
  valid: () => boolean,
): Promise<ApprovalOutcome> {
  signal.throwIfAborted();
  if (pending.size >= 64 || Buffer.byteLength(parameters) > 128_000)
    throw new ActionError(409, "Approval request exceeds local limits.");
  const id = randomUUID();
  const expiresAt = Date.now() + 60_000;
  return new Promise((resolve) => {
    const cancel = () => finish("cancelled");
    function finish(outcome: ApprovalOutcome) {
      // No await between lookup and deletion. Exactly one caller owns this transition.
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      resolve(outcome);
    }
    const timer = setTimeout(() => finish("expired"), expiresAt - Date.now());
    const view = {
      id,
      projectId: scope.projectId,
      assistantId,
      traceId: scope.traceId,
      operation,
      parameters,
      expiresAt,
    };
    pending.set(id, { view, directory: db.directory, valid, finish });
    signal.addEventListener("abort", cancel, { once: true });
  });
}
