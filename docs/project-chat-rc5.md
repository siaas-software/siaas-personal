# RC5 — Project chat and shared assistant execution

**Draft integration, verified 20 November 2026; not released.** Automated and production HTTP/SQLite/headless-browser checks have run. Real Ollama and native OS acceptance are separate outstanding gates. See [integration evidence](rc5-integration-2026-11-20.md).

## Architecture and behavior

Direct assistant chat and configured project delegation both call `executeAssistantTask()` in `src/lib/local/assistant-execution.ts`. Each assistant retains its own Hybrid Router, instructions, model, authorized sources and tools. The project has no second router or model runtime. `ChatComposer` and `ChatMarkdown` are shared presentation components; individual conversations and project runs have separate persistence.

Project orchestration is disabled by default. Users select existing project members in execution order, with a maximum of eight steps. Result sharing is separately opt-in. The original task remains unchanged for deterministic interpretation. Only model requests receive bounded prior-step text and coordinator preferences, explicitly marked untrusted. Neither grants resource access. `2+2` therefore remains local even with a configured model and hostile handoff text.

The runs API validates membership, ownership, configuration, Action IDs and the step budget before returning HTTP 202. Work continues under a 240-second execution deadline and a 300-second recovery lease. The UI polls persisted progress; DELETE with a run ID requests cancellation, which propagates to pending Ollama requests. Concurrent runs in one project are rejected. Membership, enablement, sharing and budget revocations are checked throughout execution. Expired runs become errors rather than successful results.

Each step preserves text, execution path, sources, metrics, errors and authorized Markdown artifacts. Deterministic steps record zero tokens and no model. Unavailable model metrics remain null. Truncated model output and oversized project output are errors with partial text retained. A failed required step stops subsequent delegation. Project result text is limited to 12,000 characters per step, handoff text to 6,000, coordinator preferences to 4,000, and each downloadable report to 32,000. Source excerpts appear under step details with acquisition times when available.

The native **List Sources / Elenca fonti** Action works in direct and project chat without Ollama and uses each assistant's authorized prepared sources. Custom Actions cannot impersonate native capabilities: the executor resolves the canonical stored Action by ID. Other Actions preserve their prompt/model workflow.

## Persistence and compatibility

`project_runs` is an additive SQLite table under existing schema version 4. Project deletion cascades to its runs. Existing assistant conversations are not rewritten. API integration checks reopen SQLite, validate separate histories and project-scoped artifacts, and revoke artifact access when its producing assistant leaves the project. This does not substitute for native RC4-to-RC5 installation and retention acceptance.

## PR integration

The stack is #34 → #35 → #40 → #41. Independent #37 (timeouts/truncation) and #38 (capabilities) are reconciled into #41. The source foundation from #39 was already incorporated; it is not replayed. #36 is refreshed after this source integration and retains candidate packaging/version and prior RC4 regression corrections.

The planner remains bounded and configurable (default 120 seconds, allowed 30–180 seconds). Native tools require reported `completion` and `tools` capabilities and runtime compatibility, not an 8B size threshold. Capability eligibility is not proof of reliable real-model tool selection.

## Reproduction and remaining scope

From the application root, install the lockfile, build desktop, then run `node --import tsx tests/project-chat-api.mjs --ui`. Set `CHROMIUM_EXECUTABLE_PATH` to an installed compatible Playwright browser if needed. The test uses real local routes and SQLite with synthetic Ollama responses. `npm test`, `npm run typecheck`, chat/Knowledge/Actions/structured API suites and existing UI suites cover shared behavior.

PDF extraction is implemented; PDF writing/filling is not. No **Fill PDF** native Action, arbitrary code execution, Python runtime or dynamic autonomous supervisor is introduced. Future PDF tools require authorized template resolution, format/field inspection, schema-validated mapping, immutable originals, bounded writes to an approved destination and independent output verification. Prefer TypeScript support for a specific supported format before broader editing claims. Dynamic assistant selection through Tool Calling is a later optional planner over the same validated delegation contract.

No PR merge, protected-branch update, release tag, release publication or public download change is part of this draft.
