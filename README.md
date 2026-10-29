# SIAAS Personal

<img src="src/app/icon.svg" alt="SIAAS hand and green stars" width="88">

**Your projects, your knowledge, your local AI assistants.**

SIAAS Personal is a free, open-source, privacy-first desktop AI assistant platform.
It brings local AI models, documents and conversations into one workspace on your
computer. Use it to study, prepare reports, explore spreadsheets or organize the
information you need for everyday work.

[Get started](https://siaas.vercel.app/get-started) ·
[English documentation](https://siaas.vercel.app/documentation/en/introduction) ·
[Documentazione italiana](https://siaas.vercel.app/documentation/it/introduction) ·
[Latest stable release](https://github.com/siaas-software/siaas-personal/releases/latest)

## Why SIAAS?

- **Keep your workspace local.** Your documents, conversations and retrieval data
  are stored on your computer. Local models run through Ollama.
- **Build around your tasks.** Give each assistant a purpose, instructions, its
  own model and the sources it needs.
- **Start without an account.** Normal use requires no SIAAS account, paid AI API
  or Docker installation.
- **Stay in control.** Choose models that fit your computer, inspect supporting
  sources and customize reusable templates. The code is available under MIT.

## Main features

This README describes the current `develop` branch. **Release availability is
separate:** the stable installer selects the latest stable release. Structured
Data Analysis and automatic spreadsheet preparation are available in the published
release candidate; the six-template catalog and semantic palettes were integrated
after that candidate and currently require a development build. Check the
[release notes](https://github.com/siaas-software/siaas-personal/releases) for the
features included in the version you install.

| Feature | What you can do |
| --- | --- |
| Projects and Assistants | Organize a course, activity or project into assistants with distinct roles, instructions and conversations. |
| Knowledge and local retrieval | Import PDF, DOCX, TXT or Markdown, connect a folder, and ask questions supported by relevant passages. Scanned PDFs need OCR first. |
| Chat and AI assistance | Draft, explain, summarize and explore ideas with a local model. Compatible tool-capable models can also search sources and prepare reports. |
| Structured Data Analysis | Import CSV/XLSX and ask for totals, comparisons or grouped results. Clear files are prepared automatically; ambiguous values and cross-file relationships need your confirmation. Calculations run through a bounded local engine with source evidence. |
| Actions and Data Cell | Reuse instructions for reports, mind maps, flashcards and quizzes, or create custom Actions. Data Cell / Data table is a separate chat tool for requesting a table; it does not replace verified spreadsheet calculations. |
| Templates | Start with prepared assistants, then personalize the project and select suitable models. |
| Models and Overview | Choose and download local models, see which are loaded, and inspect available computer resource readings. |

**Advanced Reasoning (Beta)** and **Advanced Web Research (Beta)** are independent,
optional modules, off by default. Their supported stacks require Docker; web
discovery also requires consent for the individual assistant. See the
[research guide](docs/research-en.md) before enabling them.

AI answers can be wrong. Review cited sources, data assumptions and important
conclusions; local execution does not guarantee answer quality.

## How it works

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

## Getting started

Use the [installation guide](https://siaas.vercel.app/documentation/en/installation)
and [first conversation walkthrough](https://siaas.vercel.app/documentation/en/quickstart).
Start with one assistant and a small set of documents. Knowledge is optional.

### Installation

The supported public distribution is a **source installer**: it downloads verified
release files, provisions an application-managed Node.js runtime, builds the app
and creates a launcher. There is no separate published EXE or DMG installer.
You do not need a global Node.js, npm or Git installation for this route.

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

These commands select the **stable channel**. To test a release candidate, use
the explicit RC installer and instructions attached to that
[prerelease](https://github.com/siaas-software/siaas-personal/releases).
Candidates use a separate installation and data profile. A development build can
contain changes that have not yet been released.

### Updates and existing workspaces

Use **Settings → Application updates** for stable updates. Back up the complete
data directory with the app closed, and back up linked originals separately.
Rollback restores an application version, not an earlier database. The supplied
uninstall scripts remove launcher registration while preserving versions and data.
See [installation and recovery](docs/installation-en.md) and the
[migration guide](docs/migration-en.md) for existing installations.

## Templates

The [official catalog](https://github.com/siaas-software/siaas-templates) provides
these six starting points, adopted by the current development branch:

| Template | Useful for | Palette |
| --- | --- | --- |
| Computer Science Study | Learning programming, algorithms and TypeScript with focused tutors. | Sky |
| Production Planning | Comparing orders, inventory, bills of materials and material requirements. | Slate |
| Personal Finance | Reviewing transactions, budgets and savings while keeping currencies separate. | Mint |
| Construction Cost Analysis | Comparing construction estimates, bills of quantities and cost variances. | Peach |
| Technical Documentation | Finding evidence in technical documents and drafting reports or site minutes for review. | Lavender |
| Materials & Procurement | Comparing material lists, supplier quotations and procurement gaps. | Aqua |

Open **Templates**, choose **Use template**, then select the models for its
assistants and add your own sources. You can also import an official downloadable
template file or save and share your own project configuration. No JSON editing
is needed.

Templates include instructions and any configured public website addresses; they
do not include your documents, conversations or installed models. Review text and
URLs before sharing. Existing projects and customized templates are preserved
when the bundled catalog changes. Older releases may contain fewer templates
and may use fallback colors when importing newer definitions.

These presets help organize and analyze your inputs. They do not supply missing
data, optimize production schedules automatically, or replace professional review
of financial or construction decisions.

## Privacy and local AI

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

## Supported platforms

The source distribution targets **Windows, macOS and Linux**, on **x64 and arm64**.
Platform support is a distribution target, not a claim that every native
OS/architecture combination has passed acceptance testing; consult the selected
release's notes and testing limitations.

- Start with about **8 GB RAM and 10 GB free disk space** for small models; larger
  models and optional modules require more. A dedicated GPU is optional.
- Windows needs PowerShell 5.1 or later and archive tools.
- macOS/Linux need Bash, curl, tar, unzip and sha256sum or shasum. Linux also needs
  a graphical desktop and Electron's system libraries. Native builds may need
  compiler tools.
- Internet is needed for installation and initial model downloads.

## Documentation

- **User guides:** [English](https://siaas.vercel.app/documentation/en/introduction)
  and [Italiano](https://siaas.vercel.app/documentation/it/introduction).
- **Installation and troubleshooting:** [public guide](https://siaas.vercel.app/documentation/en/installation)
  and [troubleshooting](https://siaas.vercel.app/documentation/en/troubleshooting).
- **Feature details:** [Structured Data Analysis](docs/structured-data-analysis.md),
  [Actions](docs/actions-en.md), and [optional research](docs/research-en.md).
- **Release availability:** [stable release](https://github.com/siaas-software/siaas-personal/releases/latest)
  and [all releases and candidates](https://github.com/siaas-software/siaas-personal/releases).

## Open source and contributing

Bug reports, documentation improvements and code contributions are welcome.
Include your OS, application version, reproduction steps and a sanitized error
message when [reporting a problem](https://github.com/siaas-software/siaas-personal/issues).
See [CONTRIBUTING.md](CONTRIBUTING.md) for GitFlow and pull request requirements.

### Development

From a computer with Git, a graphical desktop and the Node.js version required by
[package.json](package.json):

```bash
git clone --branch develop https://github.com/siaas-software/siaas-personal.git
cd siaas-personal
npm ci
npm run desktop:dev
```

`desktop:dev` builds and launches Electron; run it again after source changes.
The web-only `npm run dev` entry point does not provide the desktop workspace.
For application changes run `npm test`, `npm run typecheck`, `npm run build` and
`npm run desktop:build`, plus relevant regressions. For documentation changes,
check Markdown, links and factual consistency. Maintainer details, including
template synchronization, are in [the developer reference](docs/developer-reference.md).

## License

Original SIAAS Personal code is licensed under the [MIT License](LICENSE).
Copyright © 2026 Davide Abbatiello. Third-party components, model weights and
referenced websites retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md)
and [open-source licenses](docs/open-source-licenses.md).
