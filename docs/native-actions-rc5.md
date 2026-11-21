# Native, read-only Actions — RC5 candidate

## Decision

Keep **one Actions interface** in SIAAS Personal.

- Existing Markdown Actions continue to guide the model; built-in Markdown Actions are immutable and custom Actions remain editable/deletable.
- New built-in **native Actions** are also immutable but call a **fixed, application-maintained TypeScript capability**. The user cannot add tools or executable code by editing Markdown.
- A native capability is attached to a built-in ID and a fixed internal allowlist. The server checks the current assistant on every invocation and never broadens its document/folder/URL access.
- This first implementation exposes **Elenca fonti**, a deterministic read-only catalog of documents indexed, enabled and ready under the current assistant. It does not call Ollama, reveal physical paths, read document content, or claim that a file is writable.
- The existing hybrid assistant chat route handles the native Action directly. Other requests keep their existing deterministic-first and model paths.
- **Fill PDF / Compila PDF** is intentionally *not* advertised until a genuine, validated TypeScript PDF generation tool and permission checks exist. No invented application capability.

## Current code paths

- `src/lib/actions.ts`: `ActionSkill.execution` and `capability` metadata, immutable `builtin:list-sources`.
- `src/lib/local/native-actions.ts`: assistant-scoped implementation, fixed capability allowlist and bounded output.
- `src/app/api/chat/route.ts`: direct native execution through the existing single chat path, even with no selected model. Tool-less and normal agent behavior remains unchanged.
- `src/components/actions.tsx`: native built-ins labeled read-only, without edit/delete.
- Unit tests, existing API and UI test expectations updated.

## RC5 sequencing and limitations

This branch starts from **PR #35's head**, which already includes #34. It is intentionally stacked; do not merge it independently into develop or rebase release candidate #36 prematurely.

PR #39 (project orchestration) is a separate Draft from develop. When completing RC5, merge/reconcile native Actions and #39 after #34/#35/#37/#38. Then use the *same assistant execution engine* for direct and project-delegated calls. Do not create a second router.

No project-level chat, PDF writing, new project action, or runtime orchestration is implemented here. These are separate RC5 acceptance items.

## Required verification

- `npm ci && npm test && npm run typecheck && npm run desktop:build`
- `npm run test:actions`, `npm run test:actions:api`, `npm run test:actions:ui` (native Electron when supported).
- Confirm a no-model assistant invokes `builtin:list-sources` without any Ollama request; verify assistant isolation, disabled/not-ready sources, output bounds, forged custom capability requests, cancellation, and built-in PUT/DELETE 403.
- Confirm custom Actions still work and built-in Markdown Actions continue to invoke the model.
- Report PASS/FAIL/BLOCKED/NOT RUN honestly.

No branch merge, release tag, publication, or deployment is authorized by this Draft PR.
