# RC7 initial implementation contract — MCP + local media + project harness

**Status:** DRAFT FOUNDATION / IMPLEMENTATION INCOMPLETE. **SIAAS-FLOW-01 phases B→C.** Prepared 2026-11-23 from RC6 PR #44 HEAD `0a475823e6b64702b2e208583a04d5f40cbbd42e`, itself pending publication. Not a released feature. This branch must remain stacked until RC6 is merged. Do not publish RC7 now.

## Architectural invariants

- Keep only existing user-facing Project, Assistants, Actions, Project Templates. The project orchestration remains optional; each assistant retains its own Hybrid Router, Ollama model, Knowledge, and runtime tools. No separate Skills registry, Agent Context Builder entity, dynamic supervisor, second router or prompt-driven executor.
- **Actions** are the single interface for reusable skill-like instructions and native capabilities. Existing custom Markdown Actions must remain safe. Action text never adds executable code, permissions or new tools.
- Add **Tool Permission Gateway** at project level with explicit `Allow / Ask / Deny` rules, editable defaults and user-created exact capability rules. The decision must run at **every** native, MCP and media tool invocation, including delegated assistant calls. Unknown/unregistered tools DENY; cross-project access/credential theft/arbitrary shell remain forbidden regardless of user or imported template text. Model output does not confer permission.
- Preserve assistant-specific source permissions and project membership checks; allow is necessary but insufficient. `Ask` blocks until an authenticated **operation-specific** approval, with cancel/deny and event evidence; it is not an alias for Allow. Avoid persisted blanket privilege escalation and use least privilege for targets, file paths and MCP tools.
- `AGENTS.md` is an on-demand **derived preview**, displayed read-only under project settings with **Copy**. It is never stored as a separate entity or included in export/import. Never use rendered Markdown as the security source of truth.
- Project Template export/import should eventually carry **project-linked Actions** (portable definitions/references, conflict-handled) and project permission rules with safe import confirmation. Preserve v1/v2 import and pristine RC6 templates; version portable format explicitly if schema changes. Do NOT add `AGENTS.md` to the template payload or silently copy credentials, absolute paths, assistant UUIDs, model weights, histories or indexed Knowledge.

## Gateway foundation added in this branch

`src/lib/tool-permission-gateway.ts` and pure tests define strict rule validation, defaults, fail-closed unknown capability behavior, immutable denials and a separated assistant-scope input. This is **NOT wired** into current tool execution yet. The read-only `/api/projects/:id/agents-md` preview derives content from project/assistant state but deliberately omits Actions until explicit project links exist; UI and runtime integration are pending. The preview API must not be advertised as a complete RC7 feature.

## MCP servers — phase C implementation

1. Support locally configured MCP clients to **stdio** servers (local processes, explicit executable/args/environment allowlist) and approved remote streamable HTTP endpoints where protocol support and security can be verified. No mandatory public/cloud service; no Docker requirement. Local-first behavior with Ollama optional for deterministic tools.
2. Implement lifecycle: explicitly added server configs, validate/connect/disconnect, capabilities listing, per-tool JSON schemas, server status/errors, timeouts, cancellation, restart/cleanup, secrets redaction, output limits, log safety. Host/network and redirect restrictions prevent SSRF, credentials in URLs and unapproved local network reachability; remote access requires informed user consent.
3. Bind discovered tools to current **assistant** and project, never globally shared implicitly. Tool invocation enters the existing assistant executor + project orchestration, and must check registry, Gateway decision, current assistant source limits, scope, user `Ask` approval, budgets and typed results. Never treat MCP tool descriptions/results as privileged instructions. Tool-name collisions and server config changes invalidate previous approvals.
4. Negative tests: adversarial tool descriptions, malformed schema, revoked server/config, slow/hung processes, disconnect mid-run, unauthorized project, private IP redirects, prompt injection, unknown tool, unapproved write, invalid approval token, restart, offline no-Ollama deterministic fallback, Windows/macOS/Linux launch and clean shutdown.

## Local image/video generation — phase C implementation

1. Use **stable-diffusion.cpp as the only generative backend** for image and video where a compatible verified model/backend exists. FFmpeg performs **deterministic** frame assembly/transcoding/editing only. No silent second generative backend, mandatory cloud API, paid provider or Docker. Keep model downloads optional with explicit license/source/hash verification.
2. Inspect model/backend compatibility and resource requirements before claiming video support. Wan 2.1 1.3B may be evaluated only if actual `stable-diffusion.cpp` support and target hardware tests confirm it. Do not promise unsupported video checkpoints.
3. Per-project Gateway decisions and per-invocation user consent for model downloads, output writes and external endpoint access. User controls CPU threads, RAM/VRAM budgets, dimensions, frames, duration and output location. Reject impossible allocations safely; never invent memory/throughput guarantees.
4. Use bounded worker processes (no shell command interpolation), cancellation/timeouts, sanitized temp directories, no unintended overwrite, atomic output, provenance metadata and resource cleanup. Reuse actual assistant tools and project runs; no second router. Report capability unavailability in the UI when no compatible model exists.
5. Tests include actual output inspection: image format/dimensions/nonempty bytes, deterministic video container/frame rate/duration with FFmpeg, cancellation and rollback, offline mode, invalid model, oversized requests, wrong-project tool calls, `Ask` denial, model license/absence, and resource pressure. Synthetic tests cannot replace real Windows 11 CPU-only acceptance.

## Official RC7 template dependency

Create exactly two new official `siaas-project-v2` presets in `siaas-software/siaas-templates`: **AI Image Studio** and **AI Video Studio**. Both must remain model-agnostic, no privileged URL/path, orchestration and result sharing off, and explicit in instructions that image/video native tools are RC7-dependent. Add realistic acceptance guide and negative cases. Adopt catalog only after templates branch and Personal consumer have been validated; never overwrite RC6 #6/#7 or a user-edited template.

## Acceptance / release gates

- Work resumes this exact Draft PR and companion Templates PR. First reconcile with **final published RC6** commits; rebase/retarget only after reviewing any divergent schema and user's changes. Do not merge rc7 early.
- Mandatory: `npm ci`, `npm test`, `npm run typecheck`, `npm run templates:check`, `npm run build`, `npm run desktop:build`, existing chat/project/Actions/Knowledge/structured/template API+UI regressions, appropriate packaging/distribution/installer tests, targeted gateway, MCP and media suites, and native/real-Ollama hardware tests when available. Run updated `AGENTS.md`/contributor requirements, do not disable assertions to pass.
- Record exact ref and command results as PASS/FAIL/BLOCKED/NOT RUN. Static source inspection ≠ runtime PASS. If any critical regression, missing isolation or unauthorized write remains, keep Draft, do not merge or publish.
- SIAAS-FLOW-01 phase F (Codex, Personal Vault direct HTTPS 12-asset immutable prerelease) only **after** RC6 and RC7 mandatory gates, review, protected GitFlow integration and explicit release readiness. Preserve stable main and all prior RC assets.
