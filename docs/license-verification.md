# Laya and Morphic license verification

Verified 2026-10-19. Original SIAAS Personal code remains MIT; the root
`LICENSE` is unchanged. This record concerns these integrations, not a full
audit of all transitive packages or model weights.

## Laya: the installed artifact, not just current upstream

- `services/laya/requirements.txt` installs `laya==0.4.6` from PyPI when the
  user builds the optional Docker service. `app.py` is SIAAS's own adapter
  importing the unmodified package; SIAAS does not vendor Laya Python sources.
- [PyPI 0.4.6 metadata](https://pypi.org/pypi/laya/0.4.6/json) identifies
  Apache-2.0 and author Convai Innovations. The inspected wheel is
  `laya-0.4.6-py3-none-any.whl`, SHA-256
  `93fab7677aab9cb71cd4f9cb4477e334618f85ccdff684520a5dd144c3316a88`.
- Its `laya-0.4.6.dist-info/licenses/LICENSE` matches
  `services/laya/LICENSE` byte for byte (SHA-256
  `a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9`).
  The wheel contains no NOTICE file. The license has no project-specific
  copyright statement to invent; attribution follows the package author.
- Upstream [v0.4.6](https://github.com/NandhaKishorM/laya/tree/c73908d96ff73c0062c340a11bf7c54ec7d8bc4d)
  declares version 0.4.6 and Apache-2.0 in `pyproject.toml`; its root LICENSE
  is identical. No NOTICE is present in that recursive tree. Unrelated
  benchmark data licenses do not describe the installed Python wheel.
- Current upstream was inspected at
  `ffc142012af63d015fa19f05f29f9c5ff329a2cc`: the same root LICENSE blob,
  `d9a10c0d8e868ebf8da0b3dc95bb0be634c34bfe`, remains Apache-2.0.

The Laya Dockerfile includes the license at `/service/LICENSE`; pip retains
the package's distribution metadata. Anyone redistributing a built image must
also preserve applicable package and dependency notices. Model checkpoints
are downloaded separately at first use, not distributed in SIAAS source.
The [publisher's model card](https://huggingface.co/convaiinnovations/laya)
at `7b928d828b7b0e022f929d9bd2e44165aa270148` identifies Apache-2.0 and its
file listing has no LICENSE or NOTICE. The integration does not pin a model
revision, so this record cannot establish the exact revision or terms of
every existing cache or future download. Inspect that artifact before
redistributing it; no checkpoint or dependency version was changed here.

## Morphic: a redistributed adaptation

- `services/morphic/researcher.mjs` identifies its origin as
  [miurla/morphic revision 62e0816b019c5543ccc280c40ec1f020d5af4669](https://github.com/miurla/morphic/tree/62e0816b019c5543ccc280c40ec1f020d5af4669),
  `lib/agents/researcher.ts`. SIAAS distributes an adapted headless researcher,
  not the full upstream application. It normally runs as a local Node service;
  SearXNG is a separate Docker search backend. A Morphic Dockerfile also exists.
- That revision's [LICENSE](https://github.com/miurla/morphic/blob/62e0816b019c5543ccc280c40ec1f020d5af4669/LICENSE)
  is Apache-2.0, including `Copyright 2024 Yoshiki Miura`; the bundled
  `services/morphic/LICENSE` is identical. No NOTICE file exists in the
  inspected recursive tree, and the researcher source has no additional
  copyright header. No unrelated upstream notices have been imported.
- Current upstream was inspected at `a95b1d7aa17f729fd8cae7e9896fa8d32b76989d`:
  its LICENSE is the same blob, `8a29bc5a40f9404d6df8700c06babe22d5225cc4`.
  This comparison does not assume current licensing applies to older code.

Retain the full license, Yoshiki Miura attribution and prominent modification
notice with redistributed source and bundles. `services/morphic/NOTICE` is
SIAAS's adaptation record, not an upstream NOTICE requirement. The researcher
carries a legal comment preserved by esbuild; the Dockerfile copies LICENSE
and NOTICE into the final image. Existing standalone and desktop packaging
retain the license and notice files, accessible through the offline reader.

## Scope and reproducibility

The public website describes the integrations and links their licenses; it
does not embed or execute either upstream project. App, English/Italian site
pages and research documentation identify the same integrated versions.
The record establishes license identity and notice handling for the sources
and wheel inspected above, not historical artifacts that were not supplied.
No Docker images were published, dependencies upgraded, integration behavior
changed, or SIAAS code relicensed.
