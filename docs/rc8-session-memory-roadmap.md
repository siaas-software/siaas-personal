# RC8 — Session compaction, historical recall and safe execution recovery

**Status: TRACKING SPECIFICATION ONLY. NOT IMPLEMENTED.** Decision date: 2026-11-23. This Draft PR is intentionally **stacked on RC7 #45** and must remain open/unmerged until RC7 is fully validated, integrated and published. Do not treat the presence of this document as shipped behavior.

## Dependency and invariant

- RC7 creates **one** local append-only Event Store in the existing SIAAS SQLite profile. Every event has a project/assistant scope plus session/trace IDs and parent correlation. RC7 owns runtime event instrumentation, secure retrieval APIs, migration, deletion and audit requirements (see `docs/rc7-unified-execution-trace.md`).
- RC8 **does not create** a second execution engine, router, global memory service or new cloud dependency. The existing assistant-scoped Hybrid Router, authorized source scopes, Tool Permission Gateway and optional project orchestration remain unchanged.
- Project history is an **authorized aggregate view**, not a common prompt/memory pool. An assistant receives its own history by default. Project-level sharing requires explicit, revocable consent and evidence. Cross-project memory is OFF and out of scope.

## Workstream 1 — Compaction

Implement bounded snapshots/summaries of previously recorded session state without modifying or deleting source events. Store versioned derived checkpoints with stable `source_sequence_start/end`, input hash/source trace IDs, creation time, algorithm/model identity, provenance and failure/incomplete flags. Model-free deterministic compaction preferred where possible; local Ollama summarization only when enabled and justified. Avoid recursive summaries amplifying errors; verify consistency, truncation and source references. Session context includes recent raw events plus reviewed snapshots, subject to token and data-boundary budgets.

Acceptance: immutable source event count/identities; replay from source matches snapshot metadata, rolling compaction over long sessions, cancellation, restart, invalid/missing model and stale checkpoint invalidation.

## Workstream 2 — Recall

Bounded local search over current assistant's authorized historical events and approved snapshots, initially SQLite FTS/lexical search if appropriate. Filter by project/assistant ownership and consent **before** retrieval/ranking/context injection. Do not index private raw tool arguments, source document contents, passwords, tokens or hidden paths. Report provenance, timestamps, source trace/session and uncertainty. Project-level memory sharing must use an explicit allowlist/consent with revocation; no automatic promotion of assistant-only data into project-shared recall.

Acceptance: A1 cannot query A2, B1 or C1 data unless explicitly authorized by a separately reviewed project sharing contract; source revocation invalidates retrieval; truncated/missing results are signaled; offline works without Ollama when lexical recall applies.

## Workstream 3 — Durable sessions and recovery

Add explicit session lifecycle and snapshots with versioned migration and transactional checkpoints. On restart reconcile incomplete runs, prior tool outcomes and leases; classify each operation as read-only/idempotent/requiring inspection/non-replayable. Never automatically rerun non-idempotent writes, file mutations, downloads or external MCP commands based merely on an incomplete trace. Require fresh permission checks and user confirmation for risky replays, enforce cancellation and compensation/rollback when supported.

Acceptance: crash before/after tool commit, duplicate invocation attempt, interrupted file write, revoked permission after checkpoint, source removed, resource race, corrupted snapshot, multi-assistant handoff. Correct output state must be confirmed independently.

## Workstream 4 — UX, lifecycle and observability

Provide assistant session history with clear "original events" vs "summary" provenance, opt-in project-level shared memory, controls for retention/deletion and backups. Compaction is **not deletion**. Policy-driven cleanup must respect the user's project deletion, linked-source boundaries and persistent SQLite consistency. Keep performance overhead bounded and provide project/assistant benchmarks; no new mandatory database/server, cloud model or Docker requirement.

## Execution sequence: SIAAS-FLOW-01

A/B: this dependent Draft PR tracks approved scope and non-goals. C: Work implements RC8 **after RC7 is done** on this PR or reviewed child branches, with tests/evidence. D: ChatGPT independently reviews current diff/actual logs. E/F: release only after normal GitFlow/test/release authorization and Personal Vault gates. Do not merge this document-only RC8 branch into RC7 prematurely or include RC8 in the RC7 release.

Required future evidence: tests for compaction immutability, recall privacy, retention/migration, crash consistency, idempotency, real Windows/Ollama behavior, CPU overhead, plus full modified-commit unit/typecheck/API/UI/desktop/installer/distribution matrix. Every gate reports PASS, FAIL, BLOCKED or NOT RUN with exact commit and logs.
