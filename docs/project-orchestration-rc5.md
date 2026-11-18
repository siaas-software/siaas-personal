# Project-scoped assistant orchestration — RC5 integration contract

**Status:** draft foundation only. This branch is NOT a functioning multi-agent UI or a PDF-filling implementation. It must not be described as operational or released until the shared assistant executor has been connected and accepted on the integrated RC5 stack.

## Decisions

- A SIAAS project contains N existing assistants. The project optionally acts as their orchestrator.
- Each assistant keeps its prompt, chat, selected documents/folders/URLs, its own **Hybrid Router** and locally configured Ollama model.
- A delegated request MUST enter the **same assistant execution pipeline** used by direct chat. Do not add a parallel "agent-only" inferencing path or a second router at project level.
- Project orchestration is **opt-in**, disabled by default. Project configuration names explicitly delegated assistants (maximum eight).
- The orchestrator passes structured assignments. **Result-text sharing is disabled by default** and requires the explicit `share_results: true` project setting. It cannot grant new filesystem, network, document or tool privileges. A target assistant rechecks its own resources when it executes. The orchestrator must not give an assistant raw document contents of another assistant unless explicitly authorized through the project's handoff policy.
- Existing **Actions are Markdown shortcuts**, not executable tool definitions. Add default Actions only AFTER their underlying deterministic tool exists and is available; do not silently change built-in Actions into code.
- For PDF fill use a bounded TypeScript document tool only when implemented and verified; require a writable, authorized destination. Preserve the source and reject unsupported flat PDFs, absent fields, ambiguous templates and failed verification. No mandatory Python or cloud dependency.
- Gemma E4B acceptance follows capability-based PR #38; do not restore an 8B gate. Report whether each model actually calls tools and completes tasks, not merely its declared capabilities.

## Foundation implemented in this PR

1. `src/lib/project-orchestration.ts` — pure, bounded, sequential orchestrator contract with an injected delegate. Validates project/tenant membership, configured assistant allowlist, step budgets, explicitly opted-in typed result handoff, abort and error propagation.
2. `Project.orchestration` optional catalog field and `PATCH /api/projects/:id` validation/persistence. SQLite already stores row JSON; no migration required for this optional property. Existing projects stay disabled.
3. `POST /api/projects/:id/orchestration/plan` — validates a caller-provided sequence, **returns `validated_not_executed`**. This endpoint cannot call models, touch documents or claim a completed workflow.
4. `tests/project-orchestration.test.ts` — unit cases for budgets, permissions, handoff, cancellation and failure.

Example project configuration (submit through the existing project PATCH route with its current `name`):

```json
{
  "name": "Document Management",
  "orchestration": {
    "enabled": true,
    "share_results": true,
    "instructions": "Find the selected document; hand off only the authorized result.",
    "assistant_ids": ["<assistant-A-uuid>", "<assistant-B-uuid>"],
    "max_steps": 2
  }
}
```

Example preflight request to `/api/projects/<project-uuid>/orchestration/plan`:

```json
{"steps":[
  {"assistant_id":"<assistant-A-uuid>","task":"Find the matching PDF among your selected sources"},
  {"assistant_id":"<assistant-B-uuid>","task":"Validate the field mapping for authorized JSON data"}
]}
```

Setting `share_results: true` explicitly authorizes passing assistant-produced **text** to the next participating assistant, not extending its file/folder/URL permissions. Do not enable for confidential cross-assistant data without user intent. The adapter must treat this text as untrusted data and revalidate every referenced document ID in the receiving assistant scope.

The API returns **`status: "validated_not_executed"`**, not `success`. Actual execution is deliberately not exposed by this draft.

## Mandatory RC5 integration work (not yet implemented)

1. Integrate/reconcile the RC5 stack first: #34 unified deterministic-first chat, #35 preparation and retrieval (stacked on #34), #37 timeout/truncation, #38 Ollama capability-based agents, then refresh #36 RC5 candidate evidence **last**. Use new branches/normal review, no automatic merges.
2. Extract or expose a reusable `executeAssistant({ assistantId, question, executionContext, signal })` service from the integrated assistant chat pipeline. It must preserve deterministic routing, structured analysis, retrieval, Ollama agent/plain chat, streaming semantics, cancellation and trace/evidence. Do NOT invoke `runLocalAgent` directly as a project-only bypass.
3. Bind the `executeProjectPlan` delegate to that service. Check target project, permissions, current assistant configuration and resource availability on **every delegated step**. Handoffs are data, never privileged instructions. Do not leak another assistant's document chunks, paths or credentials.
4. Add an opt-in project UI for orchestration config, allowlist, execution status and project chat. Support direct-chat and delegated invocation of the SAME assistant. Keep single assistant chats unchanged. Project instructions may guide a future dynamic planner, but cannot enable new tools or override access checks.
5. Optional dynamic planning: if Ollama supports it, propose a strictly structured bounded plan, validate it with the same pure contract, and require explicit user review for write operations. Never interpret free-form model output as executable actions.
6. PDF experiment after the generic delegation succeeds: implement `resolve_document`/field inspection and `fill_pdf` tools using Node/TypeScript, preserving originals. Add a default **Compila PDF** Action only after the executable tool is available and scoped. Do not promise text-in-place editing of arbitrary flat PDFs.
7. Test: unit + full chat API + native Electron Windows/macOS/Linux when feasible; same assistant result in direct and orchestrated contexts; no-Ollama deterministic fallback; model with and without tools; two-assistant workflow, wrong project/assistant, disabled source, duplicate filenames, broken files/proxy, cancellation, recursion/step limits, malformed JSON, read/write scopes, no unintended persistent chat-history contamination.
8. Record real-model Gemma E4B results separately from simulations. Use 2 warmups + 15 trials when appropriate, report correctness, tool choices, timing/p50/p95, and distinguish prerelease blockers from failures. Confirm PR #38 `/api/show` capability behavior on the target Windows host.

## Release boundaries and ownership

PRs #34/#35/#36 are stacked; #37 and #38 are separate drafts against `develop`. This foundation is also an isolated draft against `develop`. Avoid rebasing #36 before it is time to refresh the RC5 release candidate. Never modify the frozen RC4 baseline.

Before any merge or release: `npm ci`, `npm test`, `npm run typecheck`, `npm run desktop:build`, `npm run test:chat`, `npm run test:projects`, `npm run test:actions`, relevant existing RC4/RC5 gates, and real Windows acceptance. Mark PASS/FAIL/BLOCKED/NOT RUN honestly; the draft alone is not evidence of operational orchestration. No merge, release, tag or deployment is authorized by the creation of this PR.
