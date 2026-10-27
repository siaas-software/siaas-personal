import { initialMapping, profile, isDate } from "./profile";
import type { Mapping, Sheet } from "./types";

export const isPartitionName = (name: string) =>
  /currency|valuta|unit.*measure|unità|^uom$|^unit$/i.test(name);
export type ImportQuestion = {
  kind: "header" | "date" | "mixed" | "formula" | "empty";
  column?: string;
  label: string;
};
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const dateLike = /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/;

export function importQuestions(
  sheet: Sheet,
  mapping: Mapping,
): ImportQuestion[] {
  const p = profile({ sheet, mapping });
  const questions: ImportQuestion[] = [];
  const row = sheet.rows[mapping.headerRow - 1] ?? [];
  const labels = row.map((c) => String(c.value ?? "").trim());
  const fullHeader =
    mapping.headerRow > 0 &&
    labels.length === p.columnCount &&
    labels.every(Boolean) &&
    new Set(labels).size === labels.length;
  const contrast = p.columns.some(
    (c) =>
      c.type !== "text" ||
      /^(date|month|name|category|product|currency|description|code|id|data|mese|nome|categoria|prodotto|valuta|codice)$/i.test(
        c.name,
      ),
  );
  if (!mapping.headerReviewed && (!fullHeader || !contrast))
    questions.push({
      kind: "header",
      label:
        "Which row contains the column names? Check the preview and select that row, or choose no header.",
    });
  if (
    !p.rowCount ||
    !p.columns.length ||
    !p.rows.some((r) => Object.values(r.values).some((v) => v !== null))
  )
    questions.push({
      kind: "empty",
      label:
        "This worksheet has no usable records. Add data to the source file and import it again.",
    });
  for (const c of p.columns) {
    if (mapping.reviewedColumns?.includes(c.id)) continue;
    const raw = sheet.rows
      .slice(mapping.headerRow)
      .map((r) => r[Number(c.id.slice(1)) - 1]?.value)
      .filter((v) => v != null && v !== "");
    if (
      raw.some((v) => dateLike.test(String(v))) &&
      !mapping.dateFormats?.[c.id]
    ) {
      questions.push({
        kind: "date",
        column: c.id,
        label: `${c.name}: how should dates such as ${String(raw.find((v) => dateLike.test(String(v)))).slice(0, 40)} be read?`,
      });
    } else if (
      c.invalid ||
      raw.some(
        (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isDate(String(v)),
      ) ||
      (c.type === "text" &&
        raw.some((v) => typeof v === "number" || number.test(String(v))) &&
        raw.some((v) => !number.test(String(v)))) ||
      raw.some(
        (v) =>
          /^[+-]?\d+[,.]\d+(?:[,.]\d+)?$/.test(String(v)) &&
          !number.test(String(v)),
      )
    ) {
      questions.push({
        kind: "mixed",
        column: c.id,
        label: `${c.name}: values may mix numbers and text or use a local number format. Keep them as text, or correct the source/type in Advanced Settings.`,
      });
    }
  }
  if (p.formulas && (!mapping.useCachedFormulas || p.missingCached))
    questions.push({
      kind: "formula",
      label: p.missingCached
        ? `${p.missingCached} formula results are unavailable. Recalculate and save the workbook, then upload it again.`
        : "This workbook contains cached formula results. They may be stale. Use these saved values?",
    });
  if (p.cellErrors)
    questions.push({
      kind: "empty",
      label:
        "Excel error cells must be corrected in the source before analysis.",
    });
  return questions;
}
export function automaticMapping(sheet: Sheet, name = sheet.name): Mapping {
  const mapping = { ...initialMapping(sheet), name };
  // Look past a short title/preamble only for a full, distinct string header
  // followed by data. Never silently treat a numeric row as column names.
  const width = sheet.rows.reduce((n, row) => Math.max(n, row.length), 0);
  const candidate = sheet.rows.slice(0, 20).findIndex((row, i) => {
    const labels = row.map((c) => c.value);
    return (
      i < sheet.rows.length - 1 &&
      labels.length === width &&
      labels.every(
        (v) =>
          typeof v === "string" &&
          v.trim() &&
          !number.test(v) &&
          !/^\d{4}-\d{2}/.test(v) &&
          !dateLike.test(v),
      ) &&
      new Set(labels).size === width
    );
  });
  if (candidate >= 0) mapping.headerRow = candidate + 1;
  const p = profile({ sheet, mapping });
  mapping.types = Object.fromEntries(p.columns.map((c) => [c.id, c.type]));
  mapping.partitionColumns = p.columns
    .filter((c) => isPartitionName(c.name))
    .map((c) => c.id);
  mapping.confirmed = importQuestions(sheet, mapping).length === 0;
  return mapping;
}
