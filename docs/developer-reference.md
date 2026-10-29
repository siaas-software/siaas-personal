# SIAAS Personal developer reference

Scope: implementation and maintainer procedures relocated from the public README.
Verified: 2026-10-29 against develop `e35eeaa9cd0a315b67a6de6c0d9521947912ae5e`.
These procedures do not authorize publication or establish native acceptance.
For contributor workflow see [CONTRIBUTING](../CONTRIBUTING.md); for everyday use
start with the [README](../README.md).

## Local workspace and compatibility

### Local filesystem organization

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

## Shared template catalog

Template definitions are maintained in [siaas-templates](https://github.com/siaas-software/siaas-templates). This repository consumes a generated snapshot pinned in `templates-source.json`; edit the source repository, not `src/generated/`. The app preserves users’ saved templates and deletions. The website adopts its own pinned snapshot; it may lag behind the application. The current snapshot contains the six templates listed in the README. Retired built-in presets are hidden from the catalog; existing projects and user-saved templates are preserved.

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

## Knowledge and chat workspace

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

## Six official templates and semantic palettes

The pinned snapshot adopts Computer Science Study (`sky`), Production Planning
(`slate`), Personal Finance (`mint`), Construction Cost Analysis (`peach`), Technical
Documentation (`lavender`), and Materials & Procurement (`aqua`). The source is
`siaas-software/siaas-templates`; `templates-source.json` records its immutable SHA,
explicit adopted IDs, raw catalog SHA-256 and generated output SHA-256. Synchronize
with `npm run templates:sync -- --ref <sha> --catalog <checkout>/catalog.json`, then
run `npm run templates:check`. The local catalog must come from that exact commit.
Repeated synchronization produces identical output. Unknown/duplicate selected IDs
and unknown palette keys fail before replacing the snapshot. Omit `templateIds`
to adopt a whole catalog.

`project.palette` is an optional, validated extension to `siaas-project-v1`.
`PROJECT_PALETTES` in `src/lib/project-colors.ts` remains the sole palette-value
registry. A semantic key takes precedence over the required legacy hex fallback
when importing, displaying, exporting or instantiating a template. Cards and the
New project preview share a resolver; text and secondary labels use foreground,
while button borders and focus indicators use accent. Custom hex backgrounds get
a contrasting foreground without replacing their stored color.

Legacy bundles without a semantic key remain importable. Saved built-ins without
one gain it on read only when their color matches the current official default or
the historical Production Planning/Personal Finance defaults. Other custom colors,
assistant settings, Knowledge URLs and deletion tombstones remain intact. There
are no database migrations or saved-row rewrites: the existing SQLite JSON body
can store the optional template field. Startup seeds only missing built-ins.

New projects store the resolved background hex, without a palette key. Existing
projects retain their exact stored colors and configurations; the ordinary palette
selector and existing project display behavior are unchanged. Saving/exporting a
project uses its current hex, so later color edits cannot be overridden by an old
template key. Template exports retain both the semantic key and a resolved legacy
hex for older consumers.

## Managed source distribution

`runtime.json` pins the official Node.js runtime for installed builds. Installation, startup, updates and rollback use explicit application-managed runtime paths without changing global Node.js or NVM. Current and previous compatible managed installations are retained. Legacy installations without runtime metadata require migration through the new installer and cannot be activated by managed rollback.

`npm run release:source` creates local source ZIP and installation-specification assets from a clean committed checkout; it never publishes a GitHub Release. A public stable release with these assets and SHA-256 digests is required for public installation. The public manifest no longer needs a private proxy or credentials. Prelaunch and release publication remain separate decisions.

### Optional experimental features

In **Settings → Experimental Features**, Advanced Reasoning (Beta) and Advanced Web Research (Beta) are independent and off by default. Both require a running, accessible and compatible Docker installation. Web discovery also requires consent in each assistant's research panel; documents and configured websites share a standard workflow without exclusive modes. **Refresh Status** never activates a feature automatically. Chat, local knowledge, configured websites and standard agents work without Docker. Existing preferences, websites and conversations are preserved. See the [English research guide](research-en.md).


## Compatibility identifiers and validation

Internal `SIAAS_*` variables, `siaas-project-v1`, `siaas.sqlite` and the Electron
user-data folder named `SIAAS` preserve compatibility. The displayed product name
is SIAAS Personal. Do not rename storage identifiers during editorial changes.

Use `npm run desktop:build` before the real HTTP/SQLite regression suites:
`npm run test:knowledge`, `npm run test:chat`, `npm run test:actions:api`,
`npm run test:structured:api` and `node tests/template-api.mjs`.
These suites use simulated inference and do not establish real Ollama acceptance.
Browser suites need an available Playwright browser; native platform acceptance
and actual model tests remain separate. See [AGENTS.md](../AGENTS.md) and the
[release publication evidence](releases/1.1.0-rc.2-publication.md) for scope.

## Public reference synchronization

The website has a separately generated English reference and an Italian page
linking to it. Follow [the language/synchronization policy](documentation-language.md)
in a dedicated site PR. A README commit does not update or deploy that site.
