"use client";
import { useCallback, useEffect, useState } from "react";
import type { inspectDatasets } from "@/lib/structured/store";
import type { Relationship, Mapping, ColumnType } from "@/lib/structured/types";
import type { AnalysisResult } from "@/lib/structured/engine";
type Inspection = ReturnType<typeof inspectDatasets>[number];
async function request(assistantId: string, body?: object) {
  const response = await fetch(
    `/api/local/structured?assistant=${encodeURIComponent(assistantId)}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assistantId, ...body }),
        }
      : undefined,
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "Structured analysis failed.");
  return result;
}
function DatasetCard({
  dataset,
  busy,
  save,
  remove,
}: {
  dataset: Inspection;
  busy: boolean;
  save: (mapping: Mapping) => void;
  remove: () => void;
}) {
  const [mapping, setMapping] = useState<Mapping>(dataset.mapping);
  useEffect(
    () =>
      setMapping({
        ...dataset.mapping,
        types: Object.fromEntries(dataset.columns.map((c) => [c.id, c.type])),
        partitionColumns: [
          ...new Set([
            ...dataset.mapping.partitionColumns,
            ...dataset.columns
              .filter((c) =>
                /currency|valuta|unit.*measure|unità|^uom$/i.test(c.name),
              )
              .map((c) => c.id),
          ]),
        ],
      }),
    [dataset],
  );
  return (
    <details className="structured-dataset">
      <summary>
        {dataset.filename} · {dataset.worksheet} · {dataset.rowCount} rows ×{" "}
        {dataset.columnCount} columns ·{" "}
        {dataset.mapping.confirmed ? "Confirmed" : "Review mapping"}
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ ...mapping, confirmed: true });
        }}
      >
        <label>
          Dataset name
          <input
            maxLength={100}
            required
            value={mapping.name}
            onChange={(e) => setMapping({ ...mapping, name: e.target.value })}
          />
        </label>
        <label>
          Header row (0 = no header)
          <input
            type="number"
            min={0}
            max={50000}
            required
            value={mapping.headerRow}
            onChange={(e) =>
              setMapping({
                ...mapping,
                headerRow: Number(e.target.value),
                confirmed: false,
              })
            }
          />
        </label>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => save({ ...mapping, types: {}, confirmed: false })}
        >
          Apply header and infer types
        </button>
        <div className="structured-scroll">
          <table>
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Missing / invalid</th>
                <th>Distinct</th>
                <th>Unit / currency partition</th>
              </tr>
            </thead>
            <tbody>
              {dataset.columns.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.id}: {c.name}
                  </td>
                  <td>
                    <select
                      aria-label={`Type for ${c.name}`}
                      value={mapping.types[c.id] ?? c.type}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          types: {
                            ...mapping.types,
                            [c.id]: e.target.value as ColumnType,
                          },
                        })
                      }
                    >
                      {["text", "number", "date", "boolean"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {c.missing} / {c.invalid}
                  </td>
                  <td>{c.distinct}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Partition ${c.name}`}
                      checked={mapping.partitionColumns.includes(c.id)}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          partitionColumns: e.target.checked
                            ? [...mapping.partitionColumns, c.id]
                            : mapping.partitionColumns.filter(
                                (id) => id !== c.id,
                              ),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Text preserves identifiers and leading zeros. Dates require
          YYYY-MM-DD. Mark currency and unit columns as partitions to prevent
          incompatible totals. Saving a mapping removes its relationships for
          review.
        </p>
        <label>
          <input
            type="checkbox"
            checked={mapping.useCachedFormulas}
            onChange={(e) =>
              setMapping({ ...mapping, useCachedFormulas: e.target.checked })
            }
          />{" "}
          I accept that cached formula results may be stale. Use available
          cached values.
        </label>
        <div className="button-row">
          <button className="button primary" disabled={busy}>
            Confirm mapping
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={remove}
          >
            Remove dataset
          </button>
        </div>
      </form>
      <ul>
        {dataset.warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
      <h4>Data preview (first 20 records)</h4>
      <div className="structured-scroll">
        <table>
          <thead>
            <tr>
              <th>Source row</th>
              {dataset.columns.map((c) => (
                <th key={c.id}>
                  {c.name} ({c.id})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataset.rows.map((r) => (
              <tr key={r.sourceRow}>
                <td>{r.sourceRow}</td>
                {dataset.columns.map((c) => (
                  <td key={c.id}>{String(r.values[c.id] ?? "∅")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Original cells and formula metadata (first 10 rows)</summary>
        <pre>{JSON.stringify(dataset.rawPreview, null, 2)}</pre>
      </details>
    </details>
  );
}
export function StructuredKnowledge({
  assistantId,
  revision,
}: {
  assistantId: string;
  revision: number;
}) {
  const [data, setData] = useState<{
    datasets: Inspection[];
    relationships: Relationship[];
  }>({ datasets: [], relationships: [] });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [leftColumn, setLeftColumn] = useState(""),
    [rightColumn, setRightColumn] = useState("");
  const [cardinality, setCardinality] =
    useState<Relationship["cardinality"]>("many-to-one");
  const [plan, setPlan] = useState(""),
    [result, setResult] = useState<AnalysisResult | null>(null);
  const load = useCallback(
    async () => setData(await request(assistantId)),
    [assistantId],
  );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load, revision]);
  async function run(body: object) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await request(assistantId, body);
      await load();
      return value;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  if (!data.datasets.length && !error) return null;
  const l = data.datasets.find((d) => d.id === left),
    r = data.datasets.find((d) => d.id === right);
  return (
    <section
      className="structured-knowledge"
      aria-label="Structured Data Analysis"
    >
      <h3>Structured Data Analysis</h3>
      <p className="muted small">
        Local XLSX and CSV analysis. Review each worksheet, confirm mappings,
        then ask analytical questions in Chat. No Docker or Python needed.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data.datasets.map((d) => (
        <DatasetCard
          key={d.id}
          dataset={d}
          busy={busy}
          save={(mapping) => {
            void run({ action: "mapping", id: d.id, value: mapping });
          }}
          remove={() => {
            if (
              window.confirm(
                "Remove this derived dataset and its relationships? The original file is kept.",
              )
            )
              void run({ action: "deleteDataset", id: d.id });
          }}
        />
      ))}
      <details>
        <summary>Relationships ({data.relationships.length})</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const saved = await run({
              action: "relationship",
              value: {
                leftDataset: left,
                leftColumn,
                rightDataset: right,
                rightColumn,
                cardinality,
              },
            });
            if (saved)
              setNotice(
                `Relationship saved. ${saved.unmatchedLeftRows} left rows have missing or unmatched keys.`,
              );
          }}
        >
          <label>
            Left dataset
            <select
              required
              value={left}
              onChange={(e) => {
                setLeft(e.target.value);
                setLeftColumn("");
              }}
            >
              <option value="">Choose…</option>
              {data.datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.mapping.name} · {d.filename}
                </option>
              ))}
            </select>
          </label>
          <label>
            Left key
            <select
              required
              value={leftColumn}
              onChange={(e) => setLeftColumn(e.target.value)}
            >
              <option value="">Choose…</option>
              {l?.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            Right dataset
            <select
              required
              value={right}
              onChange={(e) => {
                setRight(e.target.value);
                setRightColumn("");
              }}
            >
              <option value="">Choose…</option>
              {data.datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.mapping.name} · {d.filename}
                </option>
              ))}
            </select>
          </label>
          <label>
            Right key
            <select
              required
              value={rightColumn}
              onChange={(e) => setRightColumn(e.target.value)}
            >
              <option value="">Choose…</option>
              {r?.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            Expected key cardinality
            <select
              value={cardinality}
              onChange={(e) =>
                setCardinality(e.target.value as Relationship["cardinality"])
              }
            >
              {["one-to-one", "many-to-one", "one-to-many", "many-to-many"].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </select>
          </label>
          <p className="muted small">
            Verify that these identifiers represent the same entities.
            Many-to-many joins can multiply quantities; aggregate deliberately.
          </p>
          <button disabled={busy} className="button">
            Confirm relationship
          </button>
        </form>
        {data.relationships.map((rel) => (
          <div key={rel.id}>
            <p>
              {
                data.datasets.find((d) => d.id === rel.leftDataset)?.mapping
                  .name
              }
              .{rel.leftColumn} →{" "}
              {
                data.datasets.find((d) => d.id === rel.rightDataset)?.mapping
                  .name
              }
              .{rel.rightColumn} ({rel.cardinality})
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run({ action: "deleteRelationship", id: rel.id })
              }
            >
              Remove relationship
            </button>
          </div>
        ))}
      </details>
      <details>
        <summary>Query editor and downloadable results</summary>
        <p>
          Use Chat for natural-language planning, or execute a validated JSON
          plan here without an AI model. No SQL or code is accepted.
        </p>
        <button
          className="button"
          onClick={() => {
            const d = data.datasets[0];
            if (d)
              setPlan(
                JSON.stringify(
                  {
                    stages: [{ id: "data", datasetId: d.id, steps: [] }],
                    output: "data",
                    limit: 20,
                  },
                  null,
                  2,
                ),
              );
          }}
        >
          Load preview query
        </button>
        <label>
          Query plan
          <textarea
            rows={12}
            maxLength={60000}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={busy || !plan}
          onClick={async () => {
            try {
              const value = JSON.parse(plan);
              setResult(await run({ action: "query", value }));
            } catch {
              setError("Enter a valid JSON query plan.");
            }
          }}
        >
          Run read-only query
        </button>
        <details>
          <summary>Dataset and relationship identifiers</summary>
          <pre>
            {JSON.stringify(
              {
                datasets: data.datasets.map((d) => ({
                  id: d.id,
                  name: d.mapping.name,
                  columns: d.columns.map((c) => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                  })),
                })),
                relationships: data.relationships,
              },
              null,
              2,
            )}
          </pre>
        </details>
        {result && (
          <>
            <p>
              {result.totalRows} result rows
              {result.truncated ? " (preview truncated)" : ""}
            </p>
            <div className="structured-scroll">
              <table>
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.id}>{c.id}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {result.columns.map((c) => (
                        <td key={c.id}>{String(row[c.id] ?? "∅")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="button"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(result, null, 2)], {
                    type: "application/json",
                  }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "structured-analysis.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download result and evidence
            </button>
            <pre>{JSON.stringify(result.warnings, null, 2)}</pre>
          </>
        )}
      </details>
    </section>
  );
}
