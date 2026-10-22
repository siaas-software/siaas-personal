# Assistant sources and optional Beta research

Every assistant can use **both local indexed documents and explicitly configured websites**, including standard chat models. There is no exclusive research-mode selector. Standard source retrieval and website consultation need neither Docker nor a Beta service.

## Standard source workflow

1. Retrieve matching local indexed documents. If embeddings are unavailable or return no match, use a deterministic, assistant-scoped lexical passage lookup.
2. Remove common English/Italian stop words from the current question and measure meaningful-term coverage in the retrieved passages. If at least 80% of those terms occur and no current/website information is requested, skip website requests. This is a routing heuristic, **not** a correctness or semantic completeness check.
3. Otherwise read only configured websites that the user has approved, respecting Page/Section scope, page budget, response size, redirects, timeout and private-network protections. Greetings and explicit local-only requests never consult websites or generic search. No question or document body is sent to a configured website: consultation is a bounded GET of the configured URL and allowed direct links.
4. If independently enabled and ready, Advanced Reasoning evaluates the resulting evidence. Standard consultation does not depend on its availability.
5. If evidence remains insufficient, Advanced Web Research can discover additional public sources **only with both global and assistant consent**, fresh Docker checks and healthy services. When enabled, reasoning can evaluate newly discovered evidence again.
6. Answer using available numbered sources and disclose warnings or missing information. Failures preserve already collected citations and conversations.

Local matching is conservative and can miss relevant passages. Broad questions may trigger configured-site consultation even when local material contains an answer. No arbitrary Internet search occurs in the standard workflow.

## Assistant research panel

Website URL, Page/Section scope, maximum pages and timeout are always available. **Page** reads the configured page. **Section** additionally follows direct links under the same origin and configured path, bounded to one hop.

**Knowledge Sources** are persistent imports saved and indexed for the assistant. **Configured websites** are consulted on demand for a question and are not automatically imported into Knowledge Sources. Conversation citations can retain the evidence used; imported website snapshots remain separately available offline after indexing.

The panel includes **Advanced Web Research (Beta)**, OFF by default for new assistants. Enable the global service first in **Settings → Experimental Features**, then explicitly enable the assistant switch while Docker and service health are ready. The assistant switch never enables the global service. Saved-on but unavailable consent remains visible and can be disabled; chat falls back to standard sources. A new invalid enabled state is rejected by the backend and not saved.

## Global Beta controls

| Capability | Standard workflow | Advanced Reasoning (Beta) | Advanced Web Research (Beta) |
|---|---|---|---|
| Local documents and configured websites | Always available | Preserved | Preserved |
| Docker required | No | Yes | Yes |
| Global opt-in | No | Required | Required |
| Assistant web-discovery opt-in | No | Not required | Required |
| Evaluate evidence with the decision engine | No | Yes, when healthy | Only when reasoning is separately enabled |
| Discover additional Internet sources | Never | No | Fallback only |
| Default for a new installation/assistant | Standard sources available | OFF | OFF |

Both services are independent, optional Betas. Docker CLI, Compose v2 and an accessible Linux-container Engine 20.10+ on x64/arm64 are required. Global switches remain unavailable if prerequisites fail; Refresh Status never grants consent. Readiness and saved preferences remain separate. Existing lifecycle, health, retry and pending-shutdown controls are unchanged. Advanced discovery uses the local model; its tool support and resources can limit results. Standard websites work even without agent mode.

## Migration and privacy

Research settings use version 2 with an assistant `advancedWebResearch` flag, configured URLs and preserved budgets. Old `sites` configurations retain their approved website consultation. Old `web` configurations retain websites but migrate with assistant discovery **OFF**, and a notice explains how to opt in again. Old `documents` configurations with saved inactive URLs preserve them but require the explicit **Allow configured website consultation** confirmation before any website request. Migration itself performs no network access. Projects, knowledge, models, messages, sources, warnings and conversations are not removed.

Discovery queries use **only the current question**, never model-generated text from local passages, instructions, source titles or conversation history. Conservative checks skip questions with detected private context, identifiers or copied local phrases and show a warning. This is not guaranteed anonymisation: avoid confidential questions when opting into Internet discovery. Documents and history are not attached to search requests. Existing SSRF protections, query/page limits and local-only inference remain enforced.

## Docker prerequisites and troubleshooting

- Windows: install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/), complete the supported WSL 2 / virtualization setup, select Linux containers and start Desktop.
- macOS: install [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/) for Intel or Apple silicon and start it.
- Linux: install [Docker Engine](https://docs.docker.com/engine/install/) and [Compose v2](https://docs.docker.com/compose/install/linux/), start the daemon and grant your user access according to your local security policy.

Verify in a new terminal:

```bash
docker --version
docker compose version
docker info
```

Then use Settings → Experimental Features → Refresh Status and explicitly enable the desired feature. Setup never installs Docker or starts its daemon automatically. If controls stay unavailable, check PATH, permissions, Engine accessibility, Linux-container mode and supported architecture/version. Service errors may instead indicate failed image/model downloads, occupied ports, insufficient resources or unavailable Ollama. Check the research status and local service log; retry after fixing the cause.

For advanced troubleshooting from the application source/version directory:

```bash
npm run research:status
npm run research:setup -- reasoning
npm run research:setup -- web
npm run research:start -- reasoning
npm run research:start -- web
npm run research:stop -- reasoning
npm run research:stop -- web
```

Each mutating command requires an explicit service. These commands prepare/stop services; they do **not** grant feature consent or change the switches. Prefer the application controls. For a managed installation, use `runtime.node` and `runtime.npm` from `current.json`, with `--prefix <install-root>/versions/<folder>` before `run`; global Node.js/npm and nvm changes are unnecessary. The default root is `%LOCALAPPDATA%/SIAAS Personal Source` on Windows and `~/.local/share/siaas-personal-source` on macOS/Linux; respect a custom `SIAAS_INSTALL_DIR`.

Implementation reuses the existing Laya container for reasoning, and the existing Morphic local Node adapter plus its SearXNG Docker service for web research. This preserves access to loopback-only Ollama without changing its binding. Engine names are technical details, not the main UI labels.

## Upstream technologies and licenses

Advanced Reasoning uses the Apache-2.0 Laya Python package and a multilingual checkpoint downloaded on first use. Advanced Web Research uses SIAAS's Apache-2.0 adaptation of Morphic's researcher plus a separate SearXNG Docker search service. Neither feature is necessary for standard chat, local documents or configured website consultation. The SIAAS MIT license does not replace the upstream licenses. See [Open Source & Third-Party Technologies](https://siaas.vercel.app/open-source/en) and the repository's [third-party notices](../THIRD_PARTY_NOTICES.md) for authors, source revisions, license texts and attribution.


## Validation boundary

Unit tests and compiled API/SQLite integration use mocked Docker, websites, Ollama and advanced services. Real Docker lifecycle, browser hydration and Windows/macOS/native model tests remain separate Astra validation work. No deployment or release is performed.

License verification (19 October 2026): Laya **0.4.6** and the Morphic adaptation based on **62e0816b019c5543ccc280c40ec1f020d5af4669** are Apache-2.0; SIAAS Personal remains MIT. The inspected wheel/revision contain no upstream NOTICE. Model downloads are not revision-pinned; verify the actual artifact before redistribution. See the [verification record](https://github.com/siaas-software/siaas-personal/blob/main/docs/license-verification.md).
