# RC5 — Project chat and shared assistant execution (integration candidate)

**Status: Draft, UNVERIFIED.** This code introduces a functioning application path in source, but has not passed npm/TypeScript, Electron, UI, real Ollama or Windows acceptance. Never describe it as released or proven operational.

## Consolidated architecture

Project (N existing assistants)
→ optional project-chat orchestration
→ selected assistant (configured instructions/model/resources)
→ **the assistant's own shared execution service and Hybrid Router**
→ deterministic application operations, Ollama or hybrid retrieval
→ scoped result/artifact
→ project-run history and final response.

There is no second Hybrid Router on the project.

Direct chat and project delegation both call `executeAssistantTask()`. It is the same service that chooses the native Action, deterministic local intent, structured data planner, agent tools or regular Ollama completion. Each selected assistant retains its selected documents/folders/URLs, existing restrictions and its own chat.

Assistant conversations and project orchestration runs are stored separately. A project run does not write fake user/assistant turns into an individual assistant's history.

## User-visible behavior

- A **Chat del progetto** panel on the existing project page contains history, final result, step traces, error states and optional project orchestration settings.
- Orchestration defaults to **disabled** on existing and new projects.
- Users explicitly select the assistants, choose their order (selection order), set a step budget (up to eight), specify optional coordinator preferences and may opt in to result sharing.
- The first operational strategy is **bounded sequential execution**, with all selected assistants invoked in their chosen order. It is **not** autonomous LLM planning, model-driven assistant selection or a promise of parallel execution.
- Each step receives the original task and, ONLY when `share_results: true`, bounded previous-step text. The receiver must revalidate any document references against its own resources.
- Project coordinator preferences are appended to MODEL requests only, never allowed to disable deterministic routing or grant new tools.
- Runtime traces and report Markdown artifacts are preserved in project-run SQLite records. A project-only authenticated download endpoint provides Markdown reports; no arbitrary file access.
- A failed step aborts the workflow and returns a failure, not a fabricated final result. Project runs have a bounded timeout, and stale running records can be marked interrupted after their lease expires.
- The project chat is an additional entry point. The existing assistant chat remains unchanged.

## Files

- `src/lib/local/assistant-execution.ts`: shared execution service used by both paths (native Actions, local deterministic calculations/search, structured Chat, agent tool calling and standard Ollama).
- `src/app/api/chat/route.ts`: direct-chat adapter preserving conversation lease, streaming NDJSON, metrics, message history, sources and artifacts while calling the shared service.
- `src/lib/local/database.ts`: additive `project_runs` table, local SQLite schema version 5 (previous version 4), project FK cascade and isolated metadata.
- `src/app/api/projects/[id]/runs/route.ts`: project chat GET/POST with authorization, sequential orchestrator, current membership checks, bounded execution, persistent history and recovery.
- `src/app/api/projects/[id]/runs/[runId]/artifacts/[artifactId]/route.ts`: scoped Markdown artifact download.
- `src/components/project-chat.tsx`: existing project-page chat, configuration and timeline.
- `src/components/workspace.tsx`: project panel integration.
- `src/lib/project-orchestration.ts`, `src/lib/catalog.ts`, project settings PATCH and preflight route: contract carried from foundation PR #39.
- `tests/project-chat-integration.test.ts`: deterministic direct/delegated parity, native scoped Action, SQLite project history/cascade. Additional API/GUI tests still required.

## Safety, limitations and design boundaries

- **PR #39 is duplicated in this integration branch deliberately.** Once this stacked PR is validated, do not merge the same foundational code twice; treat #39 as superseded/absorbed by this branch or reconcile commits accordingly.
- This integration branch starts from the head of **PR #40** (native built-in Actions), which starts from #35 and #34. The independent #37 and #38 still require deliberate reconciliation. The RC5 release candidate #36 must be refreshed LAST.
- **PDF generation is NOT implemented**. The previously successful external Gemma PDF experiment is a reference only. Do not add the built-in *Compila PDF* Action or claim output until a scoped TypeScript PDF tool supports the chosen formats and passes end-to-end tests.
- **No autonomous project LLM planner**. It is a future optional enhancement; current project assistant sequence is user-configured.
- No new tool permissions are granted. Existing Actions remain Markdown shortcuts except explicitly allowlisted built-in native Actions from #40. All built-ins are uneditable and undeletable.
- Native tools do not require Ollama for deterministic work. Model-dependent operations honestly fail if Ollama is missing.
- Coordinator prompts and agent outputs are untrusted; they do not override resource restrictions. A future tool dispatch policy needs further threat modeling before accepting document-write actions.
- Filesystem and proxy errors must remain observable; new write operations require explicit destination authorization.

## Mandatory release acceptance (NOT RUN in connector environment)

1. `npm ci`, `npm test`, `npm run typecheck`, `npm run desktop:build`.
2. `npm run test:chat`, `npm run test:projects`, `npm run test:actions`, `npm run test:actions:api`, `npm run test:actions:ui`.
3. Native Electron test of project configuration, two-assistant orchestration, step trace, artifact download, failure/cancel/restart, multiple projects, shared assistant isolation and assistant chat regression.
4. Verify no-Ollama `2+2` in direct and project chat: no Ollama HTTP calls and identical deterministic result.
5. Verify model-dependent requests with a real supported Ollama model, especially Gemma E4B AFTER applying PR #38 (capability-based eligibility). Check Ollama `/api/show` `tools` metadata, multi-tool selection, required tool arguments, accuracy and unsupported-model fallback.
6. Verify RC4/RC5 regression gates, cross-platform packaging, source permissions, data preservation, SQLite migration 4→5, report download and error states.
7. Capture logs and classifications PASS/FAIL/BLOCKED/NOT RUN. Failures or untested suites block acceptance; source inspection alone is not a PASS.

No merge, protected-branch modification, tag, release publication or deployment is authorized by this PR alone.
