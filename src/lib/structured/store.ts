import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import Decimal from "decimal.js";
import type { LocalDatabase } from "../local/database";
import { fingerprint, readLinkedDocument } from "../local/knowledge";
import { parseStructured } from "./parser";
import { mappingSchema, profile } from "./profile";
import {
  automaticMapping,
  importQuestions,
  isPartitionName,
} from "./import-review";
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
        id:
          existing.find((d) => d.worksheet === sheet.name)?.id ?? randomUUID(),
        assistantId: doc.assistant_id,
        documentId,
        filename: doc.title,
        worksheet: sheet.name,
        revision,
        sheet,
        mapping: automaticMapping(
          sheet,
          doc.kind === "csv" ? doc.title.replace(/\.csv$/i, "") : sheet.name,
        ),
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
    if (isPartitionName(c.name) && !mapping.partitionColumns.includes(c.id))
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
      questions: d.mapping.confirmed ? [] : importQuestions(d.sheet, d.mapping),
      ...p,
      rows: p.rows.slice(0, 20),
      rawPreview: d.sheet.rows.slice(0, 10),
    };
  });
}

export function clarifyImport(
  db: LocalDatabase,
  assistantId: string,
  id: string,
  input: unknown,
) {
  const answer = z
    .object({
      kind: z.enum(["header", "date", "mixed", "formula"]),
      column: z.string().optional(),
      value: z.union([z.string(), z.number()]),
    })
    .strict()
    .parse(input);
  const d = datasets(db, assistantId).find((d) => d.id === id);
  if (!d) throw new AnalysisError("Dataset not found in this assistant.");
  const questions = importQuestions(d.sheet, d.mapping);
  if (
    !questions.some((q) => q.kind === answer.kind && q.column === answer.column)
  )
    throw new AnalysisError(
      "This clarification is no longer needed. Refresh the file preview.",
    );
  const mapping = structuredClone(d.mapping);
  if (answer.kind === "header") {
    if (
      typeof answer.value !== "number" ||
      !Number.isInteger(answer.value) ||
      answer.value < 0 ||
      answer.value > d.sheet.rows.length
    )
      throw new AnalysisError("Choose a valid header row.");
    mapping.headerRow = answer.value;
    mapping.headerReviewed = true;
    mapping.types = {};
    mapping.reviewedColumns = [];
    mapping.dateFormats = {};
    const p = profile({ sheet: d.sheet, mapping });
    mapping.types = Object.fromEntries(p.columns.map((c) => [c.id, c.type]));
    mapping.partitionColumns = p.columns
      .filter((c) => isPartitionName(c.name))
      .map((c) => c.id);
  } else if (answer.kind === "formula") {
    if (answer.value !== "accept" || profile(d).missingCached)
      throw new AnalysisError("Recalculate missing formula results first.");
    mapping.useCachedFormulas = true;
    // Formula columns were excluded before consent; infer their saved values now.
    for (const c of profile(d).columns) {
      if (
        d.sheet.rows
          .slice(mapping.headerRow)
          .some((row) => row[Number(c.id.slice(1)) - 1]?.formula)
      )
        delete mapping.types[c.id];
    }
  } else {
    const column = profile(d).columns.find((c) => c.id === answer.column);
    if (!column) throw new AnalysisError("Unknown clarification column.");
    if (answer.value === "text") {
      mapping.types[column.id] = "text";
      mapping.reviewedColumns = [
        ...new Set([...(mapping.reviewedColumns ?? []), column.id]),
      ];
    } else if (
      answer.kind === "date" &&
      ["DMY", "MDY"].includes(String(answer.value))
    ) {
      mapping.types[column.id] = "date";
      mapping.dateFormats = {
        ...mapping.dateFormats,
        [column.id]: answer.value as "DMY" | "MDY",
      };
      if (
        profile({ sheet: d.sheet, mapping }).columns.find(
          (c) => c.id === column.id,
        )?.invalid
      )
        throw new AnalysisError(
          "Some dates do not match this order. Correct the source or keep this column as text.",
        );
    } else throw new AnalysisError("Unsupported clarification choice.");
  }
  mapping.confirmed = importQuestions(d.sheet, mapping).length === 0;
  updateMapping(db, assistantId, id, mapping);
}

// Candidates are suggestions, never executable relationships until the user
// confirms that equal labels represent the same business entity.
export function relationshipCandidates(db: LocalDatabase, assistantId: string) {
  const all = datasets(db, assistantId).filter((d) => d.mapping.confirmed);
  const saved = relations(db, assistantId);
  const profiles = all.map((d) => ({ d, p: profile(d) }));
  const candidates: Array<Omit<Relationship, "id"> & { label: string }> = [];
  for (let i = 0; i < profiles.length; i++)
    for (let j = i + 1; j < profiles.length; j++) {
      const { d: left, p: lp } = profiles[i],
        { d: right, p: rp } = profiles[j];
      for (const lc of lp.columns)
        for (const rc of rp.columns) {
          if (candidates.length >= 30) return candidates;
          if (
            lc.name.toLowerCase().trim() !== rc.name.toLowerCase().trim() ||
            lc.type !== rc.type ||
            lc.invalid ||
            rc.invalid ||
            lc.missing ||
            rc.missing ||
            !lc.distinct ||
            !rc.distinct ||
            isPartitionName(lc.name)
          )
            continue;
          if (lc.distinct !== lp.rowCount && rc.distinct !== rp.rowCount)
            continue;
          if (
            saved.some(
              (r) =>
                (r.leftDataset === left.id && r.rightDataset === right.id) ||
                (r.leftDataset === right.id && r.rightDataset === left.id),
            )
          )
            continue;
          const values = new Set(rp.rows.map((r) => String(r.values[rc.id])));
          if (!lp.rows.some((r) => values.has(String(r.values[lc.id]))))
            continue;
          candidates.push({
            leftDataset: left.id,
            leftColumn: lc.id,
            rightDataset: right.id,
            rightColumn: rc.id,
            cardinality:
              lc.distinct === lp.rowCount
                ? rc.distinct === rp.rowCount
                  ? "one-to-one"
                  : "one-to-many"
                : "many-to-one",
            label: `${left.filename} / ${left.worksheet} and ${right.filename} / ${right.worksheet}: does “${lc.name}” identify the same thing?`,
          });
        }
    }
  return candidates;
}
