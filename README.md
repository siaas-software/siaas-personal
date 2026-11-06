<p align="center">
  <img src="src/app/icon.svg" alt="SIAAS Personal logo" width="100">
</p>

<h1 align="center">SIAAS Personal</h1>

<p align="center">
  <strong>Your projects, your knowledge, your local AI assistants.</strong>
</p>

SIAAS Personal is a free, open-source, privacy-first desktop AI assistant platform.
It brings local AI models, documents and conversations into one workspace on your
computer. Use it to study, prepare reports and organize the information you need for
everyday work. Spreadsheet analysis is available in the release candidate,
as explained below.

[Get started from source](#getting-started) ·
[Installation from releases](#installation-from-releases) ·
[English documentation](https://siaas.vercel.app/documentation/en/introduction) ·
[Documentazione italiana](https://siaas.vercel.app/documentation/it/introduction) ·
[Latest stable release](https://github.com/siaas-software/siaas-personal/releases/latest)

<a id="product-principles"></a>

## Why SIAAS?

- **Keep your workspace local.** Your documents, conversations and retrieval data
  are stored on your computer. Local models run through Ollama.
- **Build around your tasks.** Give each assistant a purpose, instructions, its
  own model and the sources it needs.
- **Start without an account.** Normal use requires no SIAAS account, paid AI API
  or Docker installation.
- **Stay in control.** Choose models that fit your computer, inspect supporting
  sources and customize reusable templates. The code is available under MIT.

## Main Features

This README introduces **stable v1.0.0**, the latest published stable release.
The stable installer and updater exclude prereleases. Features in RC2 or
`develop` do not become stable simply because they appear in this repository's
documentation.

### Release availability

| Capability | Stable v1.0.0 | Published v1.1.0-rc.2 | Current develop (unreleased changes) |
| --- | --- | --- | --- |
| Projects, Assistants, local Ollama chat, Actions and Data Cell | Available | Available | Retained |
| Local document retrieval, embeddings and public web sources | Available | Available | Retained |
| Structured Data Analysis with bounded, deterministic calculations | Not included | Available | Retained |
| Automatic preparation of clear CSV/XLSX files | Not included | Available; ambiguities need confirmation | Retained |
| Bundled official templates | Computer Science Study, Home Gardening, Software Engineering | Computer Science Study, Production Planning, Personal Finance | Six templates listed below |
| Semantic template palette keys and compatibility handling | Not included | Not included | Integrated after RC2 |
| Optional Advanced Reasoning and Advanced Web Research Betas | Included; off by default, Docker required | Retained as optional Betas | Retained as optional Betas |

See the [stable release notes](https://github.com/siaas-software/siaas-personal/releases/tag/v1.0.0)
and [RC2 release notes](https://github.com/siaas-software/siaas-personal/releases/tag/v1.1.0-rc.2)
for the exact published scope and testing limitations. The current development
reference is [the develop README](https://github.com/siaas-software/siaas-personal/blob/develop/README.md).
Availability does not mean native, real-model or Docker acceptance has passed.

The following everyday features are included in **stable v1.0.0**:

| Feature | What you can do |
| --- | --- |
| Projects and Assistants | Organize a course, activity or project into assistants with distinct roles, instructions and conversations. |
| Knowledge and local retrieval | Import PDF, DOCX, TXT or Markdown, connect a folder, and ask questions supported by relevant passages. Scanned PDFs need OCR first. |
| Chat and AI assistance | Draft, explain, summarize and explore ideas with a local model. Compatible tool-capable models can also search sources and prepare reports. |
| Actions and Data Cell | Reuse instructions for reports, mind maps, flashcards and quizzes, or create custom Actions. Data Cell / Data table is a separate chat tool for requesting a table; it is not a spreadsheet calculation engine. |
| Templates | Start with prepared assistants, then personalize the project and select suitable models. |
| Models and Overview | Choose and download local models, see which are loaded, and inspect available computer resource readings. |

**In RC2**, you can also import CSV/XLSX in Knowledge and ask for totals,
comparisons or grouped results. Clear spreadsheets are prepared automatically;
ambiguous values, cached formula results and cross-file relationships can require
your confirmation. Ollama interprets the question; a bounded local engine
performs validated calculations and returns source evidence. This is separate
from semantic document retrieval and is not available in stable v1.0.0.

See [Optional Components](#optional-components) for the Docker-based Betas.

AI answers can be wrong. Review cited sources, data assumptions and important
conclusions; local execution does not guarantee answer quality.

## How It Works

**Project → Assistants → Optional Knowledge → Chat**

1. Create a project for an activity, or start from a template.
2. Give each assistant a role and instructions.
3. Open **Models**, select a suitable local model and allow any download to finish.
4. Optionally add files, a folder or public web sources in **Knowledge**.
5. Ask a question in **Chat** and inspect the evidence used in the answer.

SIAAS checks for a compatible Ollama service and reuses it where possible. If
Ollama is missing, it can offer a managed installation. Document retrieval uses
a separate local embedding model; adding Knowledge does not retrain your chat
model. Once the required software and models are ready, local chat and document
retrieval can work offline.

<a id="supported-platforms"></a>

## Requirements

### Platforms and hardware

The source distribution targets **Windows, macOS and Linux**, on **x64 and arm64**.
A graphical desktop is required for the Electron application. Platform support
is a distribution target, not a claim that every native OS/architecture
combination has passed acceptance testing; consult the selected release's notes.

Start with about **8 GB RAM and 10 GB free disk space** for small models; these
are practical starting recommendations, not guaranteed minimums for every model.
Larger models, source builds and optional modules can need more memory and disk.
A dedicated GPU is optional. Internet access is needed to install dependencies
and download runtimes, Ollama and models.

### Source development prerequisites

- **Node.js and npm:** [package.json](package.json) declares Node.js **>=22.16.0**.
  Use **Node.js 24.22.0**, the runtime pinned in [runtime.json](runtime.json), to
  match the distribution environment. Desktop packaging requires **Node.js 24+**
  for Zstandard support. Install npm with Node.js; no separate npm version is
  pinned by this repository.
- **Git:** required to clone the repository and select a branch or release tag.
- **Electron/native dependencies:** Linux needs Electron's system libraries and
  a graphical session. Dependencies that build native code may require your
  operating system's compiler toolchain. Follow normal OS security controls;
  do not bypass Gatekeeper, TLS verification or PowerShell execution policy.
- **Release bootstrap tools:** Windows uses PowerShell 5.1+ and archive tools;
  macOS/Linux use Bash, curl, tar, unzip and sha256sum or shasum. The managed
  release installer provisions its own Node.js/npm and does not require Git.

### Ollama and models

Local inference requires a compatible **Ollama 0.11.10 or later**, as recorded in
[the Ollama manifest](desktop/ollama-assets.json). SIAAS checks for an existing
local service and can offer a managed installation if Ollama is missing; you do
not need to preinstall it on architectures with a managed download or download
models before the first desktop launch. Managed downloads cover only the targets
listed in the manifest; other targets need a compatible external Ollama installation.
Choose a chat model for each assistant and allow its download to finish.
Document retrieval prepares a separate local embedding model when needed.
Model size and capabilities determine memory needs and available assistant tools.

## Optional Components

<a id="funzionalità-sperimentali-opzionali"></a>
<a id="funzionalita-sperimentali-opzionali"></a>
<a id="optional-experimental-features"></a>

Advanced Reasoning (Beta) and Advanced Web Research (Beta) are independent optional
features, disabled by default. Both require Docker and additional resources.
Docker is not required for normal chat, local Knowledge or standard assistants.

For configuration, prerequisites, privacy and troubleshooting, see the official
research guides:

- [Research guide — English](https://siaas.vercel.app/documentation/en/research)
- [Guida alla ricerca — Italiano](https://siaas.vercel.app/documentation/it/research)

<a id="quick-start"></a>
<a id="development"></a>

## Getting Started

### From source

With the [requirements](#requirements) installed, clone, build and launch the
desktop application:

```bash
git clone --branch develop https://github.com/siaas-software/siaas-personal.git
cd siaas-personal
npm ci
npm run desktop:dev
```

**develop contains unreleased changes**, including the six-template catalog and
semantic palettes. For the exact stable v1.0.0 code, run
`git switch --detach v1.0.0` after cloning and **before** `npm ci` and
`npm run desktop:dev`. The release matrix above describes which features are
included in each channel. Keep development test data separate from valuable work.

`desktop:dev` builds the desktop runtime and launches Electron. It is not a
hot-reload server: run it again after source changes. **`npm run dev` alone is
not the Electron application**; the web-only entry point does not provide the
desktop workspace.

A manual source checkout uses your development tools. A managed release
installation downloads a published source release, provisions its own runtime
and builds it for you; a manual checkout does not inherit that managed update
setup. See [Installation from Releases](#installation-from-releases) for that
workflow.

For everyday use, follow the [first conversation walkthrough](https://siaas.vercel.app/documentation/en/quickstart).
Start with one assistant and a small set of documents; Knowledge is optional.

### Development checks

For application changes, run:

```bash
npm test
npm run typecheck
npm run build
npm run desktop:build
```

Run the relevant targeted regressions as well. For changes to real local AI
behavior, use `npm run ollama:test` with a working local Ollama service and the
required models. Documentation-only changes need Markdown, link and factual
consistency checks; application builds are unnecessary.

Automated tests can use simulated inference and services; passing them does not
establish native installation, real-model or Docker Beta acceptance. Those checks
need their actual environments. Maintainer details, including template
synchronization, are in [the develop developer reference](https://github.com/siaas-software/siaas-personal/blob/develop/docs/developer-reference.md);
it describes development code, not the stable release.

<a id="installation"></a>

## Installation from Releases

For the managed release workflow, see [Get started](https://siaas.vercel.app/get-started)
and the [installation guide](https://siaas.vercel.app/documentation/en/installation).

The supported public distribution is a **source installer**: it downloads verified
release files, provisions an application-managed Node.js runtime, builds the app
and creates a launcher. There is no separate published EXE or DMG installer.
You do not need a global Node.js, npm or Git installation for this route.

Stable v1.0.0 publishes PowerShell/Bash scripts, a named source ZIP, an installation
specification and SHA-256 checksums. Use these named release assets rather than
GitHub's automatically generated source archives. The installer provisions the
pinned Node.js 24.22.0 runtime without changing global Node.js or NVM.

Review the official script before running it. Use a normal terminal and follow
your operating system's security controls.

**Windows — PowerShell:**

```powershell
irm https://siaas.vercel.app/install.ps1 | iex
```

**macOS or Linux — Terminal:**

```bash
curl -fsSL https://siaas.vercel.app/install.sh -o install-siaas.sh
bash install-siaas.sh
```

Open **SIAAS Personal** from the Windows Start menu or Linux application menu.
On macOS, open `~/Applications/SIAAS Personal.command`.

These commands select the **stable channel** through the public website's
download service. They need Internet access and a reachable service. If that
service is unavailable, consult the [v1.0.0 assets and notes](https://github.com/siaas-software/siaas-personal/releases/tag/v1.0.0);
do not disable integrity checks or substitute automatic source archives.

**Release candidate:** follow the instructions attached to
[v1.1.0-rc.2](https://github.com/siaas-software/siaas-personal/releases/tag/v1.1.0-rc.2).
Download and inspect `install-rc.ps1` (Windows) or `install-rc.sh` (macOS/Linux),
verify its published SHA-256 digest, and explicitly set
`SIAAS_RELEASE_TAG=v1.1.0-rc.2` before running it. Stable install scripts do not
select RC2, even when downloaded from its release page. The default RC installation
and data profile are separate from stable; do not override them to share stable
data. Inspect and back up an existing RC before updating it.

### Updates and existing workspaces

Use **Settings → Application updates** for stable updates. Back up the complete
data directory with the app closed, and back up linked originals separately.
Rollback restores an application version, not an earlier database. The supplied
uninstall scripts remove launcher registration while preserving versions and data.
See [installation and recovery](docs/installation-en.md) and the
[migration guide](docs/migration-en.md) for existing installations.

The previous repository's v1.2.0 updater does not switch to this repository.
Follow the migration guide for a separate v1.0.0 installation and preserve your
data backup; never run both installations against the same profile.

## Templates

Stable v1.0.0 bundles **Computer Science Study**, **Home Gardening** and
**Software Engineering**. RC2 instead bundles **Computer Science Study**,
**Production Planning** and **Personal Finance**.

### Six-template development catalog

The [official catalog](https://github.com/siaas-software/siaas-templates) provides
these six starting points. The complete bundled catalog and semantic palette
support below require a **development build**; they are not included in stable
v1.0.0 or published RC2:

| Template | Useful for | Palette |
| --- | --- | --- |
| Computer Science Study | Learning programming, algorithms and TypeScript with focused tutors. | Sky |
| Production Planning | Comparing orders, inventory, bills of materials and material requirements. | Slate |
| Personal Finance | Reviewing transactions, budgets and savings while keeping currencies separate. | Mint |
| Construction Cost Analysis | Comparing construction estimates, bills of quantities and cost variances. | Peach |
| Technical Documentation | Finding evidence in technical documents and drafting reports or site minutes for review. | Lavender |
| Materials & Procurement | Comparing material lists, supplier quotations and procurement gaps. | Aqua |

In your installed version, open **Templates**, choose **Use template**, then select
the models for its assistants and add your own sources. You can also import an
official downloadable template file or save and share your own project
configuration. No JSON editing is needed.

Templates include instructions and any configured public website addresses; they
do not include your documents, conversations or installed models. Review text and
URLs before sharing. Existing projects and customized templates are preserved
when the bundled catalog changes. Importing a newer template does not add its
required application features:
stable v1.0.0 cannot perform Structured Data Analysis. Older releases use fallback
hex colors rather than the new semantic palette keys.

These presets help organize and analyze your inputs. They do not supply missing
data, optimize production schedules automatically, or replace professional review
of financial or construction decisions.

<a id="local-ai-and-models"></a>

## Privacy and Local AI

Local inference, embeddings and workspace storage run on your computer. No paid
cloud inference provider is required. Protect your operating-system account and
backups: local storage is not a promise of encrypted storage.

Network access still occurs when you install or update software, download models,
import or refresh a web source, or consult configured websites. Some study
templates include public URLs that are fetched when their sources are prepared.
Optional Advanced Web Research sends search queries derived from the current
question to external search services. Its privacy filters are not guaranteed
anonymization; avoid confidential questions when enabling discovery.

For the distinction between saved web sources, configured websites and optional
discovery, read [sources and research](docs/research-en.md). For backups, see
[local data](https://siaas.vercel.app/documentation/en/data).

## Documentation

- **User guides:** [English](https://siaas.vercel.app/documentation/en/introduction)
  and [Italiano](https://siaas.vercel.app/documentation/it/introduction).
- **Installation and troubleshooting:** [public guide](https://siaas.vercel.app/documentation/en/installation)
  and [troubleshooting](https://siaas.vercel.app/documentation/en/troubleshooting).
- **Stable feature details:** Actions ([EN](docs/actions-en.md) / [IT](docs/actions-it.md))
  and optional research ([EN](docs/research-en.md) / [IT](docs/research-it.md)).
- **Installation and migration:** installation ([EN](docs/installation-en.md) /
  [IT](docs/installation-it.md)) and migration ([EN](docs/migration-en.md) /
  [IT](docs/migration-it.md)).
- **RC2 spreadsheet analysis:** [release-specific guide](https://github.com/siaas-software/siaas-personal/blob/v1.1.0-rc.2/docs/structured-data-analysis.md).
  It describes prerelease functionality, not stable v1.0.0.
- **Release availability:** [stable release](https://github.com/siaas-software/siaas-personal/releases/latest)
  and [all releases and candidates](https://github.com/siaas-software/siaas-personal/releases).

Repository guides can retain historical prelaunch and validation notes; those
are not a live service-status report. Check the selected release's notes for
availability, especially when website guides discuss newer features.

<a id="open-source-and-contributing"></a>

## Contributing and License

Bug reports, documentation improvements and code contributions are welcome.
Include your OS, application version, reproduction steps and a sanitized error
message when [reporting a problem](https://github.com/siaas-software/siaas-personal/issues).
See [CONTRIBUTING.md](CONTRIBUTING.md) for GitFlow and pull request requirements.

### License

Original SIAAS Personal code is licensed under the [MIT License](LICENSE).
Copyright © 2026 Davide Abbatiello. Third-party components, model weights and
referenced websites retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md)
and [open-source licenses](docs/open-source-licenses.md).
