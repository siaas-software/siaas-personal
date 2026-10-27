import { z } from "zod";
import Decimal from "decimal.js";
import {
  AnalysisError,
  type Cell,
  type Column,
  type ColumnType,
  type Dataset,
  type Mapping,
  type Sheet,
  type Value,
} from "./types";
export const mappingSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    headerRow: z.number().int().min(0).max(50000),
    types: z.record(
      z.string().regex(/^c[1-9][0-9]*$/),
      z.enum(["text", "number", "date", "boolean"]),
    ),
    confirmed: z.boolean(),
    headerReviewed: z.boolean().optional(),
    reviewedColumns: z
      .array(z.string().regex(/^c[1-9][0-9]*$/))
      .max(128)
      .optional(),
    dateFormats: z
      .record(z.string().regex(/^c[1-9][0-9]*$/), z.enum(["DMY", "MDY"]))
      .optional(),
    useCachedFormulas: z.boolean(),
    partitionColumns: z.array(z.string().regex(/^c[1-9][0-9]*$/)).max(8),
  })
  .strict();
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d{1,3})?$/i;
export function isDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function infer(values: Value[]): ColumnType {
  const data = values.filter((v) => v !== null && v !== "");
  if (!data.length) return "text";
  if (
    data.every((v) => typeof v === "boolean" || v === "true" || v === "false")
  )
    return "boolean";
  if (data.every((v) => typeof v === "string" && isDate(v))) return "date";
  if (
    data.every(
      (v) =>
        typeof v === "number" ||
        (typeof v === "string" && numeric.test(v) && !/^[+-]?0\d/.test(v)),
    )
  )
    return "number";
  return "text";
}
export function convert(
  value: Value,
  type: ColumnType,
  dateFormat?: "DMY" | "MDY",
): Value {
  if (value === null || value === "") return null;
  if (type === "text") return String(value);
  if (type === "date") {
    if (typeof value !== "string") return null;
    if (isDate(value)) return value;
    const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match || !dateFormat) return null;
    const day = dateFormat === "DMY" ? match[1] : match[2];
    const month = dateFormat === "DMY" ? match[2] : match[1];
    const iso = `${match[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return isDate(iso) ? iso : null;
  }
  if (type === "boolean")
    return typeof value === "boolean"
      ? value
      : value === "true"
        ? true
        : value === "false"
          ? false
          : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value !== "string" ||
    !numeric.test(value.trim()) ||
    !Number.isFinite(Number(value))
  )
    return null;
  // Preserve decimal text for exact decimal arithmetic; never coerce identifiers automatically.
  return value.trim();
}
export function initialMapping(sheet: Sheet): Mapping {
  const first = sheet.rows.findIndex((row) =>
    row.some((c) => c.value !== null),
  );
  const row = sheet.rows[first] ?? [];
  const headerRow =
    row.length &&
    row.every(
      (c) =>
        typeof c.value === "string" &&
        !numeric.test(c.value) &&
        !isDate(c.value),
    )
      ? first + 1
      : 0;
  return {
    name: sheet.name,
    headerRow,
    types: {},
    confirmed: false,
    useCachedFormulas: false,
    partitionColumns: [],
  };
}
export function profile(dataset: Pick<Dataset, "sheet" | "mapping">) {
  const { sheet, mapping } = dataset;
  if (mapping.headerRow > sheet.rows.length)
    throw new AnalysisError("Header row is outside this worksheet.");
  const width = sheet.rows.reduce((n, r) => Math.max(n, r.length), 0);
  const header = mapping.headerRow ? sheet.rows[mapping.headerRow - 1] : [];
  const warnings = [...sheet.warnings];
  if (!mapping.headerRow)
    warnings.push("No header selected. Generic column names are used.");
  if (!mapping.confirmed)
    warnings.push(
      "Review and confirm the header, column types and unit/currency partitions before querying.",
    );
  const read = (cell: Cell | undefined): Value =>
    cell?.formula
      ? mapping.useCachedFormulas && !cell.error
        ? (cell.cached ?? null)
        : null
      : (cell?.value ?? null);
  const records = sheet.rows.slice(mapping.headerRow).map((row, i) => ({
    sourceRow: i + mapping.headerRow + 1,
    cells: Array.from({ length: width }, (_, j) => row[j]),
  }));
  let formulas = 0,
    missingCached = 0,
    cellErrors = 0;
  for (const r of records)
    for (const c of r.cells) {
      if (c?.formula) {
        formulas++;
        if (c.cached == null) missingCached++;
      }
      if (c?.error) cellErrors++;
    }
  if (formulas)
    warnings.push(
      `${formulas} formula cells; ${missingCached} missing cached results. Cached results may be stale. ${mapping.useCachedFormulas ? "Cached values explicitly enabled." : "Formula values excluded from calculations."}`,
    );
  if (cellErrors) warnings.push(`${cellErrors} Excel error cells.`);
  const names = new Set<string>();
  const columns: Column[] = Array.from({ length: width }, (_, i) => {
    const id = `c${i + 1}`,
      name = String(header[i]?.value ?? `Column ${i + 1}`);
    if (names.has(name))
      warnings.push(`Duplicate header: ${name}. Use the unique column IDs.`);
    names.add(name);
    const raw = records.map((r) => read(r.cells[i]));
    const type = mapping.types[id] ?? infer(raw);
    const values = raw.map((v) => convert(v, type, mapping.dateFormats?.[id]));
    const invalid = raw.filter(
      (v, j) => v !== null && v !== "" && values[j] === null,
    ).length;
    if (invalid)
      warnings.push(
        `${name}: ${invalid} invalid ${type} values; correct the type or source.`,
      );
    if (
      type === "text" &&
      raw.some(
        (v) =>
          typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isDate(v),
      )
    )
      warnings.push(`${name}: invalid ISO date detected.`);
    const nonempty = values.filter((v) => v !== null);
    const sorted = [...nonempty].sort((a, b) =>
      type === "number"
        ? new Decimal(String(a)).comparedTo(new Decimal(String(b)))
        : String(a) < String(b)
          ? -1
          : String(a) > String(b)
            ? 1
            : 0,
    );
    return {
      id,
      name,
      type,
      missing: raw.filter((v) => v === null || v === "").length,
      invalid,
      distinct: new Set(
        nonempty.map((v) =>
          type === "number"
            ? new Decimal(String(v)).toString()
            : JSON.stringify(v),
        ),
      ).size,
      ...(sorted.length ? { min: sorted[0], max: sorted.at(-1) } : {}),
    };
  });
  for (const id of [
    ...Object.keys(mapping.types),
    ...mapping.partitionColumns,
    ...Object.keys(mapping.dateFormats ?? {}),
    ...(mapping.reviewedColumns ?? []),
  ])
    if (!columns.some((c) => c.id === id))
      throw new AnalysisError(`Unknown mapping column ${id}.`);
  const rows = records.map((r) => ({
    sourceRow: r.sourceRow,
    values: Object.fromEntries(
      columns.map((c, i) => [
        c.id,
        convert(read(r.cells[i]), c.type, mapping.dateFormats?.[c.id]),
      ]),
    ) as Record<string, Value>,
  }));
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = JSON.stringify(row.values);
    if (seen.has(key)) duplicates++;
    seen.add(key);
  }
  if (duplicates)
    warnings.push(`${duplicates} duplicate rows (not automatically removed).`);
  return {
    columns,
    rows,
    warnings,
    duplicates,
    formulas,
    missingCached,
    cellErrors,
    rowCount: rows.length,
    columnCount: width,
  };
}
