import { z } from "zod";
import Decimal from "decimal.js";
import { performance } from "node:perf_hooks";
import { profile } from "./profile";
import {
  AnalysisError,
  LIMITS,
  type Dataset,
  type Relationship,
  type Value,
  type ColumnType,
} from "./types";
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);
const column = z.string().min(1).max(100);
const operand = z.union([
  z.object({ column }).strict(),
  z
    .object({
      value: z.union([
        z.string().max(200),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    })
    .strict(),
]);
const step = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("filter"),
      column,
      comparison: z.enum([
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "isNull",
        "notNull",
      ]),
      value: operand.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("derive"),
      as: name,
      operator: z.enum([
        "add",
        "subtract",
        "multiply",
        "divide",
        "ceil",
        "abs",
        "month",
        "year",
        "coalesce",
      ]),
      left: operand,
      right: operand.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("group"),
      by: z.array(column).max(8),
      aggregates: z
        .array(
          z
            .object({
              as: name,
              fn: z.enum(["sum", "count", "avg", "min", "max"]),
              column: column.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(12),
    })
    .strict(),
  z
    .object({
      op: z.literal("sort"),
      by: z
        .array(
          z.object({ column, direction: z.enum(["asc", "desc"]) }).strict(),
        )
        .min(1)
        .max(6),
    })
    .strict(),
  z
    .object({
      op: z.literal("join"),
      right: name,
      relationshipId: z.string().uuid(),
      kind: z.enum(["inner", "left", "anti"]),
    })
    .strict(),
  z
    .object({ op: z.literal("duplicates"), by: z.array(column).min(1).max(8) })
    .strict(),
  z
    .object({
      op: z.literal("select"),
      columns: z.array(column).min(1).max(30),
    })
    .strict(),
]);
export const planSchema = z
  .object({
    stages: z
      .array(
        z
          .object({
            id: name,
            datasetId: z.string().uuid(),
            steps: z.array(step).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    output: name,
    limit: z.number().int().min(1).max(LIMITS.resultRows).default(100),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
type Meta = { type: ColumnType; origin?: string; partition?: boolean };
type Row = Record<string, Value>;
type Table = { rows: Row[]; columns: Map<string, Meta> };
export function executePlan(
  input: unknown,
  authorized: Dataset[],
  relationships: Relationship[],
  options: { maxMs?: number; maxOperations?: number } = {},
) {
  const plan = planSchema.parse(input),
    start = performance.now();
  let operations = 0;
  const tick = (n = 1) => {
    operations += n;
    if (
      operations > (options.maxOperations ?? LIMITS.operations) ||
      performance.now() - start > (options.maxMs ?? LIMITS.queryMs)
    )
      throw new AnalysisError(
        "Query resource limit reached. Filter earlier or split the analysis.",
      );
  };
  const tables = new Map<string, Table>(),
    evidence: object[] = [],
    warnings = new Set<string>();
  const need = (t: Table, c: string) => {
    const m = t.columns.get(c);
    if (!m) throw new AnalysisError(`Unknown column ${c}.`);
    return m;
  };
  const num = (v: Value) => {
    if (v === null) return null;
    try {
      const n = new D(String(v));
      if (!n.isFinite() || n.abs().greaterThan("1e100")) throw new Error();
      return n;
    } catch {
      throw new AnalysisError("Invalid numeric value.");
    }
  };
  const out = (v: Decimal | null): Value => (v === null ? null : v.toString());
  const cmp = (a: Value, b: Value, m: Meta) =>
    m.type === "number"
      ? num(a)!.comparedTo(num(b)!)
      : String(a) < String(b)
        ? -1
        : String(a) > String(b)
          ? 1
          : 0;
  const key = (r: Row, keys: string[], t: Table) =>
    JSON.stringify(
      keys.map((c) =>
        r[c] === null
          ? null
          : need(t, c).type === "number"
            ? num(r[c])!.toString()
            : r[c],
      ),
    );
  const value = (r: Row, o: z.infer<typeof operand>, t: Table): Value =>
    "column" in o ? (need(t, o.column), r[o.column]) : o.value;
  const operandType = (o: z.infer<typeof operand>, t: Table) =>
    "column" in o
      ? need(t, o.column).type
      : typeof o.value === "number"
        ? "number"
        : typeof o.value === "boolean"
          ? "boolean"
          : "text";
  const ensureNumeric = (o: z.infer<typeof operand>, t: Table) => {
    if ("column" in o && need(t, o.column).type !== "number")
      throw new AnalysisError(`Column ${o.column} must be mapped as number.`);
  };
  for (const stage of plan.stages) {
    tick();
    if (tables.has(stage.id))
      throw new AnalysisError("Stage identifiers must be unique.");
    const dataset = authorized.find((d) => d.id === stage.datasetId);
    if (!dataset)
      throw new AnalysisError("Dataset is not authorized for this assistant.");
    if (!dataset.mapping.confirmed)
      throw new AnalysisError(
        `Confirm the mapping for ${dataset.mapping.name} in Knowledge first.`,
      );
    const p = profile(dataset);
    tick(p.rows.length * p.columns.length);
    if (p.columns.some((c) => c.invalid) || p.cellErrors)
      throw new AnalysisError(
        `Invalid typed values in ${dataset.mapping.name}. Correct its mapping or source before calculating.`,
      );
    p.warnings.forEach((w) => warnings.add(w));
    const blocked = new Set(
      p.columns
        .filter((_, i) =>
          dataset.sheet.rows
            .slice(dataset.mapping.headerRow)
            .some(
              (r) =>
                r[i]?.formula &&
                (!dataset.mapping.useCachedFormulas ||
                  r[i]?.cached == null ||
                  r[i]?.error),
            ),
        )
        .map((c) => c.id),
    );
    const used = new Set<string>();
    for (const s of stage.steps) {
      if ("column" in s) used.add(s.column);
      if ("left" in s && "column" in s.left) used.add(s.left.column);
      if ("right" in s && typeof s.right === "object" && "column" in s.right)
        used.add(s.right.column);
      if ("value" in s && s.value && "column" in s.value)
        used.add(s.value.column);
      if (s.op === "group")
        s.aggregates.forEach((a) => a.column && used.add(a.column));
    }
    if (blocked.size)
      throw new AnalysisError(
        "Dataset contains formula cells without confirmed, available cached values. Recalculate the workbook externally or explicitly accept cached results in Knowledge.",
      );
    let t: Table = {
      rows: p.rows.map((r) => r.values),
      columns: new Map(
        p.columns.map((c) => [
          c.id,
          {
            type: c.type,
            origin: `${dataset.id}:${c.id}`,
            partition: dataset.mapping.partitionColumns.includes(c.id),
          },
        ]),
      ),
    };
    evidence.push({
      datasetId: dataset.id,
      name: dataset.mapping.name,
      filename: dataset.filename,
      worksheet: dataset.worksheet,
      sha256: dataset.revision,
      columns: p.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
      sourceRange: {
        firstRow: dataset.mapping.headerRow + 1,
        lastRow: dataset.sheet.rows.length,
      },
      scope:
        "Input rows before the recorded plan filters; not per-result lineage",
      mapping: dataset.mapping,
      steps: stage.steps,
    });
    for (const s of stage.steps) {
      tick(t.rows.length);
      if (s.op === "filter") {
        const m = need(t, s.column);
        if (!["isNull", "notNull"].includes(s.comparison) && !s.value)
          throw new AnalysisError("Filter value is required.");
        t.rows = t.rows.filter((r) => {
          tick();
          const a = r[s.column];
          if (s.comparison === "isNull") return a === null;
          if (s.comparison === "notNull") return a !== null;
          const b = value(r, s.value!, t);
          if (a === null || b === null) return false;
          if (s.comparison === "contains") return String(a).includes(String(b));
          const c = cmp(a, b, m);
          return s.comparison === "eq"
            ? c === 0
            : s.comparison === "ne"
              ? c !== 0
              : s.comparison === "gt"
                ? c > 0
                : s.comparison === "gte"
                  ? c >= 0
                  : s.comparison === "lt"
                    ? c < 0
                    : c <= 0;
        });
      } else if (s.op === "derive") {
        if (t.columns.has(s.as))
          throw new AnalysisError(
            "Calculated column would overwrite an existing column.",
          );
        const date = s.operator === "month" || s.operator === "year";
        if (date && operandType(s.left, t) !== "date")
          throw new AnalysisError("Date grouping requires a date column.");
        if (!date && s.operator !== "coalesce") {
          ensureNumeric(s.left, t);
          if (s.right) ensureNumeric(s.right, t);
        }
        if (
          ["add", "subtract", "multiply", "divide", "coalesce"].includes(
            s.operator,
          ) &&
          !s.right
        )
          throw new AnalysisError("Second operand required.");
        const type = date
          ? "text"
          : s.operator === "coalesce"
            ? operandType(s.left, t)
            : "number";
        t.rows = t.rows.map((r) => {
          tick();
          const a = value(r, s.left, t),
            b = s.right ? value(r, s.right, t) : null;
          let result: Value = null;
          if (date)
            result =
              a === null
                ? null
                : String(a).slice(0, s.operator === "month" ? 7 : 4);
          else if (s.operator === "coalesce") result = a ?? b;
          else if (a !== null) {
            const x = num(a)!;
            if (s.operator === "abs") result = out(x.abs());
            else if (s.operator === "ceil") result = out(x.ceil());
            else if (b !== null) {
              const y = num(b)!;
              if (s.operator === "divide" && y.isZero())
                throw new AnalysisError("Division by zero.");
              result = out(
                s.operator === "add"
                  ? x.add(y)
                  : s.operator === "subtract"
                    ? x.sub(y)
                    : s.operator === "multiply"
                      ? x.mul(y)
                      : x.div(y),
              );
            }
          }
          return { ...r, [s.as]: result };
        });
        t.columns.set(s.as, { type });
      } else if (s.op === "group") {
        s.by.forEach((c) => need(t, c));
        for (const [c, m] of t.columns)
          if (m.partition && !s.by.includes(c))
            throw new AnalysisError(
              `Group by partition column ${c}; units/currencies cannot be combined.`,
            );
        const next = new Map(s.by.map((c) => [c, need(t, c)]));
        for (const a of s.aggregates) {
          if (next.has(a.as))
            throw new AnalysisError("Duplicate aggregate alias.");
          if (a.fn !== "count" && !a.column)
            throw new AnalysisError("Aggregate column required.");
          const m = a.column ? need(t, a.column) : undefined;
          if (["sum", "avg"].includes(a.fn) && m?.type !== "number")
            throw new AnalysisError("SUM/AVG require numeric columns.");
          next.set(a.as, {
            type:
              a.fn === "count" || a.fn === "sum" || a.fn === "avg"
                ? "number"
                : m!.type,
          });
        }
        const groups = new Map<string, Row[]>();
        for (const r of t.rows) {
          tick();
          const k = key(r, s.by, t);
          const g = groups.get(k);
          if (g) g.push(r);
          else groups.set(k, [r]);
        }
        if (!t.rows.length && !s.by.length) groups.set("[]", []);
        t.rows = [...groups.values()].map((group) => {
          const r: Row = Object.fromEntries(s.by.map((c) => [c, group[0][c]]));
          for (const a of s.aggregates) {
            tick(group.length);
            const values = a.column
              ? group.map((r) => r[a.column!]).filter((v) => v !== null)
              : [];
            if (a.column && values.length < group.length)
              warnings.add(
                `${a.as}: ${group.length - values.length} missing values excluded; missing is not zero.`,
              );
            if (a.fn === "count")
              r[a.as] = a.column ? values.length : group.length;
            else if (!values.length) r[a.as] = null;
            else if (a.fn === "sum" || a.fn === "avg") {
              let n = new D(0);
              for (const v of values) n = n.add(num(v)!);
              r[a.as] = out(a.fn === "avg" ? n.div(values.length) : n);
            } else {
              const m = need(t, a.column!);
              r[a.as] = values.reduce((x, y) =>
                cmp(x, y, m) * (a.fn === "min" ? 1 : -1) <= 0 ? x : y,
              );
            }
          }
          return r;
        });
        t.columns = next;
      } else if (s.op === "join") {
        const right = tables.get(s.right),
          rel = relationships.find((r) => r.id === s.relationshipId);
        if (!right || !rel)
          throw new AnalysisError(
            "Join requires an earlier stage and a confirmed relationship.",
          );
        const leftKey = [...t.columns].find(
          ([, m]) => m.origin === `${rel.leftDataset}:${rel.leftColumn}`,
        )?.[0];
        const rightKey = [...right.columns].find(
          ([, m]) => m.origin === `${rel.rightDataset}:${rel.rightColumn}`,
        )?.[0];
        if (!leftKey || !rightKey)
          throw new AnalysisError(
            "Relationship does not match these stage columns or direction.",
          );
        const index = new Map<string, Row[]>();
        for (const r of right.rows) {
          tick();
          if (r[rightKey] === null) continue;
          const k = key(r, [rightKey], right);
          const g = index.get(k);
          if (g) g.push(r);
          else index.set(k, [r]);
        }
        if (
          ["one-to-one", "many-to-one"].includes(rel.cardinality) &&
          [...index.values()].some((rows) => rows.length > 1)
        )
          throw new AnalysisError(
            "Right stage violates the confirmed unique-key cardinality.",
          );
        if (["one-to-one", "one-to-many"].includes(rel.cardinality)) {
          const keys = new Set<string>();
          for (const row of t.rows) {
            tick();
            if (row[leftKey] === null) continue;
            const k = key(row, [leftKey], t);
            if (keys.has(k))
              throw new AnalysisError(
                "Left stage violates the confirmed unique-key cardinality.",
              );
            keys.add(k);
          }
        }
        const joined: Row[] = [];
        for (const l of t.rows) {
          tick();
          const matches =
            l[leftKey] === null ? [] : (index.get(key(l, [leftKey], t)) ?? []);
          if (s.kind === "anti") {
            if (!matches.length) joined.push(l);
            continue;
          }
          for (const r of matches.length
            ? matches
            : s.kind === "left"
              ? [null]
              : []) {
            tick();
            if (joined.length >= LIMITS.rows)
              throw new AnalysisError("Join exceeds 50000 rows.");
            for (const [c, m] of t.columns)
              if (m.partition && r) {
                const lp = l[c];
                const candidates = [...right.columns].filter(
                  ([, v]) => v.partition,
                );
                if (!candidates.some(([rc]) => r[rc] === lp))
                  throw new AnalysisError(
                    "Joined unit/currency partitions do not match. Filter and map compatible units first.",
                  );
              }
            joined.push({
              ...l,
              ...Object.fromEntries(
                [...right.columns].map(([c]) => [
                  `${s.right}.${c}`,
                  r?.[c] ?? null,
                ]),
              ),
            });
          }
        }
        if (s.kind !== "anti")
          for (const [c, m] of right.columns) {
            const alias = `${s.right}.${c}`;
            if (t.columns.has(alias))
              throw new AnalysisError("Join alias collision.");
            t.columns.set(alias, m);
          }
        t.rows = joined;
      } else if (s.op === "sort") {
        s.by.forEach((b) => need(t, b.column));
        t.rows.sort((a, b) => {
          tick();
          for (const o of s.by) {
            const x = a[o.column],
              y = b[o.column];
            const c =
              x === null
                ? y === null
                  ? 0
                  : 1
                : y === null
                  ? -1
                  : cmp(x, y, need(t, o.column));
            if (c) return c * (o.direction === "asc" ? 1 : -1);
          }
          return 0;
        });
      } else if (s.op === "duplicates") {
        s.by.forEach((c) => need(t, c));
        const counts = new Map<string, number>();
        for (const r of t.rows) {
          tick();
          const k = key(r, s.by, t);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        t.rows = t.rows.filter((r) => (counts.get(key(r, s.by, t)) ?? 0) > 1);
      } else if (s.op === "select") {
        for (const [c, m] of t.columns)
          if (m.partition && !s.columns.includes(c))
            throw new AnalysisError(
              `Keep partition column ${c} in the result.`,
            );
        s.columns.forEach((c) => need(t, c));
        t.rows = t.rows.map((r) =>
          Object.fromEntries(s.columns.map((c) => [c, r[c]])),
        );
        t.columns = new Map(s.columns.map((c) => [c, need(t, c)]));
      }
      if (
        t.rows.length > LIMITS.rows ||
        t.columns.size > 256 ||
        t.rows.length * t.columns.size > 1000000
      )
        throw new AnalysisError("Intermediate result exceeds resource limits.");
    }
    tables.set(stage.id, t);
    if (
      [...tables.values()].reduce(
        (n, table) => n + table.rows.length * table.columns.size,
        0,
      ) > 1000000
    )
      throw new AnalysisError(
        "Combined stage memory budget exceeded. Reduce the plan size.",
      );
  }
  const result = tables.get(plan.output);
  if (!result) throw new AnalysisError("Output stage not found.");
  const totalRows = result.rows.length,
    rows = result.rows.slice(0, plan.limit);
  const response = {
    columns: [...result.columns].map(([id, m]) => ({ id, type: m.type })),
    rows,
    totalRows,
    truncated: totalRows > rows.length,
    warnings: [...warnings],
    evidence,
    plan,
    method:
      "Validated typed operations; decimal arithmetic (40 significant digits, half-even rounding).",
  };
  if (Buffer.byteLength(JSON.stringify(response)) > LIMITS.outputBytes)
    throw new AnalysisError(
      "Result exceeds 64 KB. Select fewer columns or reduce the result limit.",
    );
  return response;
}
export type AnalysisResult = ReturnType<typeof executePlan>;
