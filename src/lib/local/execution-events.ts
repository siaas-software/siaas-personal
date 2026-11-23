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
  | "tool_key" | "model_name" | "duration_ms" | "input_tokens"
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
const allowedDetailKeys = new Set([
  "execution_path", "status", "reason_code", "permission", "tool_key",
  "model_name", "duration_ms", "input_tokens", "output_tokens",
  "step_index", "source_count",
]);

function requiredId(value: string, name: string) {
  if (!uuid.test(value)) throw new Error(`Invalid execution event ${name}.`);
}

function validatedDetails(input: ExecutionEventDetails | undefined) {
  const details = input ?? {};
  for (const [key, value] of Object.entries(details)) {
    if (!allowedDetailKeys.has(key))
      throw new Error("Execution event contains unsupported private metadata.");
    if (
      value !== null &&
      !(typeof value === "boolean" ||
        (typeof value === "string" && value.length <= 160) ||
        (typeof value === "number" && Number.isFinite(value) && value >= 0))
    )
      throw new Error("Invalid execution event metadata.");
  }
  if (Buffer.byteLength(JSON.stringify(details), "utf8") > 2048)
    throw new Error("Execution event metadata exceeds size limit.");
  return details;
}

/** Creates an additive table; migration/versioning and runtime wiring remain RC7 work. */
export class ExecutionEventStore {
  constructor(private readonly db: LocalDatabase) {
    this.db.sql.exec(`
      CREATE TABLE IF NOT EXISTS execution_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        assistant_id TEXT REFERENCES assistants(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        parent_trace_id TEXT,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        details TEXT NOT NULL CHECK(json_valid(details)),
        UNIQUE(session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS execution_events_project
        ON execution_events(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS execution_events_assistant
        ON execution_events(project_id, assistant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS execution_events_session
        ON execution_events(project_id, session_id, sequence);
      CREATE INDEX IF NOT EXISTS execution_events_trace
        ON execution_events(project_id, trace_id);
      CREATE TRIGGER IF NOT EXISTS execution_events_prevent_update
        BEFORE UPDATE ON execution_events
        BEGIN SELECT RAISE(ABORT, 'execution_events are immutable'); END;
    `);
  }

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
        "SELECT project_id, session_id FROM execution_events WHERE trace_id = ? LIMIT 1"
      ).get(input.traceId) as { project_id: string; session_id: string } | undefined;
      if (trace && (trace.project_id !== input.projectId || trace.session_id !== input.sessionId))
        throw new Error("Execution trace belongs to another session.");
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
