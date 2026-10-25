import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import Decimal from "decimal.js";
import type { LocalDatabase } from "../local/database";
import { fingerprint, readLinkedDocument } from "../local/knowledge";
import { parseStructured } from "./parser";
import { initialMapping, mappingSchema, profile } from "./profile";
import { AnalysisError, type Dataset, type Relationship } from "./types";
export function initStructured(db: LocalDatabase) {
  // Additive derived tables keep the existing schema version and rollback compatibility.
  db.sql
    .exec(`CREATE TABLE IF NOT EXISTS structured_datasets(id TEXT PRIMARY KEY, assistant_id TEXT NOT NULL REFERENCES assistants(id) ON DELETE CASCADE, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, body TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS structured_assistant ON structured_datasets(assistant_id);
  CREATE TABLE IF NOT EXISTS structured_relationships(id TEXT PRIMARY KEY, assistant_id TEXT NOT NULL REFERENCES assistants(id) ON DELETE CASCADE, left_id TEXT NOT NULL REFERENCES structured_datasets(id) ON DELETE CASCADE, right_id TEXT NOT NULL REFERENCES structured_datasets(id) ON DELETE CASCADE, body TEXT NOT NULL);`);
}
export function datasets(db: LocalDatabase, assistantId: string): Dataset[] {
  db.assistantDirectory(assistantId);
  initStructured(db);
  return db.sql
    .prepare(
      "SELECT s.body FROM structured_datasets s JOIN documents d ON d.id=s.document_id WHERE s.assistant_id=? AND json_extract(d.body,'$.status')='ready' AND coalesce(json_extract(d.body,'$.enabled'),1)!=0",
    )
    .all(assistantId)
    .map((r) => JSON.parse(r.body as string));
}
export function relations(
  db: LocalDatabase,
  assistantId: string,
): Relationship[] {
  db.assistantDirectory(assistantId);
  initStructured(db);
  return db.sql
    .prepare("SELECT body FROM structured_relationships WHERE assistant_id=?")
    .all(assistantId)
    .map((r) => JSON.parse(r.body as string));
}
export async function importStructured(db: LocalDatabase, documentId: string) {
  initStructured(db);
  const doc = db.get("documents", documentId);
  if (!doc || !["xlsx", "csv"].includes(doc.kind))
    throw new AnalysisError("Structured document not found.");
  db.assistantDirectory(doc.assistant_id);
  try {
    const bytes = doc.source_id
      ? readLinkedDocument(db, doc)
      : readFileSync(db.filePath(doc.storage_path));
    const revision = fingerprint(bytes);
    const existing = db.sql
      .prepare("SELECT body FROM structured_datasets WHERE document_id=?")
      .all(documentId)
      .map((r) => JSON.parse(r.body as string) as Dataset);
    if (
      existing.length &&
      existing.every((d) => d.revision === revision) &&
      doc.status === "ready"
    )
      return { ok: true };
    const sheets = await parseStructured(bytes, doc.kind);
    const current = db.get("documents", documentId);
    if (!current) throw new AnalysisError("Document removed during import.");
    if (current.content_hash !== doc.content_hash)
      throw new AnalysisError(
        "Document refreshed during import. Retry using the new source.",
      );
    if (doc.source_id) readLinkedDocument(db, current);
    const other = datasets(db, doc.assistant_id).filter(
      (d) => d.documentId !== documentId,
    );
    const cells = (d: { rows: { length: number }[] }) =>
      d.rows.reduce((n, r) => n + r.length, 0);
    if (
      other.reduce((n, d) => n + cells(d.sheet), 0) +
        sheets.reduce((n, s) => n + cells(s), 0) >
      1000000
    )
      throw new AnalysisError(
        "Assistant limit of one million structured cells reached. Remove unused datasets.",
      );
    const prepared = sheets.map((sheet) => {
      const dataset: Dataset = {
        id: randomUUID(),
        assistantId: doc.assistant_id,
        documentId,
        filename: doc.title,
        worksheet: sheet.name,
        revision,
        sheet,
        mapping: initialMapping(sheet),
      };
      return { dataset, body: JSON.stringify(dataset) };
    });
    const stored = db.sql
      .prepare(
        "SELECT coalesce(sum(length(CAST(body AS BLOB))),0) bytes FROM structured_datasets WHERE assistant_id=? AND document_id!=?",
      )
      .get(doc.assistant_id, documentId) as { bytes: number };
    if (
      stored.bytes +
        prepared.reduce((n, d) => n + Buffer.byteLength(d.body), 0) >
      32 * 1024 * 1024
    )
      throw new AnalysisError(
        "Assistant limit of 32 MB derived structured data reached. Remove unused datasets.",
      );
    db.transaction(() => {
      db.sql
        .prepare("DELETE FROM structured_datasets WHERE document_id=?")
        .run(documentId);
      for (const { dataset, body } of prepared) {
        // Changed source content invalidates confirmed mappings and relationships.
        db.sql
          .prepare("INSERT INTO structured_datasets VALUES(?,?,?,?)")
          .run(dataset.id, doc.assistant_id, documentId, body);
      }
      db.sql
        .prepare("DELETE FROM document_chunks WHERE document_id=?")
        .run(documentId);
      db.put(
        "documents",
        {
          ...doc,
          status: "ready",
          error: null,
          embedding_model: "structured-v1",
          chunk_count: 0,
        },
        true,
      );
    });
    return { ok: true, datasets: sheets.length };
  } catch (error) {
    if (
      db.get("documents", documentId)?.content_hash === doc.content_hash &&
      db.get("documents", documentId)
    )
      db.put(
        "documents",
        {
          ...doc,
          status: "error",
          error:
            error instanceof AnalysisError
              ? error.message
              : "Unable to parse this spreadsheet.",
        },
        true,
      );
    throw error instanceof AnalysisError
      ? error
      : new AnalysisError("Unable to parse this spreadsheet.");
  }
}
export function updateMapping(
  db: LocalDatabase,
  assistantId: string,
  id: string,
  input: unknown,
) {
  const d = datasets(db, assistantId).find((d) => d.id === id);
  if (!d) throw new AnalysisError("Dataset not found in this assistant.");
  const mapping = mappingSchema.parse(input);
  const p = profile({ ...d, mapping });
  mapping.types = Object.fromEntries(p.columns.map((c) => [c.id, c.type]));
  // Currency/unit columns are generic partition dimensions, never silently collapsed.
  for (const c of p.columns)
    if (
      /currency|valuta|unit.*measure|unità|^uom$/i.test(c.name) &&
      !mapping.partitionColumns.includes(c.id)
    )
      throw new AnalysisError(
        `Keep ${c.name} as a partition column to avoid combining incompatible units.`,
      );
  db.transaction(() => {
    db.sql
      .prepare(
        "UPDATE structured_datasets SET body=? WHERE id=? AND assistant_id=?",
      )
      .run(JSON.stringify({ ...d, mapping }), id, assistantId);
    db.sql
      .prepare(
        "DELETE FROM structured_relationships WHERE left_id=? OR right_id=?",
      )
      .run(id, id);
  });
}
export const relationshipSchema = z
  .object({
    leftDataset: z.string().uuid(),
    leftColumn: z.string().max(30),
    rightDataset: z.string().uuid(),
    rightColumn: z.string().max(30),
    cardinality: z.enum([
      "one-to-one",
      "many-to-one",
      "one-to-many",
      "many-to-many",
    ]),
  })
  .strict();
export function saveRelationship(
  db: LocalDatabase,
  assistantId: string,
  input: unknown,
) {
  const r = relationshipSchema.parse(input),
    all = datasets(db, assistantId);
  const left = all.find((d) => d.id === r.leftDataset),
    right = all.find((d) => d.id === r.rightDataset);
  if (!left || !right || !left.mapping.confirmed || !right.mapping.confirmed)
    throw new AnalysisError("Confirm both dataset mappings first.");
  const lp = profile(left),
    rp = profile(right),
    lc = lp.columns.find((c) => c.id === r.leftColumn),
    rc = rp.columns.find((c) => c.id === r.rightColumn);
  if (!lc || !rc || lc.type !== rc.type || lc.invalid || rc.invalid)
    throw new AnalysisError("Join columns must have matching, valid types.");
  const canonical = (value: unknown, type: string) =>
    type === "number" ? new Decimal(String(value)).toString() : String(value);
  const unique = (p: ReturnType<typeof profile>, c: string) => {
    const values = p.rows.map((r) => r.values[c]).filter((v) => v !== null);
    return (
      new Set(
        values.map((v) =>
          canonical(v, p.columns.find((col) => col.id === c)!.type),
        ),
      ).size === values.length
    );
  };
  if (
    (r.cardinality === "one-to-one" || r.cardinality === "one-to-many") &&
    !unique(lp, r.leftColumn)
  )
    throw new AnalysisError("Left join key is not unique.");
  if (
    (r.cardinality === "one-to-one" || r.cardinality === "many-to-one") &&
    !unique(rp, r.rightColumn)
  )
    throw new AnalysisError("Right join key is not unique.");
  const rightKeys = new Set(
    rp.rows
      .filter((row) => row.values[r.rightColumn] !== null)
      .map((row) => canonical(row.values[r.rightColumn], rc.type)),
  );
  const missing = lp.rows.filter(
    (row) =>
      row.values[r.leftColumn] === null ||
      !rightKeys.has(canonical(row.values[r.leftColumn], lc.type)),
  ).length;
  const relation = { id: randomUUID(), ...r };
  db.sql
    .prepare("INSERT INTO structured_relationships VALUES(?,?,?,?,?)")
    .run(relation.id, assistantId, left.id, right.id, JSON.stringify(relation));
  return { ...relation, unmatchedLeftRows: missing };
}
export function inspectDatasets(db: LocalDatabase, assistantId: string) {
  return datasets(db, assistantId).map((d) => {
    const p = profile(d);
    return {
      id: d.id,
      documentId: d.documentId,
      filename: d.filename,
      worksheet: d.worksheet,
      revision: d.revision,
      mapping: d.mapping,
      ...p,
      rows: p.rows.slice(0, 20),
      rawPreview: d.sheet.rows.slice(0, 10),
    };
  });
}
