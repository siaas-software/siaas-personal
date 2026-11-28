import { randomUUID } from "node:crypto";
import type { LocalDatabase } from "./database";
import { LOCAL_USER_ID } from "../runtime";

/**
 * RC7 foundation: one local append-only execution log, queried through project
 * and assistant scopes. No prompts, tool arguments, secrets or output are stored.
 * RC7 integration must call this from the shared assistant executor and project
 * run lifecycle. RC8 compaction/recall must be materialized views, not rewrites.
 */
export const EXECUTION_EVENT_KINDS = [
  "session.started",
  "router.decision",
  "tool.permission_checked",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.cancelled",
  "approval.expired",
  "approval.invalidated",
  "tool.failed",
  "tool.cancelled",
  "tool.started",
  "tool.completed",
  "assistant.delegated",
  "model.completed",
  "execution.completed",
  "execution.failed",
  "execution.cancelled",
] as const;

export type ExecutionEventKind = (typeof EXECUTION_EVENT_KINDS)[number];
export type ExecutionEventDetails = Partial<Record<
  | "execution_path" | "status" | "reason_code" | "permission"
  | "tool_key" | "duration_ms" | "input_tokens"
  | "output_tokens" | "step_index" | "source_count",
  string | number | boolean | null
>>;

export type ExecutionEventInput = {
  projectId: string;
  assistantId?: string | null;
  sessionId: string;
  traceId: string;
  parentTraceId?: string | null;
  kind: ExecutionEventKind;
  details?: ExecutionEventDetails;
};

export type ExecutionEventRecord = {
  id: string;
  project_id: string;
  assistant_id: string | null;
  session_id: string;
  trace_id: string;
  parent_trace_id: string | null;
  sequence: number;
  kind: ExecutionEventKind;
  created_at: string;
  details: ExecutionEventDetails;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const traceCodes = new Map<string, ReadonlySet<string>>([
  ["execution_path", new Set(["native-action", "deterministic", "mcp", "model", "model-structured",
    "arithmetic", "structured", "document", "website", "help", "clarify"])],
  ["reason_code", new Set(["hard-deny", "unregistered", "assistant-scope", "project-rule", "default", "unknown"])],
  ["permission", new Set(["allow", "ask", "deny"])],
  ["status", new Set(["running", "complete", "error", "cancelled"])],
  ["tool_key", new Set(["documents.read", "datasets.query", "reports.create", "mcp.write"])],
]);
const countFields = new Set(["duration_ms", "input_tokens", "output_tokens", "step_index", "source_count"]);

function requiredId(value: string, name: string) {
  if (!uuid.test(value)) throw new Error(`Invalid execution event ${name}.`);
}

function validatedDetails(input: ExecutionEventDetails | undefined) {
  const details = input ?? {};
  for (const [key, value] of Object.entries(details)) {
    const allowed = traceCodes.get(key);
    if (allowed) {
      if (typeof value !== "string" || !allowed.has(value))
        throw new Error("Invalid execution event metadata.");
    } else if (countFields.has(key)) {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        throw new Error("Invalid execution event count.");
    } else {
      throw new Error("Execution event contains unsupported private metadata.");
    }
  }
  if (Buffer.byteLength(JSON.stringify(details), "utf8") > 2048)
    throw new Error("Execution event metadata exceeds size limit.");
  return details;
}

export class ExecutionEventStore {
  constructor(private readonly db: LocalDatabase) {}

  private project(projectId: string) {
    requiredId(projectId, "projectId");
    const project = this.db.get("projects", projectId);
    if (!project || project.tenant_id !== LOCAL_USER_ID)
      throw new Error("Project not found.");
  }

  private assistant(projectId: string, assistantId: string) {
    requiredId(assistantId, "assistantId");
    const assistant = this.db.get("assistants", assistantId);
    if (!assistant || assistant.project_id !== projectId ||
        assistant.tenant_id !== LOCAL_USER_ID)
      throw new Error("Assistant does not belong to project.");
  }

  append(input: ExecutionEventInput): ExecutionEventRecord {
    this.project(input.projectId);
    if (input.assistantId) this.assistant(input.projectId, input.assistantId);
    requiredId(input.sessionId, "sessionId");
    requiredId(input.traceId, "traceId");
    if (input.parentTraceId) requiredId(input.parentTraceId, "parentTraceId");
    if (!EXECUTION_EVENT_KINDS.includes(input.kind))
      throw new Error("Unknown execution event kind.");
    const details = validatedDetails(input.details);
    return this.db.transaction(() => {
      const previous = this.db.sql.prepare(
        "SELECT project_id FROM execution_events WHERE session_id = ? LIMIT 1"
      ).get(input.sessionId) as { project_id: string } | undefined;
      if (previous && previous.project_id !== input.projectId)
        throw new Error("Execution session belongs to another project.");
      const trace = this.db.sql.prepare(
        "SELECT project_id, session_id, parent_trace_id FROM execution_events WHERE trace_id = ? LIMIT 1"
      ).get(input.traceId) as { project_id: string; session_id: string; parent_trace_id: string | null } | undefined;
      if (trace && (trace.project_id !== input.projectId || trace.session_id !== input.sessionId))
        throw new Error("Execution trace belongs to another session.");
      if (trace && trace.parent_trace_id !== (input.parentTraceId ?? null))
        throw new Error("Execution trace parent cannot change.");
      if (input.parentTraceId != null) {
        const parent = this.db.sql.prepare(
          "SELECT 1 FROM execution_events WHERE project_id = ? AND session_id = ? AND trace_id = ? LIMIT 1"
        ).get(input.projectId, input.sessionId, input.parentTraceId);
        if (!parent || input.parentTraceId === input.traceId)
          throw new Error("Invalid parent execution trace.");
      }
      const latest = this.db.sql.prepare(
        "SELECT COALESCE(MAX(sequence), 0) AS seq FROM execution_events WHERE session_id = ?"
      ).get(input.sessionId) as { seq: number };
      const record: ExecutionEventRecord = {
        id: randomUUID(),
        project_id: input.projectId,
        assistant_id: input.assistantId ?? null,
        session_id: input.sessionId,
        trace_id: input.traceId,
        parent_trace_id: input.parentTraceId ?? null,
        sequence: latest.seq + 1,
        kind: input.kind,
        created_at: new Date().toISOString(),
        details,
      };
      this.db.sql.prepare(`INSERT INTO execution_events
        (id, project_id, assistant_id, session_id, trace_id, parent_trace_id, sequence, kind, created_at, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          record.id, record.project_id, record.assistant_id,
          record.session_id, record.trace_id, record.parent_trace_id,
          record.sequence, record.kind, record.created_at, JSON.stringify(details)
        );
      return record;
    });
  }

  private read(sql: string, values: (string | number)[]): ExecutionEventRecord[] {
    const rows = this.db.sql.prepare(sql).all(...values) as unknown as (
      Omit<ExecutionEventRecord, "details"> & { details: string }
    )[];
    return rows.map((row) => ({ ...row, details: JSON.parse(row.details) }));
  }

  page(projectId: string, assistantId: string | null, before: string | null, limit: number) {
    this.project(projectId);
    if (assistantId !== null) this.assistant(projectId, assistantId);
    const scope = assistantId === null ? "project_id = ?" : "project_id = ? AND assistant_id = ?";
    const values = assistantId === null ? [projectId] : [projectId, assistantId];
    const cursor = before === null ? "" :
      ` AND rowid < (SELECT rowid FROM execution_events WHERE id = ? AND ${scope})`;
    const size = Math.min(200, Math.max(1, Math.trunc(limit) || 50));
    const rows = this.read(
      `SELECT * FROM execution_events WHERE ${scope}${cursor} ORDER BY rowid DESC LIMIT ?`,
      [...values, ...(before === null ? [] : [before, ...values]), size + 1],
    );
    const events = rows.slice(0, size);
    return { events, next: rows.length > size ? events[size - 1].id : null };
  }

  /** Project-wide audit view: one copy of each event from every project member. */
  listProject(projectId: string, limit = 100): ExecutionEventRecord[] {
    this.project(projectId);
    const size = Math.min(200, Math.max(1, Math.trunc(limit) || 100));
    return this.read(
      "SELECT * FROM execution_events WHERE project_id = ? ORDER BY rowid DESC LIMIT ?",
      [projectId, size]
    );
  }

  /** Assistant-only view; project-level events are not leaked into this view. */
  listAssistant(projectId: string, assistantId: string, limit = 100) {
    this.project(projectId);
    this.assistant(projectId, assistantId);
    const size = Math.min(200, Math.max(1, Math.trunc(limit) || 100));
    return this.read(
      "SELECT * FROM execution_events WHERE project_id = ? AND assistant_id = ? ORDER BY rowid DESC LIMIT ?",
      [projectId, assistantId, size]
    );
  }

  /** Session view for project-owner audit; same session can contain multiple assistants. */
  listSession(projectId: string, sessionId: string, limit = 200) {
    this.project(projectId);
    requiredId(sessionId, "sessionId");
    const size = Math.min(1000, Math.max(1, Math.trunc(limit) || 200));
    return this.read(
      "SELECT * FROM execution_events WHERE project_id = ? AND session_id = ? ORDER BY sequence ASC LIMIT ?",
      [projectId, sessionId, size]
    );
  }
}
