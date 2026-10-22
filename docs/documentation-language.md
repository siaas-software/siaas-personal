# Documentation language and terminology

Root README files and unqualified maintainer documents use English. Files ending
in `-en.md` and the public site's `content/docs/en/` tree use English; `-it.md`
and `content/docs/it/` use Italian. Language selectors intentionally show both
languages. The Italian technical-reference page explicitly links to English.

## Product terminology

| Concept | English prose | Italian prose |
| --- | --- | --- |
| Project | project / Projects | progetto / progetti |
| Assistant | assistant / Assistants | assistente / assistenti |
| Action | Action / Actions | Action / Actions |
| Model | model / Models | modello / Modelli |
| Knowledge | Knowledge / knowledge sources | conoscenza / fonti di conoscenza |
| Advanced Reasoning | Advanced Reasoning (Beta) | Ragionamento avanzato (Beta) |
| Advanced Web Research | Advanced Web Research (Beta) | Ricerca web avanzata (Beta) |

Use exact interface labels when giving navigation instructions. Some labels are
fixed in English even in the Italian interface: Projects, Actions, Templates,
Knowledge, Overview and Settings. The global Actions model page is labelled
Models; the assistant model tab is localized as Modelli. Italian guides may
explain these labels in Italian without renaming the actual controls. Built-in
Action names (Mind map, Report, Flashcards and Quiz) remain unchanged.

Do not translate commands, examples, filenames, API identifiers, environment
variables, product names, legacy anchor IDs, diagnostic output or historical
test evidence. Preserve license texts, copyright statements and third-party
legal notices verbatim. Historical implementation reports describe their test
date and must not be rewritten as evidence of current test results.

## Public documentation synchronization

In `siaas-public-site`, run the official script after reviewing this README:

```sh
npm run docs:sync -- --readme ../siaas-personal/README.md
npm run docs:check
```

Commit `content/docs/en/reference.md` and `docs-source.json` together. Never edit
the generated reference manually. The metadata records the source repository,
path and SHA-256 hashes of the README and generated output. Installation and
research guides are maintained copies in both repositories; keep each language
pair aligned and use absolute repository links on the public site.

The documentation index controls both languages' navigation and reading order.
Update its translated titles when a guide changes, preserve route slugs and
existing anchor targets, and verify local links in both source Markdown and the
rendered site. Keep the prelaunch indexing configuration unchanged.
