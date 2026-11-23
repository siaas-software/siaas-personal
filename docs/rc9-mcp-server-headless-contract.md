# RC9 — Headless SIAAS MCP HTTP server and per-client authorization

**Status: APPROVED SCOPE / TRACKING SPECIFICATION ONLY — NOT IMPLEMENTED.**
**Decision date:** 2026-11-23. **Target:** SIAAS Personal v1.1.0-rc.9 (candidate, not a release commitment).
**Ownership:** `siaas-personal` implements the MCP HTTP server, security, Settings and execution services; `siaas-cli` only launches/controls the installed Personal runtime. **SIAAS-FLOW-01:** planning PR now, Work implementation after upstream readiness, independent review, separate authorized publication.

## Release sequencing and dependency

- RC7 draft PR #45: outgoing MCP **client** integration, project Tool Permission Gateway, separate Actions/Skills, project/assistant-scoped append-only execution events. **RC7 is not the incoming SIAAS MCP server.**
- RC8 draft PR #46: compaction, scoped recall, checkpoint/recovery and durable run safety.
- RC9 adds the incoming **MCP Streamable HTTP server** as a new external interface to the *same* SIAAS application/execution services used by the desktop UI. No general workflow engine, second Hybrid Router, duplicate project executor, separate model provider, mandatory Docker or cloud.
- This RC9 documentation PR is intentionally stacked on the RC8 feature branch, and must not be merged into RC8. After RC8 integration/publication reconcile source changes, rebase/retarget onto final `develop`, and validate the complete RC9 implementation. No RC9 code, tag, publication or release is authorized by merely merging documentation.

## Architectural boundaries

1. **Personal application runtime** owns persistent profile, projects, assistants, Actions, Skills, Knowledge/RAG, optional orchestrator, assistant-specific Hybrid Router, Gateway, SQLite/event trace, MCP server and HTTP/OAuth security.
2. **Personal desktop UI (Electron)** owns user-facing Settings, server enable/disable, connection mode, endpoint/port, authenticated-client enrollment/permissions/revocation, server lifecycle control and inspectable audit/status. No external MCP method may read or change global Settings, secrets, policy administration or MCP configuration.
3. **SIAAS CLI (Go)** is a thin, standalone lifecycle shortcut/launcher. It discovers the compatible installed Personal product/profile through a versioned local contract, reads effective bootstrap settings without modifying them, and may start/stop/restart/query a Personal-owned headless process. It does not implement a second MCP server, OAuth provider, agent executor, settings database editor or workflow engine. The CLI must not bypass a UI-disabled MCP server.
4. **External clients** (n8n or any compliant client) connect to the Personal-owned **HTTP** endpoint using standard MCP; *no stdio listener in RC9*. Their workflow sequencing/scheduling stays external. The server is never an unauthenticated proxy to the desktop UI.
5. **Headless** means no Electron window or graphical session required while processing previously authorized calls. A GUI close does not implicitly kill a separately managed active server; an explicit stop/disable must shut it down safely. Installation, start, update, profile migrations and shutdown must coordinate via single-instance/locking/IPC and versioned readiness, preventing concurrent SQLite writers and data corruption.
6. Distinguish desktop's existing internal authenticated local API from the *new external* MCP endpoint. Do not reuse an internal per-launch desktop secret as an external bearer token or weaken web-only start restrictions. Keep all desktop protections and migration rules.

## MCP transport and compatibility

- Streamable HTTP, initial default `127.0.0.1` binding; default server enablement **false**. Neither TLS exposure nor access to other hosts is implied by choosing HTTP.
- Follow the latest stable MCP protocol revision at implementation time, starting with 2026-07-28. This revision is stateless and uses required MCP HTTP routing/protocol headers; use a maintained SDK/library, verified `tools/list` and `tools/call`, correct errors/schema validation and capability metadata. Negotiate earlier supported revisions only with explicit testing, never unsafe silent fallback.
- Validate Host/Origin, content-type, protocol version, payload sizes, rate limits, concurrency and timeouts; prevent DNS rebinding, CORS abuse, SSRF, credential leakage, path traversal, malformed JSON-RPC and log injection. Reject unauthenticated requests before tool discovery/data access.
- Loopback is the safe baseline. Optional remote/network exposure must be UI-configured, authenticated and protected with correctly validated TLS and a documented certificate/trust model; do not enable insecure LAN binding merely to satisfy the feature. If remote gates are not met, leave it unavailable.
- Long-running tasks return an explicit operation ID and bounded status/result/cancel tools; integrate RC8 durable execution/recovery, progress, cancellation and idempotency controls. Use MCP Tasks extension only when client and implementation support it. Do not hold a request indefinitely; never replay an ambiguous non-idempotent step after crash.

## Authentication, authorization and Settings

- Settings in Personal UI are the **only** source of server configuration and authorization administration. CLI reads an authenticated/versioned local bootstrap/readiness contract, not arbitrary editable database internals. No CLI `--enable-mcp`, `--host`, `--port` or permission override.
- Security default: server disabled; if enabled, **no clients enrolled and no scopes granted**. Read-only may be offered as an explicit per-client preset, not granted to strangers merely because server is enabled.
- Standard OAuth 2.1 authorization model for HTTP. Personal's MCP endpoint is a protected *resource server*. An authorization-server component can be locally packaged/managed with Personal, but must be logically distinct, support protocol metadata, authorization code + PKCE for interactive enrollment, token refresh/revocation and audience/resource binding; no external account/cloud requirement. No new client is granted access with UI closed. Previously approved unattended clients must be able to refresh/reconnect when UI is closed; evaluate standards-compliant confidential-client grants only if supported and safe.
- Optional per-client, independently scoped/revocable Bearer credentials for **loopback compatibility**, stored hashed/secured and never a shared global admin token. A credential is not authorization to all resources. Never accept a token intended for another audience, confuse user identity with client identity, or pass through external access tokens to upstream services.
- Profile-bound client identity, expiry/rotation/revocation, last-used/audit information, UI enrollment and per-client per-project allowlist. Unrecognized clients deny. For requests with user absence, `Ask` must durably await explicit approval if supported, otherwise deny; never auto-Allow.
- Enforce intersection of (a) active server policy, (b) authenticated client scopes, (c) allowed project/resource IDs, (d) existing assistant/source ownership and (e) RC7 project Tool Permission Gateway for each actual tool call/effect. **Deny at every layer wins.** Recheck immediately before writes and delegated tool operations; revoke clients/access without allowing further queued steps.
- Capability scopes describe resource and verb, e.g. `projects:read/create/update/delete/execute`, `assistants:read/create/update/delete/execute`, `actions:read/create/update/delete/execute`, `skills:read/create/update/delete/execute`; UI may offer preset Read, Read+Execute and Custom. Project IDs and resource ownership are separately enforced as local policies, not encoded only in scope names.
- Read metadata is not unrestricted read of RAG source content, linked local paths, chats, model outputs, secrets or private files. Provide explicitly authorized data access, bounded/sanitized results, and source/visibility checks.
- **Privilege-change boundary:** MCP cannot modify global Settings, MCP client enrollment, trust configuration, credentials or Gateway administrative policies, even if project update normally shows some settings in the UI. It cannot transform Skill/Action content into executable permission, alter its own scope, enable model downloads/network rights, or create project-level permission grants. Sensitive UI-only policy changes are deliberately outside MCP's CRUD parity.
- Credential storage: OS secure secret facility where available plus encrypted/appropriately protected runtime state; never plaintext portable JSON, templates, logs, traces or CLI diagnostics. Document fallback/locked-keyring behavior, backups, migration and revocation without weakening fail-closed behavior.

## MCP application surface (UI parity within explicit scope)

Implement versioned, typed MCP tools/resources for the UI's actual, existing operations on **Projects, Assistants, Actions and Skills**, including list/read/create/update/delete and execute where the UI supports it. Cover import/export, project-to-assistant membership and assistant RAG configuration only through existing validated application services, without arbitrary filesystem traversal or source disclosure. Avoid fabricating capabilities that the UI/core does not expose. Each mutating operation validates object ownership, optimistic concurrency/version or ETag, idempotency for retries, input schema, paths and irreversible effects; distinguish deletion of managed copies from externally linked originals. No silent privilege widening through imports/templates. Use clear paginated discovery, typed failures and controlled result/output limits.

Execution includes assistant and optional project orchestrator with existing semantics, cancellation/status, source scope, model-capability checks, deterministic fallback, multi-assistant handoff and provenance. All incoming operations attach an external client principal, project/assistant scope, trace/correlation ID and execution ID to RC7/RC8 evidence. Redact secrets and sensitive tool inputs in append-only events.

## UI and CLI lifecycle

**Personal Settings > MCP Server**: enable (false default); transport fixed HTTP; loopback/local versus explicitly secured remote mode; bind address/port; status/health; start/stop/restart; authenticated client management (identity, grants, allowed projects, expiry, last use, revoke); security presets; audit review. Settings for this feature are modifiable only via the Personal UI. Closing UI must not require UI process presence for existing runtime. Reload policy changes safely without credential exposure, or perform a controlled restart when required.

**Proposed CLI commands (not yet shipped)**:
```text
siaas start personal --headless
siaas status personal --json
siaas restart personal
siaas stop personal
```
CLI reads the enabled/configured profile state and discovers installed compatible Personal runtime; start fails closed if disabled, incompatible or missing. Status is local process/readiness only, not unrestricted project access. Graceful stop/restart drains or safely cancels active operations, preserves execution evidence and manages stale process handles; no parallel runtime owning the same profile. Command successes/failures are machine-readable and redact secrets. No configuration or project CRUD commands are added to CLI for RC9.

## Acceptance gates / threat scenarios

- Disabled default: no listener; start via CLI fails without overriding Settings. Enabled but zero approved clients: all tool calls blocked, metadata unauthenticated only as allowed by OAuth discovery.
- Per-client identity, project allowlist and all CRUD+Execute scopes tested on direct and delegated execution; cross-project, assistant/RAG and template/Skill import isolation; no tool/model prompt can broaden permissions.
- OAuth code+PKCE enrollment, token expiration/refresh/revocation/audience/resource validation; failed credentials; restart with UI closed; credentials not leaked in history, backups, diagnostics, event trace or logs. Compatibility bearer clients independently scoped/revoked.
- `Ask` with GUI closed denies or suspends durably; no implicit allow. Revocation during running/queued execution blocks subsequent unauthorized operations. Changed Skill/Action does not inherit trust unexpectedly.
- HTTP security: non-loopback binds gated, Host/Origin/DNS rebinding, TLS, CORS, authentication-before-discovery, JSON-RPC/header version mismatch, flood/oversized payload, malformed schemas, idempotency/retry, cancellation, client disconnect and server crash.
- UI remains functional with server on/off; multi-client concurrency, no double runtime/SQLite lock; GUI close/reopen, CLI start/stop/restart, upgrade/migration/recovery on Windows/macOS/Linux. No OS admin permission required for ordinary per-user service; document platform-specific limitations.
- Actual n8n/client interoperability (verified protocol revision, auth, read, create/update/delete and execute) on same-host and supported remote configuration; record tested versions, unsupported legacy clients and behavior for asynchronous runs.
- Verify local-only operation without Ollama for deterministic tools, and real Ollama model scenario when available. Measure startup, idle CPU/RAM and per-call overhead relative to UI, plus bounded resource pressure.
- Run actual current `siaas-personal` unit, typecheck, templates, production web/desktop builds, API/UI/E2E, Knowledge/Actions/Skills/project orchestration, SQLite migration, install/distribution, security and native acceptance. Companion CLI Go tests/vet/build/native standard-user lifecycle/security tests; verify six target architectures where claimed. Preserve prior RC features. Every gate records exact ref, command, environment, result PASS/FAIL/BLOCKED/NOT RUN.

## SIAAS-FLOW-01 handoff

- **A/B:** this Draft tracking PR captures approved RC9 scope and release dependencies. No executable implementation in this initial change.
- **C:** after RC8 completion, Work/Codex builds RC9 on the reviewed PR (or stacked scoped child PRs), coordinating a separate CLI PR. First inspect exact current sources, open PRs and published MCP standard/SDK; reconcile earlier designs against reality. Do not import/implement a workflow engine or create a second runtime.
- **D:** ChatGPT independently reviews implementation diffs, actual logs, negative/security tests, interop and release artifacts.
- **E/F:** only with explicit release authorization, fulfilled GitFlow and mandatory acceptance, publish candidate `v1.1.0-rc.9` via the established verified workflow and Personal Vault. No automatic merge, tag, deployment or publication from this planning PR.

**Known unknowns to verify before production code:** existing desktop-server process ownership, SQLite threading/locking and credential vault availability on all platforms; versioned CLI bootstrap interface; OAuth provider/library security support; current MCP client compatibility; feasible TLS/remote default; run idempotency/long-running semantics. Treat all as NOT VERIFIED until tested.
