<p align="center">
  <strong>SIAAS Personal</strong>
</p>

<h1 align="center">SIAAS Personal</h1>

<p align="center">
  <strong>Build and use local AI agents without needing the technical knowledge to set up a local AI environment.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#product-principles">Product principles</a> &middot;
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#local-ai-and-models">Local AI</a> &middot;
  <a href="#development">Development</a> &middot;
  <a href="https://siaas.vercel.app/documentation">User guide</a>
</p>

---

SIAAS Personal gives you a **ready-to-use local environment for AI agents** without asking you to understand or manually configure models, runtimes, embeddings or RAG infrastructure.

Create a project for your role or activity, add specialized assistants, give them your knowledge and start using them. SIAAS Personal takes care of the local AI environment behind the scenes: it detects the computer capabilities, manages Ollama, helps choose suitable models and downloads what is needed.

**Project → Assistants → Optional knowledge → Use**

No paid AI API is required for normal Personal usage. AI execution, documents, conversations and RAG data stay on the user's computer.

Every assistant uses a unified local-documents → configured-websites workflow. Websites are consulted on demand only when deterministic source routing calls for them. Advanced Reasoning (Beta) and Advanced Web Research (Beta) are independent optional Docker-based features, both off by default in Settings → Experimental Features. Normal chat, local knowledge, selected websites and standard agents work without Docker. See the [research guide](docs/research-en.md).

## Release Candidate testing

The **v1.1.0-rc.2** testing candidate uses a separate RC installation and profile;
standard installation still selects stable releases. See the [RC2 notes](docs/releases/1.1.0-rc.2.md),
[Windows checklist](docs/windows-rc2-testing.md), [test evidence](docs/releases/1.1.0-rc.2-readiness.md)
and [permanent RC publication policy](docs/rc-publication-policy.md).
Environmental tests marked BLOCKED/NOT RUN are manual acceptance activities, not
claims of native or real-model validation. RC2 is not a stable promotion.

## Product principles

### Local-first privacy

SIAAS Personal is designed to run locally. AI execution, workspace data, assistants, documents, RAG data and conversations stay on the user's computer.

SIAAS Personal has no user account or cloud authentication. Updates use official GitHub Releases. Optional web research makes outbound queries and page requests as described below.

### Knowledge and local RAG

Assistants can use PDF, DOCX, TXT and Markdown sources. SIAAS Personal stores and indexes them locally, creates embeddings and retrieves relevant passages when an assistant needs them.

Knowledge remains isolated according to the configured assistant/project context, and sources used in answers remain inspectable.

### Structured Data Analysis

Import XLSX/CSV datasets into assistant Knowledge, inspect profiles, confirm mappings
and relationships, and calculate traceable results with SQLite persistence and a
bounded TypeScript execution engine. Knowledge/RAG supplies descriptive evidence;
Ollama proposes validated plans and explains computed results. No Docker or Python
is required. See the [Structured Data Analysis guide](docs/structured-data-analysis.md).
Production Planning and Personal Finance provide reusable assistant configurations.

## Quick Start

### Install the application

Visit [Get started](https://siaas.vercel.app/get-started) for source installation on Windows, macOS and Linux. The PowerShell and Bash bootstraps provision official Node.js 24.22.0 LTS in an application-managed directory, verify runtime and release checksums, build the desktop package and create a launcher. No global Node.js, npm, Git or NVM changes are required. A published stable source release is required; no user account or cloud configuration is needed.

SIAAS Personal runs entirely in **guest mode**. Projects, assistants, chats, local Knowledge, templates, Overview, model downloads and application updates require no account. Use **Settings → Application updates** to check the latest stable release. Local work remains available offline; use separate OS profiles for separate workspaces.

The source manager keeps the current installation when it is already up to date and stages newer versions separately. On first launch, the shared Ollama manager reuses a compatible service or starts a stopped installation, preserving existing models. It offers a managed download only if Ollama is absent; incompatible installations are reported, never silently replaced. Missing models are downloaded when needed.

Launch an installed application from its generated Start menu entry (Windows), `~/Applications/SIAAS Personal.command` (macOS), or application-menu entry (Linux). Updates and rollback retain user data; uninstall unregisters the launcher and preserves application versions/data. See [installation and troubleshooting](docs/installation-en.md) for repair, backups and antivirus/file-lock errors. Native Windows/macOS acceptance remains separate from successful Linux builds.

### Source development requirements

- Git
- Node.js 22.16+ with npm (the packaging workflow uses Node 24)
- Repository access for source development
- Windows, macOS or Linux with a graphical desktop

A dedicated GPU is optional. As a practical starting point, use a machine with at least 8 GB RAM and around 10 GB free disk space.

### Clone and run

```bash
git clone https://github.com/siaas-software/siaas-personal.git
cd siaas-personal
npm ci
npm run desktop:dev
```

`desktop:dev` is a build-and-launch command, not a hot-reload server. Run it again after source changes.

`desktop:dev` builds the desktop runtime and starts Electron. No `.env.local`, cloud configuration, manual Ollama installation or pre-downloaded chat models are required. Electron supplies the local server origin and per-launch access key. The web-only `npm run dev` entrypoint displays desktop startup guidance; it does not expose the local database. Updates use official stable GitHub Releases without a user account.

## How it works

### 1. Create a project

Create a space dedicated to your role or activity.

### 2. Create your assistants

Add specialized assistants for the different tasks that are part of that role or activity. Each assistant has its own purpose, instructions, configuration and AI model.

### 3. Connect your documents when useful

In an assistant’s **Knowledge** section, choose **Import files** to create local managed copies or **Connect folder** to use documents in their existing location. Imported originals are never moved. Folder selection supports a native picker, a pasted absolute path, optional subfolders and a preview before confirmation. Knowledge remains optional.

Connected folders are checked when opening a project; **Refresh now** also checks changes and processes pending documents when the local embedding model is ready. The opening check marks new and changed files for processing without silently starting model work. Deleted source files are removed from retrieval. An unavailable folder is clearly marked and stops contributing to answers until it is reconnected and processed. You can update its path after moving it or reconnecting a disk. There is no continuous background watcher in this version.

Supported files: PDF, DOCX, TXT and Markdown, up to 10 MB each and 100 documents per assistant. Hidden files, symbolic links and unsupported files are excluded. Scanned PDFs need OCR first. Identical imported content is deduplicated within an assistant; same-name files with different content receive separate document directories. Overlapping folder links within one assistant are rejected.

#### Local filesystem organization

The **Settings → Documents on this PC** panel shows the data directory and opens it in the system file manager. The packaged app uses Electron’s user-data directory; a directly started desktop server may use `SIAAS_DATA_DIR` or `~/.siaas`.

| Relative path | Contents |
| --- | --- |
| `projects/<project-id>/assistants/<assistant-id>/documents/<document-id>/file-<name>` | Managed copies, preserving readable names without collisions |
| `projects/<project-id>/assistants/<assistant-id>/sources.json` | Folder links and document metadata |
| `projects/<project-id>/assistants/<assistant-id>/knowledge/index.json` | Rebuildable extracted passages and index metadata |
| `siaas.sqlite` | Authoritative records, embeddings and conversations, isolated by assistant |

Run `npm run desktop:build && npm run test:knowledge` to exercise the real desktop API with temporary files, SQLite and a deterministic Ollama fixture.

IDs keep paths stable when projects or assistants are renamed. Existing imported files migrate on startup without changing document IDs or indexed content; interrupted migrations keep the original path usable and retry on restart. JSON manifests are rebuilt from SQLite.

Removing a source also removes its searchable index. For imported files, a separate unchecked option deletes the managed copy; otherwise that copy remains in the data directory. Removing an individual linked document excludes it from subsequent folder refreshes. Disconnecting a folder never deletes originals. Deleting an assistant or project removes its managed copies and derived data, while linked originals remain untouched.

### 4. Use your assistants

Chat with the right assistant using its instructions, selected model, conversation history and relevant local knowledge.

## Local AI and models

SIAAS Personal uses Ollama to run AI models locally, but the user does not need to configure the local AI stack manually.

The desktop runtime checks for a compatible Ollama installation and can reuse it or configure a managed local copy.

Chat models are selected per assistant. SIAAS Personal can recommend a suitable model using the assistant's task and the computer's available resources. If the selected model is missing, it is downloaded from the application when needed.

EmbeddingGemma is used for local document retrieval and is prepared when local knowledge requires it. It is infrastructure, not the chat model assigned to an assistant.

SIAAS Personal does not fine-tune or retrain model weights.

### Local agent mode

Desktop assistants automatically use agent mode when Ollama confirms at least **8B parameters** and support for tool calling. Smaller models, models without tool support and models with unknown size keep normal chat. The mode is shown in chat and settings.

The agent can search its own documents, read source passages and create downloadable Markdown reports. Conversations and reports stay in SQLite on the computer. This first version limits each response to eight tool operations and three reports, and does not automatically resume an interrupted tool workflow.

### Overview dashboard

**Overview** appears in the left sidebar alongside Projects. It monitors all installed local Ollama models, including embeddings and models with no assigned assistant. It shows loaded models, SIAAS Personal requests, linked assistants/projects and available CPU, RAM, GPU/VRAM and other resource readings.

Computer-wide load is not attributed to individual models. Missing sensors are shown as unavailable, and disconnected Ollama data is marked stale. Local request history contains metrics, not prompt or response content.

### Assistant research

Every assistant can use **both local indexed documents and configured websites**, including standard chat models. Local retrieval comes first; websites are consulted when meaningful-term coverage is below 80% or current/website information is requested. Greetings and explicit local-only requests skip external consultation. This routing rule is deterministic and is not a correctness check. Imported Knowledge Sources are persistent; configured websites are read on demand without automatic import. Advanced Reasoning (Beta) and Advanced Web Research (Beta) require Docker and explicit, independent opt-in in **Settings → Experimental Features**. Both are off by default; legacy settings do not enable them. Controls remain disabled without a running, accessible Linux-container Docker Engine 20.10+ (x64/arm64) and Compose v2. Refresh Status never enables a feature automatically. Backend checks prevent activation and advanced requests when prerequisites fail. Standard chat, selected websites and agents need no Docker. Advanced Web Research also requires the OFF-by-default assistant toggle in its research panel. Legacy Advanced configurations migrate with this toggle OFF; legacy document-only configurations with inactive saved URLs require confirmation before website consultation. URLs, budgets and conversation evidence are preserved. Discovery queries use only the current public question; no query is generated from local documents or history.

With Docker Desktop (Windows/macOS) or Engine plus Compose (Linux) already running:

```bash
docker --version
docker compose version
docker info
npm run research:setup -- reasoning
npm run research:setup -- web
npm run research:status
npm run research:start -- web
npm run research:stop -- web
```

Use the Settings switches for normal activation. These optional troubleshooting commands manage only the named service and do not change the saved opt-in. They never delete volumes or unrelated containers. See research [English](docs/research-en.md) / [Italiano](docs/research-it.md), and installation [English](docs/installation-en.md) / [Italiano](docs/installation-it.md) for OS prerequisites, troubleshooting, privacy and current limitations.


## Architecture

| Layer | Technology |
|---|---|
| Desktop | Electron |
| Application | Next.js + React |
| Local database | SQLite |
| Local AI runtime | Ollama |
| Local agent | LangChain JS `createAgent` / LangGraph + ChatOllama |
| Local RAG | EmbeddingGemma + local document chunks |
| Optional research | Independent Advanced Reasoning (Beta) and Advanced Web Research (Beta), both off by default; Docker required |
| Online services | Official releases/updates and optional web research |

The local server binds to `127.0.0.1` on a random port and uses a per-session key. Host and origin checks apply in guest mode too. The renderer has no Node access. Guest mode does not create an anonymous cloud account; the local OS profile owns the workspace.

### Public installation and account-free updates

- `GET /api/desktop/downloads?platform=win32&arch=x64` retains validated public installer metadata, when a matching stable binary release exists.
- The desktop checks official GitHub Releases without a login. Source installations support **Update now**, with native confirmation before shutdown and activation through the independent source manager.
- The source manager stages the tagged version, builds it, creates launchers and switches the active version only after validation. Rollback changes application binaries, not local data.
- An unavailable release or offline connection produces an update error without locking the workspace. No authenticated update-ticket service is required.
- See [Migration and compatibility](docs/migration-en.md) for preserved data locations and validation limits.

## Development

The normal developer workflow is the Quick Start above: `npm ci` followed by `npm run desktop:dev`.

For work limited to the Next.js layer, use:

```bash
npm run dev
```

For application code changes, run:

```bash
npm test
npm run typecheck
npm run build
npm run desktop:build
```

For changes involving real local AI behavior, also run `npm run ollama:test`.

For documentation-only changes, check links, commands and consistency with current behavior. Installer generation is not part of ordinary development.

## Releases and updates

Public distribution uses reviewed source ZIP and installation-specification assets, built locally with `npm run release:source`. Native Electron packages are development/verification artifacts; this workflow does not publish .exe/.dmg installers. Release publication is a separate maintainer action.

```text
reviewed merge → release tag → source assets + checksums → authorized release → source-managed update
```

Normal website or documentation changes do not trigger desktop packaging.

## User guide

The public [Personal documentation](https://siaas.vercel.app/documentation) contains searchable English and Italian guides for installation, everyday use, Knowledge, backup, guest mode and updates, architecture and development. The website generates its English technical reference from this README using `docs:sync`; the app repository keeps this README as its in-repository documentation.

This repository contains the **Personal application**. Its README is the in-repository guide for users and contributors.

## Shared template catalog

Template definitions are maintained in [siaas-templates](https://github.com/siaas-software/siaas-templates). This repository consumes a generated snapshot pinned in `templates-source.json`; edit the source repository, not `src/generated/`. The app preserves users’ saved templates and deletions. The website displays summaries and downloadable JSON from the same catalog. The current presets are Computer Science Study, Production Planning and Personal Finance. Retired built-in presets are hidden from the catalog; existing projects and user-saved templates are preserved.

To adopt a catalog commit:

```sh
npm run templates:sync -- --ref <full-commit-sha>
npm run templates:check
```

The official templates repository is public. A token is unnecessary for normal public reads. To use a reviewed local checkout:

```sh
npm run templates:sync -- --ref <full-commit-sha> --catalog ../siaas-templates/catalog.json
```

Commit the generated file and `templates-source.json` together. Builds verify the snapshot locally. No GitHub credentials or network access are needed by the running app or public site. New upstream commits are adopted explicitly with the command above.

### Knowledge and chat workspace

Open an assistant to see **Knowledge** on the left and **Chat** on the right.
Conversations are available from the expandable history above chat. On narrow
screens, Knowledge stacks above Chat. Some interface labels are localized; fixed
section names such as Projects, Actions, Templates and Knowledge are retained.

Alongside local files, text and linked folders, **Web sources** accepts public
HTTP/HTTPS URIs. SIAAS Personal reads an HTML or plain-text page, saves its text locally
for that assistant and indexes it with the document model. Indexed snapshots
remain usable offline and retain their URI and retrieval date in citations.
Use **Refresh** to fetch changes, **Index** to retry indexing, or remove the
source to remove its knowledge. Refresh failures preserve the last saved copy.
Login-only pages, private network addresses, PDFs at web URLs and pages that
require JavaScript are not supported by this importer; import local PDF files
through the existing file workflow. Adding a URI contacts that website.

The chat action column contains **Data Cell / Data table**, followed by built-in
and custom **Actions**. Built-in Actions cover Mind map, Report, Flashcards and
Quiz. Selecting an Action applies its Markdown instructions to the typed message,
or to relevant assistant knowledge and conversation context when the input is
empty. Successful sends clear the input; failed sends restore it. **Data table**
uses a separate modal for the topic, columns and filters and preserves any chat
draft. Results appear in chat.

In assistant detail, **Configuration** edits the assistant's
instructions and research settings. The adjacent **Models** tab contains
model selection, installed models, hardware advice and downloads. Model choices
persist independently of configuration edits. Website configuration appears above
file management in Knowledge; use **Import files** for PDF, DOCX, TXT and Markdown.
The installed application version appears below Settings in the main sidebar,
using Electron's current version with package metadata as the browser fallback.
Project template import/export remains available from the project actions.

Developer checks: `npm test`, `npm run typecheck` and `npm run desktop:build`.
After the desktop build, `npm run test:ui` runs the guest, project and workbench
flows against temporary SQLite stores (requires Playwright Chromium).
`node tests/template-api.mjs` and `npm run test:knowledge` verify the API flows
without a browser; Ollama responses are simulated in these tests.

## License

Original SIAAS Personal code is available under the [MIT License](LICENSE).
Copyright (c) 2026 Davide Abbatiello. Commercial use and modification are permitted
under the license terms. Third-party components and model weights keep their own
licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and the [dependency/asset audit](docs/licensing/audit-2026-10-24.md).

The canonical source repository is
[siaas-personal](https://github.com/siaas-software/siaas-personal).
The public website remains [siaas.vercel.app](https://siaas.vercel.app).

For compatibility with existing installations, internal `SIAAS_*` environment
variables, the `siaas-project-v1` template format, `siaas.sqlite`, and the Electron
user-data folder named `SIAAS` keep their existing names. The displayed product
name is SIAAS Personal; upgrading must reuse the same local workspace.

## Managed source distribution

`runtime.json` pins the official Node.js runtime for installed builds. Installation, startup, updates and rollback use explicit application-managed runtime paths without changing global Node.js or NVM. Current and previous compatible managed installations are retained. Legacy installations without runtime metadata require migration through the new installer and cannot be activated by managed rollback.

`npm run release:source` creates local source ZIP and installation-specification assets from a clean committed checkout; it never publishes a GitHub Release. A public stable release with these assets and SHA-256 digests is required for public installation. The public manifest no longer needs a private proxy or credentials. Prelaunch and release publication remain separate decisions.

<a id="funzionalità-sperimentali-opzionali"></a>
<a id="funzionalita-sperimentali-opzionali"></a>

### Optional experimental features

In **Settings → Experimental Features**, Advanced Reasoning (Beta) and Advanced Web Research (Beta) are independent and off by default. Both require a running, accessible and compatible Docker installation. Web discovery also requires consent in each assistant's research panel; documents and configured websites share a standard workflow without exclusive modes. **Refresh Status** never activates a feature automatically. Chat, local knowledge, configured websites and standard agents work without Docker. Existing preferences, websites and conversations are preserved. See the [English research guide](docs/research-en.md).

## Actions

Reusable local Markdown instructions with built-in Actions and a guided Ollama builder. Read the [English guide](docs/actions-en.md) or [Italian guide](docs/actions-it.md). Data Cell / Data table remains a separate native chat feature.

Open **Actions → ellipsis menu next to the title → Models** to choose one installed
global model for creating and editing custom Actions. The choice persists locally;
the builder is blocked if its model is missing or unavailable. Running an Action
in chat always uses that assistant's model. Built-in Actions are read-only and
cannot be deleted. See the [documentation language policy](docs/documentation-language.md)
for terminology and translation rules.

Run `npm run test:actions` for Actions unit tests. After `npm run desktop:build`, run `npm run test:actions:api` for the compiled HTTP/SQLite regression suite (Ollama fixture, not a real model).

## Migration from the previous release series

Existing v1.2.0 installations need a separate installation of SIAAS Personal v1.0.0; the old updater does not cross repositories. See the [English migration guide](docs/migration-en.md) or [Italian migration guide](docs/migration-it.md). Existing desktop data is preserved.

## Structured Data Analysis

Import local XLSX/CSV worksheets in assistant Knowledge, review mappings and
relationships, then ask Chat for traceable deterministic analysis. Includes
Production Planning and Personal Finance templates. No Docker, Python or external
database server is required. See [the guide](docs/structured-data-analysis.md)
for limits, formula handling, privacy and examples.

The template sync configuration may specify `templateIds` to adopt an explicit subset
of the pinned upstream catalog. Omit it to import the whole catalog; unknown or
duplicate IDs fail synchronization. This keeps unrelated template additions separate
from palette updates. Legacy official Production Planning and Personal Finance
default colors are resolved from the current snapshot when templates are read,
without rewriting saved template rows or existing projects. Custom colors remain intact.
