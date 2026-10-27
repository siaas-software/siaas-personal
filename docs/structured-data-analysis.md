# Structured Data Analysis

Structured Data Analysis uses local SQLite persistence and a bounded TypeScript
analytical execution engine. ExcelJS reads XLSX workbooks, Papa Parse handles CSV,
and Decimal.js performs decimal arithmetic. No Docker, Python or database server
is required. Numerical results are computed from authorized assistant datasets.

## Import, safety and limits

Use Project → Assistant → Knowledge → Import files. XLSX/CSV processing does not
require an AI model or embedding service. Linked folders also support these
formats. Each worksheet is a dataset; empty worksheets remain inspectable when
other sheets contain data. Legacy XLS is not supported. JSON template import is
unchanged; JSON is not a dataset format. One rectangular table per worksheet is
supported; split unrelated tables or subtotals into separate sheets first.

The parser runs in a disposable worker: 20-second deadline, 192 MB old-generation
and 32 MB young-generation V8 limits, at most two concurrent imports. V8 limits
are not a guarantee on total OS RSS; file, ZIP and cell limits additionally bound
external buffers. Limits are 10 MB upload, 32 MB expanded ZIP, 2,000 ZIP entries,
20 sheets, 50,000 rows/sheet, 128 columns, 250,000 cells/workbook and 8,000 characters
per cell. An assistant may retain at most one million imported cells and 32 MB of derived JSON. Files that
exceed a limit fail without truncated calculations. Import errors appear on the
Knowledge document row. Encrypted workbooks, macros, embedded objects, ActiveX
and external workbook links are rejected. Hyperlink labels are read without
following links. XML/formulas/scripts are not executed. Original bytes are never
modified. Existing path validation and local Origin/desktop-key checks remain.

## Mapping and profiling

Upload a file and ask a question in Chat. Ordinary rectangular XLSX/CSV tables
are prepared automatically: sheet discovery, header and type detection, common
currency/unit partitions, profiling and local persistence. Knowledge shows the
filename, readiness, dataset/row/column counts, warnings and a concise preview.
No mapping confirmation is required for high-confidence files.

When interpretation is unsafe, answer the focused question: choose a header row,
choose day/month or month/day order, keep mixed values as text, or explicitly
accept saved formula results. Missing formula results and Excel errors require
correcting the source. A ready file can still contain missing values or duplicate
records; these remain visible and are not silently replaced or removed.

**Advanced Settings** retains dataset naming, headers, column types, partitions,
relationships, cardinality, raw/formula metadata, the deterministic Query editor,
JSON inspection and result/evidence downloads. Original filename, worksheet,
source rows and SHA-256 are preserved. IDs stay stable for an unchanged worksheet
within the same imported document, including a refresh; relationships are
invalidated when source data changes.

Supported types: text, number, ISO date (`YYYY-MM-DD`) and boolean. Keep codes
with leading zeros as text. Ambiguous locale numbers are not silently converted; correct the source or keep
them as text. Slash/dash dates with a four-digit year can be interpreted after
choosing DMY or MDY; impossible dates are rejected. YYYY-MM remains a monthly text
dimension and is filtered/grouped directly. Numeric strings retain decimal
precision. Excel numeric cells already have the workbook's binary precision.
Currency/unit fields must be marked as partitions; common currency/unit header
names are detected and cannot be silently unmarked. Other unit columns require
user mapping. This does not invent conversion rates or unit semantics.

Literal values, formula expressions, cached values and error cells are separate.
Formula caches are always potentially stale. Querying a dataset with formulas
requires explicitly accepting available cached values. A missing cached result
blocks analytical queries even after acceptance. Unsupported formulas are never
recalculated. Recalculate in the spreadsheet application and reimport if needed.
Excel error cells and invalid typed data block calculation. Missing cells remain
null, not zero; aggregation reports exclusions and returns null for an empty sum.

## Relationships and queries

Ready datasets with matching labels/types and overlapping key values can offer
optional relationship suggestions. Confirm their business meaning before joining;
matching labels alone do not authorize a join. Advanced Settings also permits a
directed relationship with dataset IDs, column keys and expected cardinality. Types must match; declared unique
sides are validated. Missing/unmatched left keys are reported. Many-to-many joins
require explicit selection and can multiply records; aggregate at the intended
grain. Changing any mapping deletes its relationships for review. Source changes
refresh derived datasets, rerun automatic interpretation and invalidate saved
relationships; ambiguous interpretations require clarification. Every query rechecks linked files for changes/unavailability.

Plans contain up to six stages; each starts from an authorized dataset and has
at most twelve steps. Operations: filter (`eq`, `ne`, comparisons, contains,
null checks), sort, group, SUM/COUNT/AVG/MIN/MAX, arithmetic add/subtract/multiply/
divide/abs/ceil/coalesce, month/year derivation, inner/left/anti joins, duplicate
record detection and projection. Joins reference earlier stages and saved
relationships. Right-side columns become `stageId.columnId`. Grouping preserves
only group keys and aggregate aliases. No arbitrary expression strings, SQL,
filesystem paths or code are accepted. Null join keys do not match. Partition
columns cannot be dropped or collapsed, and incompatible joined partitions fail.

Execution has a three-second cooperative deadline, two-million-operation budget,
50,000 intermediate rows, 256 columns, one-million combined stage cells, 200 returned
rows and a 64 KB result envelope. Bounded synchronous profiling precedes the
operation checks; this is not a hard process-level query timeout. The import
worker has a hard termination deadline. Use smaller files for constrained PCs.
Result truncation applies only after complete calculations and is explicit.

The Query editor works without Ollama. Start with **Load preview query**, or use:

```json
{"stages":[{"id":"orders","datasetId":"<dataset UUID>","steps":[
  {"op":"group","by":["c1"],"aggregates":[{"as":"quantity","fn":"sum","column":"c2"}]}
]}],"output":"orders","limit":100}
```

Replace IDs using the catalog shown in the editor. Add currency/unit columns to
`by` where relevant. Download JSON with results, plan, warnings, file hashes and
input row ranges. Chat provides a rendered table and downloadable Markdown report.
Input ranges are labeled as input coverage, not fabricated per-output lineage.

## Ollama, tools and hybrid Knowledge

General greetings and standalone arithmetic bypass structured planning. For other
requests when datasets exist, Chat asks the selected **local** Ollama model for a
schema-constrained JSON plan using only bounded schemas, not entire spreadsheets.
The model may request clarification or identify a narrative question. Validated
query plans execute deterministically; errors are displayed without substituting
model-generated totals. JSON planning is the explicit fallback for models without
native tool calling. Invalid/unsupported model output reports the limitation and
points to the model-free editor. Planner quality varies by model; validate the
shown plan and evidence for high-impact decisions. The server cannot prove a
model's interpretation matches the user's intended business semantics.

Native agents also have `inspect_datasets` and `query_datasets` scoped tools.
After successful execution, answers contain the deterministic table, readable
column labels, exact values and source/operation evidence. A single measure and
currency can be shown as `35 EUR`. Related document excerpts are supplied separately;
there is no unconstrained second model explanation that can contradict the table.
General conversation and document-only requests use the existing chat/RAG flow.
Invalid model plans cannot generate fallback totals.

## Official templates

Both templates are shipped in the generated offline catalog pinned to the
reviewed templates catalog. They remain `siaas-project-v1`, use only
project colors, `model:null`, and no local/remote knowledge sources. No schema
extension was needed: guidance lives in assistant instructions; actual private
mappings stay in the local database. Existing templates continue to import/export.

**Production Planning:** seven optional dataset guides (BOM/recipes,
palletization, workforce/lines, inventory, sales orders, purchase orders, sales
history). Example workflow: confirm product/material codes and units; aggregate
orders by product; compare with stock; join BOM demand to orders using a confirmed
recipe basis; aggregate material requirements; compare material inventory and
report positive shortages separately from missing records. Ask "Which product
codes are missing from the BOM?" for an anti join. Carton/pallet estimates use
verified capacity and explicit rounding. No scheduling/workforce optimizer exists.

**Personal Finance:** transactions, income/expenses, monthly budgets and savings
goals. Confirm amount signs, account scope, completeness, periods and currencies.
Ask "Group expenses by category, month and currency"; compare separately grouped
actuals and budgets; inspect duplicate candidates without deleting them. Do not
sum EUR with USD, treat absent transactions as zero, assert uncertain categories,
or provide investment/tax/legal guarantees. Recurrence is a candidate pattern,
not an automated subscription detection or forecasting feature.

## Persistence, installation and rollback

`structured_datasets` and `structured_relationships` are additive SQLite tables
with assistant/document foreign keys. Parsed cells are stored once as derived
JSON beside the original managed copy (or linked original); no second workbook
copy or external database is created. Large workbooks require extra local space
for the derived representation. Delete a dataset to remove it and relationships;
delete a document/assistant/project to cascade derived records with the existing
retention behavior. Previously generated chat/report evidence follows conversation
retention and is not erased when its source is removed. SQLite deletion is logical,
not forensic erasure of WAL/backups. Existing backup and user data rules apply.

The primary schema version is unchanged. Older application rollback can still
open the database; it cannot interpret spreadsheet documents or these derived
tables. Reinstall/update to this feature to inspect them. Do not attempt to reindex
new-format documents using an old application. Existing documents are unaffected.

`npm ci`, development startup, desktop build/start, source installers, update,
rollback and uninstall retain their existing entry points. The desktop build
bundles the parser worker and its JavaScript dependencies with esbuild beside the
standalone server. No Electron ABI rebuild is introduced. The Windows entry point
remains `irm https://siaas.vercel.app/install.ps1 | iex`; the installer verifies source and runtime checksums before installation.

## Troubleshooting

- Import too large/timeout: split sheets/files; reduce long formatted empty ranges.
- No dataset: inspect document errors; XLSX/CSV must be processed after upload.
- Invalid number/date: select the correct type or normalize source values. Locale
  conversions are intentionally not guessed.
- Formula unavailable: recalculate and save externally, then reimport and review.
- Relationship rejected: inspect key types, missing values and declared uniqueness.
- Query blocked: confirm mappings, use correct column IDs, preserve partition keys,
  or simplify the supported plan. Never work around the error with AI estimates.
- Model cannot plan: choose another installed local model or use the query editor.
- Linked file changed: refresh the folder and confirm fresh mappings/relationships.
- Build worker error: run `npm ci` and `npm run desktop:build`; do not copy only the
  server file without its bundled `scripts/structured-parser.cjs`.
