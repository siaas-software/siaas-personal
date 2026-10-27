# RC2 engineering checkpoint — 2026-10-27

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
