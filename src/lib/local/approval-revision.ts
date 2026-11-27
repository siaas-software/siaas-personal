import type { DatabaseSync } from "node:sqlite";

type ScopedTable =
  | "projects"
  | "assistants"
  | "documents"
  | "knowledge_sources"
  | "structured_datasets"
  | "structured_relationships";

/** Trigger inputs are application-owned table names. Also observes writes from other connections. */
export function installApprovalRevisionTriggers(
  sql: DatabaseSync,
  table: ScopedTable,
) {
  for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
    const rows =
      event === "INSERT"
        ? ["NEW"]
        : event === "DELETE"
          ? ["OLD"]
          : ["OLD", "NEW"];
    const project = (row: string) => {
      if (table === "projects") return row + ".id";
      if (table === "assistants") return row + ".project_id";
      return (
        "(SELECT project_id FROM assistants WHERE id=" + row + ".assistant_id)"
      );
    };
    sql.exec(`CREATE TRIGGER IF NOT EXISTS approval_revision_${table}_${event}
      AFTER ${event} ON ${table} BEGIN
        INSERT INTO approval_revisions(project_id, revision)
        SELECT id, 1 FROM projects WHERE id IN (${rows.map(project).join(",")})
        ON CONFLICT(project_id) DO UPDATE SET revision=revision+1;
      END`);
  }
}
