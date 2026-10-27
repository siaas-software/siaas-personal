export type Value = string | number | boolean | null;
export type Cell = {
  value: Value;
  formula?: string;
  cached?: Value;
  error?: string;
};
export type Sheet = { name: string; rows: Cell[][]; warnings: string[] };
export type ColumnType = "text" | "number" | "date" | "boolean";
export type Mapping = {
  name: string;
  headerRow: number;
  types: Record<string, ColumnType>;
  confirmed: boolean;
  useCachedFormulas: boolean;
  partitionColumns: string[];
  headerReviewed?: boolean;
  reviewedColumns?: string[];
  dateFormats?: Record<string, "DMY" | "MDY">;
};
export type Column = {
  id: string;
  name: string;
  type: ColumnType;
  missing: number;
  invalid: number;
  distinct: number;
  min?: Value;
  max?: Value;
};
export type Dataset = {
  id: string;
  documentId: string;
  assistantId: string;
  filename: string;
  worksheet: string;
  revision: string;
  sheet: Sheet;
  mapping: Mapping;
};
export type Relationship = {
  id: string;
  leftDataset: string;
  leftColumn: string;
  rightDataset: string;
  rightColumn: string;
  cardinality: "one-to-one" | "many-to-one" | "one-to-many" | "many-to-many";
};
export class AnalysisError extends Error {
  readonly status = 422;
}
export const LIMITS = {
  bytes: 10 * 1024 * 1024,
  expanded: 32 * 1024 * 1024,
  rows: 50000,
  columns: 128,
  cells: 250000,
  sheets: 20,
  resultRows: 200,
  outputBytes: 64000,
  operations: 2000000,
  queryMs: 3000,
} as const;
