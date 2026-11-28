# RC7 Unified Execution Trace / Append-only Event Store — implementation contract

**Status:** RC7 foundation, not yet end-to-end runtime wired. Source: maintainer decisions of 2026-11-23. This document overrides the earlier RC7 contract's assumption that Skills are merely Actions. **No RC7 publication is authorized** by this foundation.

## Scope and ownership

One local physical SQLite event store per SIAAS profile, logically isolated by project, assistant, session and trace. A project view aggregates its authorized assistants' events; an assistant view displays only its own. Never copy every assistant event into a separate project event log. Project-level orchestration events may have `assistant_id=NULL`. The same `session_id` can group the project run and delegated steps. Use parent/child `trace_id` relationships for correlation. Bind context to the current project and validate membership and tenant ownership on all writes and reads.

The existing `executeAssistantTask()` remains the *single* execution path for direct chat and project-delegated chat; each assistant retains its Hybrid Router, own model, Knowledge, tool scopes and permissions. The Event Store is **not** a router, second executor or new model.

## Foundation implemented in this PR

- `src/lib/local/execution-events.ts` supplies a small SQLite append-only repository with an immutable-update trigger, transactionally ordered events, scoped project and assistant reads, a project-owned session read, a fixed event taxonomy and a bounded metadata whitelist.
- `tests/execution-events.test.ts` covers same-project multi-assistant traces, wrong-project access, metadata rejection, update refusal, retention on database restart and cascade deletion.
- The table is additive and lazy-initialized. Current RC5 `conversations`, `messages`, `project_runs` and `telemetry.sqlite` remain unchanged. This avoids a premature breaking migration but **does not satisfy full lifecycle instrumentation**.

## RC7 Work integration still required

1. Add reviewed, explicit migration/version ownership to `LocalDatabase`; validate existing RC4→RC5→RC6 user data and fresh installs. Keep events in the existing `siaas.sqlite`; do not create a second event database.
2. Wire structured events into the shared assistant executor, direct chat routes and project runs. Generate stable session/trace IDs that survive polling/restart and correlate assistant delegation with the project run; do not create duplicate events across layers.
3. Record routing, permission checks (including Allow/Ask/Deny), tool lifecycle, model usage/latencies, handoffs, completion, failure/cancellation, and any safe media/MCP outcomes. **No raw prompts, responses, documents, credentials, tool arguments or arbitrary paths in trace metadata**. Preserve existing inference telemetry and link to trace IDs rather than counting calls twice. Add proper redaction and event schemas.
4. Add authenticated, permission-checked read APIs and simple project/assistant trace UI; paginate and benchmark indexed queries. A viewer must not gain another project/assistant's source text or hidden event data. Project owners can audit project-wide results; assistant views remain restricted.
5. Ensure append failures do not result in silent false audit success for permission checks or writes. Distinguish noncritical timing metrics from security-critical authorization evidence. Bound event rates and storage growth; never event-log each streamed token delta.
6. Preserve export/import boundaries: project templates, Skills and Actions never include traces, sessions or runtime data. Project/assistant deletion and retention must be verifiable, including foreign-key cascade; user-owned backup/restore must preserve persistent records.
7. Run executed unit, typecheck, API/UI/E2E, packaging and migration tests plus CPU-only overhead benchmarks, with PASS/FAIL/BLOCKED/NOT RUN per exact commit. Simulated tests are not real Ollama/native acceptance.

## RC8 follow-up — no scope creep into RC7

Compaction creates *new snapshots* or derived summaries without modifying/deleting source events. Recall performs scoped, bounded search/retrieval, initially local lexical FTS where practical; project-shared recall is strictly opt-in and cannot bypass assistant permissions. Advanced crash recovery needs checkpoints, leases, idempotency, confirmation before re-running writes and model-free recovery where safe. Retention/deletion is distinct from compaction. Track in the separate RC8 Draft PR with dependency on RC7 final integrated API/schema.

## Acceptance scenarios

- Create Projects A/B/C, assistants A1/A2/B1/C1. Generate direct, deterministic, project-run, MCP and media events. A project viewer sees exactly its project; A1 assistant view sees only its own.
- Project run A1→A2 emits one set of delegated events tied to one parent run, all persisted across restart. No cross-project replay, no privilege transfer through a trace.
- Concurrent appends maintain unique session sequence, no overwritten immutable event, and cancellation has a terminal event. Deleting a project removes only its own trace history, not files linked elsewhere.
- Captured telemetry includes enough non-sensitive evidence to debug and benchmark with minimal measurable overhead and no LLM call to register events.
