# Third-party notices

Original SIAAS Personal code is licensed under the [MIT License](LICENSE).
Third-party software, dependencies and model weights retain their own licenses;
the root MIT license does not replace those terms.

- **Morphic research adapter (Advanced Web Research):** the SIAAS-specific
  adaptation in `services/morphic` is based on
  [miurla/morphic](https://github.com/miurla/morphic) at
  `62e0816b019c5543ccc280c40ec1f020d5af4669`, by Yoshiki Miura and
  contributors. The upstream work is Apache-2.0; the adapted files preserve
  its copyright and modification notice. See the distributed
  [Apache-2.0 license](services/morphic/LICENSE) and
  [adaptation notice](services/morphic/NOTICE). This is a local Node adapter,
  not the full upstream application or an official Morphic API. Its optional
  search backend is a separate SearXNG Docker service.
- **Laya (Advanced Reasoning):** `services/laya/app.py` is SIAAS's own
  adapter that imports the unmodified `laya==0.4.6` Python package while
  building a local Docker image. Upstream:
  [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya), developed by
  Convai Innovations and contributors, Apache-2.0. The corresponding
  [license text](services/laya/LICENSE) is included with the service image.
  Its multilingual model checkpoint is downloaded from
  [convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya)
  on first use; the published model card identifies Apache-2.0. Preserve
  package, checkpoint and dependency notices when redistributing an image
  containing them.
- **SearXNG:** the optional research stack uses a separately deployed SearXNG
  service under its upstream AGPL license. Preserve its notices and satisfy the
  applicable source obligations when modifying or distributing that component.
- **Ollama model weights:** their respective authors' terms remain applicable.
- **Node.js, Electron, Ollama and package dependencies:** preserve the notices
  provided with their distributions. Desktop packaging includes the official
  Node.js license with the private runtime and retains generated legal comments.

This is a record of the main bundled and optional components, not a replacement
for their license texts or a complete dependency audit.

The independent SIAAS Personal project is not sponsored, endorsed or officially
affiliated with these upstream projects. Apache-2.0 redistribution requires
retaining applicable license and copyright notices, marking modified files,
and carrying upstream NOTICE attribution when an upstream NOTICE exists.
Neither integrated upstream revision contains a root NOTICE file; the Laya
0.4.6 wheel also contains no NOTICE. The Morphic NOTICE shipped here is SIAAS
modification attribution, not a copied upstream NOTICE. The optional Morphic
Docker image retains LICENSE and NOTICE beside the bundled service.

See the dated [license verification record](docs/license-verification.md) for
exact revisions, artifact hashes, inspected sources and remaining uncertainty.
Later upstream license changes do not retroactively determine these versions.

## Dependency, font and asset inventory (24 October 2026)

See the [dated audit](docs/licensing/audit-2026-10-24.md),
[application lock inventory](docs/licensing/dependency-inventory.json) and
[optional Morphic inventory](docs/licensing/morphic-dependency-inventory.json).
These include development tools and platform alternatives; they are not a bill
of materials for every final executable.

DM Sans and Manrope use OFL-1.1; their exact copyright/license texts are retained
in `docs/licensing/notices/`. Lucide 1.49.0 includes ISC and Feather MIT attribution;
both are retained there. Sharp/libvips native distributions carry additional
LGPL and component-specific obligations. AI model weights retain their own terms.

Structured Data Analysis remains draft PR #4. Its ExcelJS, Papa Parse, Decimal.js
and Yauzl additions are MIT, but the audit flags unresolved transitive package
provenance and artifact-specific redistribution checks. The application MIT
license neither resolves those findings nor grants rights to third-party assets.
