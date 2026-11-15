# RC4 local validation evidence

Executed on 2026-11-15 from `release/1.1.0-rc.4`, starting at
`ba28d0156e8c7b5f452d8ac78405633d728bda16`.
Test corrections are committed at `2ad48291e8f56859348f93f2bd14c6d67bd68e08`.
Application, runtime, installer and dependency code were unchanged.

`validation.json` records every orchestrated command's exit code and duration,
including failed attempts and their disposition. Logs named after commands are
retained alongside it, together with the initial `npm ci` log. Assertion failures
remain FAIL and are linked to successful affected reruns; prerequisite failures
are explained separately. Do not interpret an exit-1 command as PASS.
Log trailing whitespace and final blank lines are normalized for Git diff checks;
command output content and exit results are retained.

`artifacts-tested.json` describes twelve local source-release files at the test
correction commit, before this evidence-only documentation update. It is **not**
the final documentation commit's inventory. Fresh source assets are generated
and verified after that commit; their full SHA, ZIP comment and twelve hashes
are attested in PR #31, avoiding a self-referential archive/commit hash.
Native build outputs are excluded from the source-release payload list.

The application/desktop/scripts/runtime/package Git object identities are recorded
in `validation.json`. Headless HTTP/browser tests use real temporary SQLite and
simulated Ollama, with bridge fixtures where needed. Package builds and native
child lease checks do not establish native Electron GUI or public CLI lifecycle.
The earlier 93.08-second fixture lifecycle PASS is not reused as RC4 acceptance.

See [RC4 readiness](../../releases/1.1.0-rc.4-readiness.md) for the gate matrix,
unavailable/high-effort acceptance, repository controls and publication hold.
