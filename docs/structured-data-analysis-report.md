# Structured Data Analysis — implementation and verification report

Verification date: 24 October 2026. This report describes implemented code and
executed checks, not a production release or a certification of untested platforms.
The feature is ready for code review; graphical and live-model acceptance gates
remain blocked in this environment. See [the usage and architecture guide](structured-data-analysis.md)
for configuration, limits, examples and troubleshooting.

## 1. Initial audit and integration decisions

The application was inspected on `develop` at
`b31e8b8db6db9aae1a5c75c50fc5d4898bf057bb`; the templates repository was inspected
on `main` at `100cc3f2974c37489bb85add87555c3bb2f63c9e`.
The application uses Next.js/React, Electron with a separate local Node server,
Node SQLite persistence, local Ollama and LangChain tools. Existing Knowledge
supports managed uploads, linked folders, fingerprints, document processing,
local embeddings, lexical/semantic retrieval, citations and cascading deletion.
Its PDF, DOCX, TXT, Markdown and pasted-text handlers are retained.

There was no existing XLSX, XLS, CSV or JSON dataset ingestion. Data Cell was a
prompt shortcut for tables. Existing agent tools searched/read Knowledge and
created Markdown reports. Project/assistant isolation, local request protection,
source installation/update/rollback/uninstall, desktop packaging, template
allowlisting and offline catalog synchronization were reusable integration points.

The template repository uses `templates/*.json`, `listings.json`, a generated
`catalog.json`, and `npm run build` / `npm test` for validation. Its three existing
official templates remain. Application discovery uses a committed generated
snapshot pinned by source commit and hashes; merely adding remote JSON would not
have shipped the templates. Main/develop branch protection was observed. No
protection, GitFlow, Actions, authentication or optional Docker service was changed.

## 2. Implemented architecture and libraries

`src/lib/structured` provides domain-independent parsing orchestration, profiling,
storage, validated query execution, Ollama planning and hybrid chat. Production
and finance guidance lives in templates, not engine branches.

DuckDB's supported Node integration was evaluated against the separate Node/Electron
architecture and native packaging requirements. It was not installed or certified
on Windows/macOS. Existing SQLite plus a bounded TypeScript relational executor
avoids introducing another native binding while meeting the bounded query scope.
This is a deliberate embedded alternative, not a finding that DuckDB is incompatible.

| Library | Version | Purpose |
| --- | --- | --- |
| ExcelJS | 4.4.0 | Multiple XLSX worksheets, literals, dates, formulas and cached values |
| Papa Parse | 5.5.3 | UTF-8 CSV quoting, multiline cells and delimiter detection |
| Yauzl | 3.2.0 | Bounded ZIP preflight, including actual decompressed length checks |
| Decimal.js | 10.6.0 | Deterministic decimal arithmetic, 40 significant digits, half-even rounding |

The parser is a disposable worker with size/cell/ZIP/concurrency/memory/deadline
limits. Original files are never modified. Macros, external workbook links,
embedded objects and unsafe archive paths are rejected. Formula caches are
explicitly potentially stale; unavailable caches never silently become zero.
Mappings require confirmation. Relationships require matching types, confirmed
keys and cardinality checks. Currency/unit partitions prevent silent aggregation
across unlike values; users must identify unrecognized unit columns themselves.

The strict query plan supports filters, sorting, grouping, SUM/COUNT/AVG/MIN/MAX,
calculated columns, month/year grouping, inner/left/anti joins, duplicate detection
and projection. SQL, JavaScript and filesystem paths are not query operations.
Dataset authorization, column lineage, joins, intermediate size, operation count,
deadline and output bounds are checked. Decimal results remain strings through
serialization. Missing records and empty sums remain null with warnings.

Additive SQLite tables preserve existing data/schema version and cascade with
document/assistant deletion. Parsed cells are retained once as derived JSON beside
the original file; this consumes additional bounded disk space. Mapping changes
invalidate relationships. Linked source changes invalidate stale calculations.

## 3. Modified application components

| Component | Result |
| --- | --- |
| Document upload, process API and linked-folder processing | XLSX/CSV imports work without an embedding model; narrative handlers are preserved |
| Local database/path validation | Scoped additive dataset/relationship tables and managed spreadsheet extensions |
| `/api/local/structured` | Inspection, mapping, relationships, typed queries and deletion behind existing local request checks |
| Knowledge UI | Worksheet/dataset counts, types, warnings, previews, raw formula metadata, mapping and relationship controls |
| Query editor | Model-free validated plan execution and downloadable JSON evidence |
| Chat route and `structured/chat.ts` | Local JSON planning, deterministic table/report, bounded AI explanation and narrative Knowledge evidence |
| Local agent tools | `inspect_datasets` and `query_datasets` alongside existing document tools |
| Desktop build | Bundled worker and dependency license notices in standalone output |
| Generated template catalog | Both templates available offline when creating projects |

Ollama receives bounded schema metadata for planning, not complete spreadsheets.
JSON planning is the explicit fallback for models without native tool calling.
Malformed plans, unsupported requests and missing mappings produce limitations
instead of invented computed answers. Exact results precede the labeled AI
explanation; explanation failure preserves the results. Hybrid retrieval uses
existing local semantic/lexical Knowledge. The structured path does not invoke
web research, Docker services or cloud models. Chat history retains results,
source evidence and Markdown reports according to existing retention behavior.

## 4. Official templates and compatibility

**Production Planning** includes seven optional dataset guides: BOM/recipes,
palletization, workforce/lines, inventory, sales orders, purchase orders and sales
history. It directs users to verify keys/units/recipe bases, calculate supported
quantities, identify missing records and combine narrative instructions. It
explicitly excludes optimal scheduling or workforce allocation without a solver.

**Personal Finance** covers transactions, income/expenses, budgets and savings
goals. It requires confirmed signs, dates, currency partitions, completeness and
categorization. It supports deterministic comparisons and duplicate candidates,
without inventing records, conversions, financial guarantees or legal/tax advice.

Both retain `format: siaas-project-v1`, `model: null`, project-level color and
empty knowledge sources. No schema extension or assistant colors were introduced.
Mappings and private records remain local and are excluded by existing template
export allowlisting. Tests verify project/assistant creation, old templates and
privacy. The application snapshot is pinned to templates commit
`7ec5a819be9051242f1b9f94317629f593f1d265`.

## 5. Executed verification

Linux x64, Node 24.22.1, Electron 44.5.1. Fixtures contain synthetic data only.

| Status | Executed check | Result and scope |
| --- | --- | --- |
| PASS | `npm test` | 142 tests, 0 failures, 0 skipped; includes 36 structured tests and existing regression suites |
| PASS | `npm run test:structured` | 36 focused tests, including parser, engine, persistence, templates and mocked local planning |
| PASS | `npm run test:distribution` | 15 tests; source manager staging/update/rollback/failure preservation and Docker prerequisite isolation |
| PASS | `npm run typecheck` | TypeScript validation |
| PASS | Prettier check of new module/UI/parser/tests and `git diff --check` | Formatting/whitespace; repository has no separate lint script |
| PASS | `npm run desktop:build` | Optimized Next production build, type validation, standalone server and parser bundle |
| PASS | `npm run test:structured:api` | Real compiled HTTP routes, SQLite and bundled parser; local Ollama protocol fixture |
| PASS | Same integration test with `SIAAS_TEST_SERVER_ROOT=dist/linux-unpacked/resources/server` and packaged `SIAAS_TEST_NODE` | Full structured API flow executed using the actual packaged server and private Node runtime |
| PASS | `node tests/knowledge-api.mjs` | Existing import, folder refresh/reconnect, indexing, download, isolation/cleanup and Origin protection |
| PASS | Templates `npm run build` and `npm test` | Catalog generation and validation; existing entries retained |
| PASS | `npm run desktop:prepare` | Private Node 24.22.1, server and helper packaging |
| PASS | `electron-builder --config electron-builder.cjs --dir --linux --publish never --config.electronDist=node_modules/electron/dist` | Local unpacked Linux x64 package produced; no publication |
| BLOCKED | Playwright graphical UI | Chromium download returned a truncated/invalid ZIP; no working system Chromium was available |
| BLOCKED | Electron graphical startup | Runtime denied process-singleton `socket()` with `Operation not permitted`; Electron exited before application UI |
| BLOCKED | Real Ollama model accuracy/end-to-end inference | No running local Ollama model in this environment; fixture tests validate contracts, not model reasoning quality |
| BLOCKED | Windows/macOS runtime and installer execution | No actual Windows/macOS test environments available |

No unresolved automated assertion/build failure remains. Initial issues found and
fixed include ExcelJS losing a zero cached value through its `cell.value` API,
bundled template-literal code-fence handling, numeric profile ordering/uniqueness,
join cardinality after transformations, and updated catalog-count expectations.
Failed browser/native-launch attempts above are environmental blockers, not passes.
Local test logs are retained under ignored `test-results/`; no private data/logs
are committed.

### Coverage against the requested scenarios

Numbers refer to the original 60-scenario request; grouped rows do not claim 60
independent test cases. Natural-language interpretation is fixture-tested only.

| Requested cases | Verified coverage |
| --- | --- |
| 1–13 | Single/multi-sheet XLSX, CSV, empty/corrupt inputs, headers, numbers/dates/nulls, formula metadata/zero/missing cache, 10,000-row supported import and resource rejection |
| 14–24 | Filters/sort/group/all aggregates, cross-file joins, missing/duplicate keys, invalid types, decimal arithmetic, limits and unsafe-plan rejection |
| 25–31 | Mock local JSON planning and failure/clarification; semantic coexistence, real chat integration with fixture, missing data, evidence and assistant isolation |
| 32–40 | Production template project creation, mappings, order/stock shortage, BOM/material shortage, anti joins, partial inputs and explicit unsupported-optimization instructions/clarification |
| 41–50 | Finance template project creation, parsing, income/expense totals, monthly groups, budget difference, duplicate candidates, null preservation, currencies and evidence |
| 51–56 | Existing Knowledge/templates/assistant tests, persistence across restart, dataset cascade deletion and template export privacy |
| 57–59 | Linux build/package and Docker-free HTTP startup; source workflow regression tests. Actual graphical launch blocked |
| 60 | Linux server/build/package executed; Windows/macOS execution blocked |

## 6. Distribution, privacy and remaining risks

Source installer entry points, update/rollback/uninstall and development/desktop
scripts remain compatible at the code level. The public PowerShell entry point
is unchanged. No website deployment, installer publication or release was done.
All new runtime dependencies install through npm and require neither Python,
Docker nor a separately managed database. No new Electron native ABI dependency
is introduced. Packaging success does not establish graphical startup on every OS.

Known limits: XLS is unsupported; one rectangular table per worksheet; ISO dates
and explicit types rather than guessed locales; formulas are not recalculated;
currency conversion/optimization solvers are absent; query timeout is cooperative
with bounded synchronous profiling, not process-level preemption. Worker V8 heap
limits do not strictly bound total OS RSS. Evidence lists source inputs/ranges,
hashes and the complete plan, not exact per-result-row lineage. Charts were not
added; tables and downloadable JSON/Markdown reports are implemented.

Model interpretation may still choose a semantically inappropriate but valid plan;
users must inspect evidence for consequential decisions. Live-model quality and
visual accessibility/layout require the blocked acceptance checks above. Changes
are held in draft PRs for review and should not be described as fully certified.

Older versions can open the additive database but cannot process new spreadsheet
document kinds. Roll forward before reprocessing those documents. Deleting source
datasets does not retroactively remove evidence already saved in chat history;
existing conversation retention applies. SQLite/backups are not forensic erasure.

## 7. Git delivery

Application branch: `feature/structured-data-analysis`, PR target `develop`.
Template branch: `feature/structured-analysis-templates`, PR target `main`.
Template commit: `7ec5a819be9051242f1b9f94317629f593f1d265`.
Template draft PR: https://github.com/siaas-software/siaas-templates/pull/1 .
The application commit/PR are recorded in the delivery response and Git history;
this report is itself included in that commit. Both PRs remain unmerged. No
protected-branch commits, GitHub Actions, release publication, deployment or
SIAAS Business changes are part of this work.
