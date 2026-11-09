# Contract validation and golden fixtures

Normative design data only. No runtime adapter, source manager or installer is changed.
JSON Schema Draft 2020-12 is used with an offline registry (no network resolution).
Run from repository root with Python and `jsonschema==4.26.0` available; no application
lockfile or dependency installation is required. `referencing` is jsonschema's resolver.
The identifiers under schemas.siaas.invalid are opaque local schema IDs.

The [fixture index](fixtures/index.json) records expected schema/parser outcomes.
[Semantic scenarios](fixtures/semantic-scenarios.json) describe future engine/native
acceptance and are deliberately NOT RUN. Fixtures use invented identities, hashes and
paths; they are not authentic installation inputs. Supported capability fixtures are
hypothetical, not a support claim for this workspace or RC3.

Extract the following Python block to a temporary file and run it from the repository
root. It checks all schemas against the metaschema, resolves references locally and
validates every indexed valid/invalid fixture, including strict JSON transport rejection.
No files are changed by the validator. Expected result: 8 schemas, 48 valid, 29 invalid,
12 parser negatives; every expected outcome PASS.

```python
import json,pathlib,re,sys,importlib.metadata
from jsonschema import Draft202012Validator
from referencing import Registry,Resource
root=pathlib.Path('docs/design/installer-adapter-v1')
def strict(raw,limit=65536):
 if len(raw)>limit:raise ValueError('size limit')
 if raw.startswith(b'\xef\xbb\xbf'):raise ValueError('BOM')
 def pairs(items):
  d={}
  for k,v in items:
   if k in d:raise ValueError('duplicate key')
   d[k]=v
  return d
 def bad(s):raise ValueError('non-finite number')
 data=json.loads(raw.decode('utf-8'),object_pairs_hook=pairs,parse_constant=bad)
 def depth(x,n=0):
  if isinstance(x,str) and any(0xD800<=ord(c)<=0xDFFF for c in x):raise ValueError("surrogate")
  if isinstance(x,(dict,list)):
   if n>=32:raise ValueError('depth')
   for v in (list(x.keys())+list(x.values()) if isinstance(x,dict) else x):depth(v,n+1)
 depth(data)
 return data
schemas={p.stem.replace('.schema',''):json.loads(p.read_text()) for p in (root/'schemas').glob('*.json')}
registry=Registry().with_resources((s['$id'],Resource.from_contents(s)) for s in schemas.values())
for s in schemas.values():Draft202012Validator.check_schema(s)
counts={'valid':0,'invalid':0,'parser':0}
for case in json.loads((root/'fixtures/index.json').read_text()):
 raw=(root/'fixtures'/case['file']).read_bytes()
 try:
  data=strict(raw)
  if case['layer']=='parser':ok=True
  else:ok=not list(Draft202012Validator(schemas[case['schema']],registry=registry).iter_errors(data))
 except (ValueError,UnicodeError):ok=False
 assert ok==case['valid'],case['file']
 counts['parser' if case['layer']=='parser' else ('valid' if ok else 'invalid')]+=1
print('PASS schemas',len(schemas),'fixtures',counts,'jsonschema',importlib.metadata.version('jsonschema'))

```

## Validation coverage and limits

Schemas reject unknown fields at every object level, unknown capabilities, unsupported
operations/versions, malformed UUID/hash/path forms, host IDs, missing transaction IDs,
incorrect per-operation fields, invalid error/exit pairs, success receipts with errors,
GUI launch flags, missing installed-file hashes and malformed journal fields.
Parser fixtures cover truncated JSON, duplicate keys, NaN/Infinity, trailing content,
comments, oversized bytes, BOM, invalid UTF-8 and nesting limits and lone Unicode surrogates. A valid request padded to exactly 64 KiB
is accepted; 64 KiB+1 input/output are rejected. Boundary byte limits
apply before schema evaluation to inputs AND outputs; adapters must enforce output
limits too. Canonical RFC 8785 hashing must reject numbers outside the safe integer range.

The following remain normative semantic checks, not expressible as JSON Schema validity:

- Descriptor/manifest/source/runtime/policy provenance and digest equality; capability
  availability actually enforced on the target, not just listed in JSON.
- Host path syntax vs target and launcher kind; canonical path ownership, overlap,
  case/normalization collisions, symlink/junction races and profile/channel isolation.
- Journal hash-chain/sequence, current revision CAS, operation ID digest equality,
  transaction binding and allowed state transition; recovery compensation eligibility.
- Receipt activeGeneration/revision/actual effects matching durable state. restored
  only for recovery, with no post-activation rollback; inspect is read-only.
- Sorted unique normalized installed file paths, exact complete file set with no extra
  executables, sizes/digests/modes/link targets, runtime/npm, ACL/signature policy.
- Build containment, zero Personal/backend launch, child cancellation, secrets isolation
  and native filesystem flush/rename/launcher-lock guarantees.

A valid fixture demonstrates syntax only, not these semantic properties. Twelve
scenario vectors document expected future outcomes without pretending a mock oracle
proves the platform guarantees. Runtime implementation must test them against the engine
and native OS, including negative evidence of side effects after rejected requests.

Inventory of fixture coverage: each of the six execute operations, all six platform/arch
pairs, descriptor, supported/blocked capabilities, every stable error code, prepared/
committed/activated/restored/failed receipts, inspect and activation completion, malformed
request receipt, generation metadata and journal. Every top-level schema except shared
common definitions has positive and negative fixtures; common is exercised through refs.

## Reproducibility and documentation checks

Run `git diff --check`. Resolve local Markdown links relative to each document. Parse
all fenced JSON examples (normative examples are linked fixture files). Verify the schema
operation enum equals prepare/commit/activate/install/inspect/recover, discoverable list
is identical and capability request enum matches descriptor/capability lists. Check every
error code has a positive fixture, each fixture has an index entry, and the completed
separation audit has no diff. No GitHub Actions changes are needed.
