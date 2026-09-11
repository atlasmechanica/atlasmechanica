# Editor schema and validation parity

Completes the editor-schema slice of #87 within #86, following #93–#96.
This does not complete JSON-only interactive authoring, migrate production content,
register another mechanism, or add another renderer.

## Use from a clean checkout

Open the repository root in VS Code. The committed `.vscode/settings.json`
associates the authoring, preset, editorial and presentation fixture directories
with `packages/catalog/schema/catalog-document.schema.json`. New files in those
directories inherit the association without a per-file change. The same schema
also applies to `*.atlas.json` files anywhere in the workspace. Other editors can
associate the local schema file using their own JSON Schema settings.

The schema is self-contained JSON Schema draft-07. All `$ref` values are local;
there is no registry lookup or network requirement to validate its definitions.
Its URN identifies the schema, not a hosted download endpoint. The editor may
independently load the standard dialect meta-schema according to its own settings.
The compiler does not fetch schemas or URLs.

Do not add `$schema` to a catalog document: the existing strict envelope does not
accept that field. Association lives in editor settings so existing documents
retain their versioned parser semantics. Documents are strict JSON,
not JSONC; comments and trailing commas remain invalid.

The schema adds completion choices and field descriptions for the existing
vocabulary: catalog identities, source occurrences, model presets, source/assets,
editorial blocks, trusted-template lab presentations and named physical instances. It intentionally does not
hard-code Brown numbers, model IDs, preset IDs or template IDs into enumerations.
Those identifiers refer to records/capabilities resolved by the compiler and
runtime, not by a global item allowlist.

Run the focused contract suite with:

```sh
npm ci
npm run catalog:schema:check
```

`npm run check` also runs these tests automatically through the existing Vitest
suite. Ajv is pinned as a development-only validator; it is not imported by catalog
production code, lab runtime, solver or renderer. It compiles only our trusted
schema in tests, never an authored manifest or formula as code. The tests use
strict mode with no coercion, default insertion or removal of unknown properties.

## Versioned authoring envelopes

| Envelope | Permitted additions |
| --- | --- |
| 0.1 | `collections`, `subjects`, `occurrences` |
| 0.2 | `modelPresets`, `simulationBindings` |
| 0.3 | `referenceSources`, `assets`, `subjectContent` |
| 0.4 | `labPresentations` |
| 0.5 | `modelInstances` (new identities of supplied physical templates) |

A document must contain at least one record. Declaring a later-version field in
an older envelope is invalid even when that field contains an empty array.
Enclosed catalog record versions remain 0.1. The model schema is unchanged.

## What parity means

The portable schema mirrors the JSON grammar: required/optional fields, closed
objects, tagged alternatives, primitive types, allowed versions/enums, identifier
patterns, finite numeric bounds, safe integer ordinals, nonempty literal text,
editorial collection cardinality, view membership/uniqueness, and raster
path/media-extension matching. Each existing authoring/preset/editorial/presentation
fixture is discovered automatically and must pass both validators unchanged.

A synthetic grammar fixture covers every editorial block and inline alternative,
separate source/asset rights, optional print-only references and sparse presentation
overrides. For each discovered fixture and that grammar fixture, the test generates
mutations at every node: null/wrong primitive values, blank text, empty arrays,
unknown fields and deletion of individual object properties. Acceptance must agree
between Ajv and the real parser on this structural corpus. No test implements its
own substitute for JSON Schema evaluation.

Parity is not a mathematical proof over all possible documents. Changes to a
parser field, enum or constraint must update the schema and include positive and
negative cases. The record/envelope constants and exhaustive TypeScript unit map
are checked to detect vocabulary drift.

## Explicit runtime-only checks

A portable editor schema cannot compare dynamic model/template definitions or
resolve records in other files. The following differences are intentional and
covered by named tests, not swallowed by a generic exception mechanism:

- **Full URL parsing and credentials.** The schema checks the HTTP(S) prefix and
  rejects whitespace/control characters/backslashes. The parser additionally
  applies the existing URL authority parser and disallows nonempty credentials.
  An editor-valid URL is not a validated navigation target.
- **Canonical numeric representability.** Units are enumerated and authored
  numbers are finite, but tiny nonzero values can underflow when converted to
  canonical units. The existing quantity decoder rejects those values.
- **Identity and graph consistency.** Duplicate IDs/slugs/paths/section IDs,
  dangling references, occurrence-status consistency, print-only references used
  as clickable links and subject/preset/template/adapter compatibility remain
  decoder/compiler checks. Uniqueness by an object's `id` field is not the same
  as JSON Schema `uniqueItems`; different patches with the same ID still fail.
- **Template-dependent control semantics.** Positive steps, initial/max endpoint
  alignment, narrowing, permitted view subsets, input bindings and model domains
  are checked against the supplied template/model. In particular #96's unreachable
  maximum and narrowed periodic-angle examples still fail compilation after the
  editor accepts their JSON shape. Presentation data cannot override physical
  targets, units, scene/renderer IDs or animation pairs.
- **Physics and publication.** Model-valid scalar parameters can still describe
  an impossible coupled route. A regression passes a Brown 003 document through
  the schema and compiler, then verifies rejection by the real spatial adapter
  and initial-state guard. Neither schema nor compilation proves asset existence,
  media bytes, legal rights, generated routes, safe HTML consumption or renderer
  readiness. The page/publishing work must enforce those requirements.

Non-JSON JavaScript values (accessors, symbols, sparse arrays, custom prototypes,
proxies) are outside portable JSON Schema. Existing direct-API data-boundary tests
remain authoritative; this PR does not weaken or replace them.

## Handoff and remaining work

The supported authoring boundary is now documented and tested for catalog data,
physical presets, source-aware content and shared-template presentation settings.
Build-time discovery takes a caller-selected directory and supplied models/templates;
editor association does not itself add a directory to the production build.
Fixtures remain test-only until #91 establishes the production source of truth.

#88 now includes [named model instantiation](json-model-instances.md) through the
shared runtime and web lab. Specialized belt structural capability checks remain
required before those instances can use the belt renderers. #89 removes occurrence-specific rendering;
#90 generates real shared pages and safely consumes content/assets; #91 migrates
Brown 001–003 and finishes Brown 003; #92 must demonstrate a separate JSON/assets-only
commit creating a complete interactive product entry. #86 stays open until that
proof, not merely until this schema validates.

## References

- JSON Schema draft-07 and object composition: https://json-schema.org/understanding-json-schema/reference/object
- Ajv strict mode: https://ajv.js.org/strict-mode.html
- VS Code local schema associations: https://code.visualstudio.com/docs/languages/json#_json-schemas-and-settings
