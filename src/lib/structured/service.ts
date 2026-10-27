import type { LocalDatabase } from "../local/database";
import { datasets, relations } from "./store";
import { executePlan, type AnalysisResult } from "./engine";
import { readLinkedDocument } from "../local/knowledge";
import { AnalysisError } from "./types";
export function queryStructured(
  db: LocalDatabase,
  assistantId: string,
  plan: unknown,
) {
  const all = datasets(db, assistantId);
  // Recheck linked sources at execution, so an edited/offline file never yields stale totals.
  for (const d of all) {
    const doc = db.get("documents", d.documentId);
    if (doc?.source_id)
      try {
        readLinkedDocument(db, doc);
      } catch {
        throw new AnalysisError(
          "A linked spreadsheet changed or is unavailable. Refresh its folder first.",
        );
      }
  }
  return executePlan(plan, all, relations(db, assistantId));
}
const escape = (value: unknown) =>
  String(value ?? "∅")
    .replace(/[|\r\n]/g, " ")
    .replace(/[<>]/g, "");
export function analysisMarkdown(result: AnalysisResult) {
  const cols = result.columns.map((c) => c.id);
  const table = [
    `| ${result.columns.map((c) => escape(c.name)).join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...result.rows.map(
      (row) => `| ${cols.map((c) => escape(row[c])).join(" | ")} |`,
    ),
  ].join("\n");
  const measures = result.columns.filter(
    (c) => c.type === "number" && !c.partition,
  );
  const units = result.columns.filter((c) => c.partition);
  const summary =
    result.rows.length === 1 &&
    !result.truncated &&
    measures.length === 1 &&
    units.length === 1
      ? `${escape(result.rows[0][measures[0].id])} ${escape(result.rows[0][units[0].id])}`
      : "";
  return [
    summary,
    `### Structured Data Analysis`,
    table,
    `${result.totalRows} result rows${result.truncated ? `; showing ${result.rows.length}` : ""}. ∅ means missing, not zero.`,
    result.warnings.map((w) => `- ${w}`).join("\n"),
    `Calculation method: ${result.method}`,
    "Sources and applied operations:",
    "```json",
    JSON.stringify(result.evidence, null, 2),
    "```",
    "",
  ].join("\n\n");
}
