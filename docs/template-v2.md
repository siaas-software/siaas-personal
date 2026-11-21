# SIAAS project templates v2 — portable project chat

**Status:** Draft PR implementation, not released. This document describes the change
proposed from the SIAAS-FLOW-01 feature branch, not the published RC5 binary.

## Contract

The official catalog uses `version: 2`, bundles use
`format: "siaas-project-v2"`, and `project.orchestration` is included in the
portable project configuration:

```json
{
  "format": "siaas-project-v2",
  "project": {
    "name": "Example",
    "color": "#E9F0FA",
    "assistants": [
      { "name": "First", "instructions": "Analyze", "model": null, "sources": [] },
      { "name": "Second", "instructions": "Review", "model": null, "sources": [] }
    ],
    "orchestration": {
      "enabled": false,
      "instructions": "Coordinate work without granting new permissions.",
      "assistant_indices": [0, 1],
      "max_steps": 4,
      "share_results": false
    }
  }
}
```

`assistant_indices` is an ordered subset of zero-based indices in
`project.assistants`. The schema rejects duplicates, missing positions,
more than eight participants, invalid step budgets, unsupported fields and
enabling an empty/out-of-budget configuration. Input files never contain
runtime `assistant_ids`, chat history, documents, local paths, credentials or
embeddings. Public URL sources remain scoped to individual assistants.

On project creation or import, Personal creates assistant rows first and maps
indices to the new local UUIDs inside its existing project orchestration
contract. The coordinator remains deterministic, with no project-level model
or new permissions; each delegated task still uses the original assistant
execution pipeline / Hybrid Router. `enabled=false` and
`share_results=false` by default for all six official templates.

Project export and Save to Templates transform current authorized assistant
UUIDs back to portable indices. Export fails closed if an orchestration
participant no longer belongs to the exported project. Existing v1 bundles
remain importable, and a saved v1 template without orchestration produces a
disabled project. When re-exported, it uses v2 with disabled orchestration.

Built-in definitions are explicitly adopted by immutable source SHA through
`templates-source.json`. When upgrading from RC5, pristine, enabled built-in
template rows that exactly match the old official snapshot receive the v2
project-chat configuration automatically. User-edited templates and tombstones
remain unchanged. Existing projects, local documents, Knowledge, conversations
and other saved settings are not touched. The old RC5 snapshot is retained
solely to recognize an unmodified official seed; it is never offered as a new
built-in catalog.

## Source and test scope

- Upstream `siaas-software/siaas-templates`: six portable templates,
  catalog v2, builder checks, negative validation tests.
- Consumer `siaas-software/siaas-personal`: v1/v2 schemas,
  create/import/export/Save Template, local ID mapping, pinned catalog,
  deterministic scope and regression tests.
- Suggested gates: upstream `npm test`; Personal `npm run templates:check`,
  `npm test`, `npm run typecheck`, `npm run desktop:build`,
  `node tests/template-api.mjs`, `npm run test:projects`,
  `node --import tsx tests/project-chat-api.mjs` and relevant UI/E2E suites.
- Runtime acceptance, GitFlow merge, release tagging and publication are
  separate decisions. Do not infer PASS from static code review.
