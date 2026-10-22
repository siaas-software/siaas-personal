# Open Source & Licenses

In the desktop application, open **Settings → About → Open Source & Licenses**
The About section and license-reader controls are localized in the Italian
interface; the fixed **Settings** navigation label remains in English.

Each technology has a GitHub link and a **View License** action.
**View Third-Party Notices** opens an internal reader. Its document selector
includes the original MIT license, third-party notices, Laya and Morphic
Apache-2.0 licenses, and the Morphic adaptation notice. Escape or Close returns
to Settings. The original texts are displayed verbatim, in their original language.

The reader uses `/api/licenses` on the authenticated local desktop server.
It reads a fixed list of files from the installation, without contacting a website,
Ollama, Docker or any third-party service. GitHub links require Internet and use
the existing Electron HTTPS/domain allowlist and system-browser handling.

Source installations retain the tracked original files. Next.js file tracing
explicitly includes them in standalone builds; desktop packaging copies both the
standalone server and the existing license files into the application resources.
No copies of the long texts are maintained in React components.

## Verified versions

Laya 0.4.6 and the integrated Morphic revision are Apache-2.0. SIAAS
Personal remains MIT. The [verification record](license-verification.md)
identifies the package, upstream commits, notices and distribution boundaries.
The About descriptions show the actual service type and integrated version;
the Morphic adaptation notice remains available in the offline reader.

## Validation

```sh
npm run typecheck
npm test
npm run desktop:build
node tests/licenses-integration.mjs
npm run desktop:prepare
```

With a Playwright Chromium installation (or `CHROMIUM_PATH`), also run:

```sh
node tests/licenses-integration.mjs --ui
```

The UI check blocks every nonlocal browser request, opens Settings and all five
documents, checks Escape/focus restoration and a narrow viewport, then checks
the Italian interface. The integration check validates the actual standalone
responses against the source files and exercises Electron's existing external
navigation handlers with safe and unsafe URLs. Native packaged smoke tests still
need to be run on the corresponding Windows, macOS and Linux environments.
