# Local agent model eligibility — RC5 candidate

## Capability-based policy

SIAAS Personal may enable its existing bounded local agent workflow when Ollama's
`/api/show` response identifies a **local** model that declares both
`completion` and `tools`. Model parameter count is informational only and is
**not** a hard gate. A tool-capable 7.5B model can qualify; a 14B model without
`tools` does not.

`enabled: true` means **eligible to attempt** the tool workflow, not certified
to choose tools accurately or finish every task. Unknown model parameter counts
do not by themselves disable agent mode. The existing loopback-only endpoint,
no-cloud restriction, scoped read-only data tools, per-run operation budgets,
timeouts, validation and reporting safeguards still apply. Unsupported models
remain usable in standard chat.

**Ollama metadata matters:** the desktop route checks the `capabilities`
array returned from `POST /api/show`. A capability shown by `ollama show`
but omitted by the API is a discrepancy to investigate. Do not add model-name
allowlists, infer tools from an "8B" label or pretend the discrepancy proves
agent eligibility. If the API does not declare `tools`, SIAAS deliberately
keeps standard chat.

## Functional acceptance: synthetic, opt-in

The PowerShell test conducted on Windows 11 with `gemma4:e4b-it-q4_K_M`
demonstrated: one tool call and a **two-step sequence with only one tool
advertised per turn**; it transferred 32 and 92 and PowerShell computed 124.
That is real user-observed evidence of tool call construction, **not** proof
of autonomous tool choice, robustness, or native SIAAS agent acceptance.

For a stronger local-model check, start Ollama and run, from the repo root:

```powershell
node scripts/test-agent-tool-calling.mjs --model gemma4:e4b-it-q4_K_M --runs 15 --warmups 2
```

This script makes local HTTP calls only, keeps both synthetic tools available
simultaneously, enforces **read → calculate → final report**, checks exact
amount transfers and deterministic sums, and prints the number of correct
runs and observed durations. It creates no reports or files, executes no
model-proposed arbitrary code and touches no user datasets. Its output is
not a SIAAS application E2E test and is not comparable to the original
CPU-only 2+2/invoice benchmark. Record the Ollama version, model digest,
hardware/device allocation, run times, errors and full summary separately.

Suggested release evidence for this model: 15/15 measured successes after
two warmups, plus desktop API/GUI agent regression with the actual Ollama
model and the complete tool set. A lower result should be reported, not
converted into a PASS. Repeat checks for wrong tool selection, invalid
arguments, simulated failures, cancellation and assistant isolation before
any production reliability claim. Keep the candidate in draft if native
Windows acceptance remains open.

### Automated regression entry points

- `npm test`: capability policy and model metadata unit coverage.
- `npm run desktop:build && npm run test:chat`: simulated local agents
  below and above 8B, permitted calls and fallback without `tools`.
- `npm run test:desktop` and the real-model opt-in check, when a supported
  graphical host and local Ollama installation are available.

Integrate via the normal GitFlow PR review process alongside PRs #34–#37
before considering RC5 releasable. Never merge, tag or publish merely because
the model's synthetic tool-calling check succeeds.
