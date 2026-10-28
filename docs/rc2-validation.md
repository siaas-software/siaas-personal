# RC2 engineering checkpoints — historical evidence

> Superseded gate policy: the user authorized the permanent RC policy on
> 2026-10-28 after these checkpoints. Environmental blockers below are now
> post-publication manual acceptance, not mandatory RC publication gates.
> Historical results and limitations are preserved unchanged. See
> [current policy](rc-publication-policy.md) and
> [RC2 readiness](releases/1.1.0-rc.2-readiness.md).

## Original checkpoint — 2026-10-27

RC2 is NOT RELEASED. Stable main and the public website are outside this change.
Base: develop b30bab0a0102c6663eb3b4862c331f6fcc03e2c5. RC1 tag:
188f388b51c26831648311d31ab8c1381a5e02e9, separate release branch.

## Phase 1: verified code defects and corrections

- Routing: `structuredChat` invoked the planner for every message whenever a
  dataset existed. The planner instruction forbade narrative for all numerical
  questions, including standalone arithmetic. High-confidence greetings/arithmetic
  now bypass planning; the planner policy distinguishes general/document-only
  requests from table and mixed requests. RAG and native agent prompts explicitly
  allow general questions without Knowledge. General model behavior still needs
  real inference acceptance, beyond transport tests.
- Catalog: original IDs, names and confirmed mappings were already present.
  Inspection did NOT establish a dataset-ID mismatch or stale confirmed mapping
  as the RC1 cause. Value examples and month-string semantics were absent.
  Authoritative catalog now includes revision, worksheet, profiling, bounded
  local examples and YYYY-MM text format. Month remains text, queried directly;
  it is not silently converted to an invented day.
- Grounding: a model's unrestricted `clarify.message` was emitted verbatim. A
  second free-form model explanation could contradict successful execution.
  Clarification now reports authoritative available fields and no calculation;
  numeric responses come exclusively from deterministic results. Descriptive
  source excerpts are separate, with titles; this does not synthesize a mixed
  prose answer. Single-measure/single-partition output can show `35 EUR` directly.
- Validation: operand columns inside row callbacks could escape validation after
  filtering to zero rows. References are now checked independently of row count.
- Errors: the old generic message hid non-AnalysisError failures. Verification,
  network failure, planning timeout, incomplete response and invalid JSON now
  produce controlled errors. User cancellation propagates across verification,
  planning and ordinary streaming chat. No model output is executed as code.
- Ollama: planning already used `think:false`, JSON schema format and 16,384
  context. These were NOT missing in RC1. Ordinary streaming chat did not set
  `think:false`; it now requests answer content without optional hidden reasoning.
  The planner's existing 60-second timeout is retained; no unsupported CPU timing
  claim or arbitrary increase. Metadata-only telemetry remains text-free.
- RC1 'planner unavailable' exact Windows trigger (timeout, transport, model
  state, etc.) remains UNRESOLVED without its logs/a real model reproduction.
  Likewise missing Month/Currency claims are reproducible with simulated model
  output, but the precise Qwen3 generation has not been reproduced here.
- Existing Chat/Actions API fixture expected only three tools, although RC1 code
  already exposed five. Fixtures now expect the two structured tools as well.

## Executed validation (Phase 1)

| Check | Result | Evidence / scope |
| --- | --- | --- |
| `npm run typecheck` | PASS | TypeScript check, no diagnostics |
| `npm test` | PASS | 154 tests, 0 failures; includes 8 new RC2 cases |
| `npm run desktop:build` | PASS | Next standalone server and parser bundle |
| `node tests/structured-api.mjs` | PASS | Real HTTP/SQLite/parser; Ollama simulated |
| `node tests/knowledge-api.mjs` | PASS | Import/index/download/link lifecycle; embeddings simulated |
| `node tests/actions-api.mjs` | PASS | CRUD/restart, instructions, tampering and isolation; Ollama simulated |
| `node tests/chat-api.mjs` | PASS | Chat/RAG/tools/report persistence; Ollama simulated |
| `node --import tsx tests/real-structured-api.mjs` | BLOCKED | ECONNREFUSED 127.0.0.1:11434; no installed Ollama runtime |
| Native Windows packaging/icon/launch | NOT RUN | Linux environment; Phase 3 pending |
| Graphical acceptance | NOT RUN | Phase 3 pending |
| Zero-configuration import | NOT RUN | Phase 2 pending |

`tests/fixtures/rc2/budgets.csv` reproduces the user data exactly. The three Italian
analytical questions are tested through a simulated planner followed by real
SQLite, query validation, exact calculation and rendering. This establishes a
correct engine/transport path, NOT real model intent recognition. Timeout is
simulated, not a timed CPU benchmark. Existing tests cover aggregation, date
grouping, joins, missing values, duplicates, currency partitions, persistence,
assistant isolation, templates and document retrieval.

## Release gates

Do not publish RC2 from this checkpoint. Complete and integrate zero-configuration
import and UI/branding work, then pass release gates including real local model
acceptance and Windows packaged-icon acceptance. Do not substitute mocks, a Linux
build, or the previous RC1 Windows launch for those checks.

## Italiano

RC2 non è pubblicata. Le correzioni della fase 1 riguardano instradamento,
catalogo con esempi locali e formato mensile, validazione anche su risultati
vuoti, errori distinguibili e risposte numeriche basate soltanto sul motore.
I test automatici e le API passano con Ollama simulato; il modello reale è
bloccato da ECONNREFUSED sulla porta locale 11434. La causa esatta dell'errore
Windows «planner unavailable» non è stata riprodotta. Non viene dichiarata una
validazione reale Qwen3. Importazione automatica e verifiche grafiche/native
restano da completare prima della pubblicazione. Main e sito pubblico invariati.

## Phase 2: automatic import (2026-10-27)

Phase 1 merged via PR #7 at 0ea75ff9ae28acf53ab3f65b3a6b139ebaf74de8.

Ordinary CSV/XLSX worksheets now become confirmed/ready automatically when headers,
types and common currency/unit partitions are unambiguous. Metadata and worksheet
identity are persisted locally. Original bytes remain unchanged. A title/preamble
can precede the detected full header. Missing cells and duplicates remain visible.

Focused clarification handles uncertain headers, slash dates (DMY/MDY), mixed or
locale-formatted values and saved formula results. Invalid dates and missing
formula caches cannot be accepted as valid results. Numeric locale ambiguity can
be retained as text or corrected in the source/Advanced Settings; no universal
locale-number conversion is claimed. Formula values are inferred only after
explicit cache consent. Multiple currencies are safe partition dimensions, not
silently converted or summed together.

The normal Knowledge view shows filenames, readiness, counts, warnings and a
preview. All former technical controls remain under collapsed Advanced Settings.
Optional candidate relationships compare column labels/types, overlap and observed
uniqueness, but require confirmation of business meaning before execution. They
are suggestions, not automatically authorized joins. Many-to-many remains advanced.

Validation:
- PASS: typecheck; desktop standalone/parser build.
- PASS: full unit suite 160/160, followed by focused import suite 7/7 after adding
  the official workbook regression (161 distinct tests in the combined suite).
- PASS: standalone structured API with zero-config ordinary CSV/XLSX, currency
  partition enforcement, persisted results and simulated Ollama.
- PASS: official sample inventory shortages A=2/B=-4; BOM requirement M1=25 and
  material shortage=5 with operations.xlsx evidence. Finance EUR income=100,
  EUR expenses=30, USD expenses=4, separate. Budget=35 EUR through real engine
  with simulated planning and no mapping call.
- PASS: focused date clarification and SQLite reopen; model-free multi-sheet
  import; formulas missing/present; suggested relationship confirmation.
- BLOCKED: actual graphical browser acceptance. Bundled and primary runtime
  Chromium downloads were invalid ZIPs; no executable installed. apt bootstrap
  failed on setgroups/setegid/seteuid restrictions. No screenshot is claimed.
- BLOCKED: real Ollama as in Phase 1. Windows/macOS native checks remain NOT RUN.

Advanced settings are kept, not deleted. The user-facing guide is updated in
English plus docs/zero-config-import-it.md. No public website files are changed.

## Phase 3 checkpoint (2026-10-28)

Phase 2 merged via PR #8 at f4555102f3da3057700d19cddc6e19a78ac897aa.
UI/branding changes are on `feature/rc2-ui-branding`; native/graphical acceptance
is blocked, so they must not be represented as an accepted release.

The annotated RC1 screenshot was inspected. Scoped white backgrounds cover the
Knowledge/chat/shortcut panels, footer and assistant icon containers. Existing
project palette resolution and semantic green controls are unchanged. Generation
uses #e5e7eb with full opacity despite the disabled send button, retaining the
original mascot SVG, alternating stars, dimensions and reduced-motion CSS.
No new cancel control is claimed; existing transport cancellation remains covered
by the Phase 1 suite. Actual generation/cancellation UI acceptance is pending.

The checked-in original `src/app/icon.svg` (hand and green stars) is the only
source artwork. The old S PNG/ICO are replaced and ICNS added. Reproducible conversion
and SHA-256 provenance are checked in. Electron window/taskbar identity, macOS dock,
platform packaging icons and packaged branding resources are connected. The new
read-only `icons:verify-windows` command inspects all PE icon groups of a supplied
packaged executable; it has NOT been run on a Windows build here.

| Executed check | Status | Scope |
| --- | --- | --- |
| `npm test` | PASS | 165/165, including 3 artwork and 1 Windows identity unit tests |
| `npm run typecheck` | PASS | No diagnostics |
| `npm run icons:check` | PASS | Original SVG → exact PNG/ICO/ICNS bytes and hashes |
| `npm run desktop:build` | PASS | Next standalone + parser bundle |
| `npm run desktop:prepare` | PASS | Private Linux Node 24.22.1 and resources prepared |
| electron-builder `--linux --dir --publish never` | PASS | Linux x64 unpacked application; not a release asset |
| Prepared + packaged branding byte comparison | PASS | All four branding files equal checked-in originals |
| `npm run test:distribution` | PASS | 16/16; simulated release/runtime/update/rollback fixtures |
| Structured API | PASS | HTTP/SQLite/import/evidence; simulated Ollama |
| Knowledge API | PASS | Local import/index/download/link lifecycle; simulated embeddings |
| Actions API | PASS | Persistence/scope/instructions; simulated Ollama |
| Chat API | PASS | Ordinary chat/RAG/tools/history; simulated Ollama |
| Real Ollama | BLOCKED | `ECONNREFUSED 127.0.0.1:11434` |
| Playwright visual assertions | BLOCKED | Chromium executable missing; download retries return invalid ZIP archives |
| Linux packaged launch | BLOCKED | Electron fatal `socket() failed: Operation not permitted (1)` before window |
| Windows package, PE icon, taskbar and install/update/rollback | BLOCKED | No Windows runtime/host available |
| macOS package/dock/launch | NOT RUN | No macOS host available |
| RC2 tag, manifest/assets, anonymous download verification | NOT RUN | Publication withheld because critical gates remain blocked |

Logs are preserved in `docs/evidence/rc2-phase3/`. They use synthetic fixtures;
no private document or annotated user screenshot is committed. The initial suite
failed two identity test fixtures because their VM omitted `process`; the fixture
now supplies an explicit platform and checks Windows AppUserModelID, without
relaxing profile isolation assertions. The final suite passes all 165 tests.

No actual application screenshot or Windows executable acceptance is claimed.
Prepared Playwright checks cover three palettes, switching projects, white panels,
hidden advanced controls, semantic controls, idle/generating/disabled states, full
mascot bounds and reduced motion. These checks remain unexecuted past browser launch.
The exact RC1 planner-unavailable trigger remains unresolved on real Qwen3 CPU.

### Italiano: stato e vincoli

Implementati i pannelli bianchi e il pulsante grigio durante la generazione,
conservando palette del progetto e mascotte originale. Rigenerate le icone dai
vettori ufficiali e collegate a finestra e pacchetto Electron. Passano 165 test,
controlli TypeScript, build, preparazione e packaging Linux e regressioni API.
I test API usano Ollama simulato. L'avvio grafico Linux è bloccato da un divieto sui
socket; Chromium non è installabile dagli archivi ricevuti; Ollama reale e Windows
non sono disponibili. Le verifiche visive e dell'eseguibile Windows NON sono PASS.
RC2 non va pubblicata finché questi gate non passano. Nessun tag RC2, manifest RC2
o asset pubblico è stato creato; nessuna modifica a main, release stabile o sito.
La checklist dedicata è `docs/windows-rc2-testing.md`.
