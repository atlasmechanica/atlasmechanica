# JSON catalog documents — first authoring slice

Tracked by #87 within milestone #86.

## Scope and status

This slice provides strict JSON decoding, cross-document catalog validation,
normalization, and Node/build-time discovery. It deliberately does **not** change
production routes, the catalog singleton, model/lab registries, rendering, or
interactive status. The three Brown JSON examples are parity fixtures, not a
second production catalog.

**This is not completion of #87 or the JSON-only interactive milestone.** The
remaining #87 authoring contract must cover parameterized model configurations,
units and defaults/overrides, fuller source/asset provenance, and editorial/lab
presentation data in coordination with #88/#90. Until those fields are defined,
they are rejected as unknown, not passed through as unchecked data. The existing
simulation IDs in these documents are catalog references only: this layer does
not certify engine availability, geometry validity, or an interactive product.

## One-file envelope

```json
{
  "format": "atlas.catalog-document",
  "schemaVersion": "0.1",
  "occurrences": [
    {
      "schemaVersion": "0.1",
      "id": "test:another-view",
      "collection": "test-sources",
      "ordinal": 1,
      "displayNumber": "test",
      "status": "interactive",
      "canonicalSubject": "open-belt-drive",
      "simulation": { "modelId": "foundation:belt-drive:open" },
      "source": { "excerpt": "Synthetic canonical-reuse example, not a historical attribution." }
    }
  ]
}
```

That example requires a `test-sources` collection and the existing interactive
canonical subject elsewhere in the input set. A new occurrence references the
canonical subject rather than copying its model. A file introducing a subject
may include both `subjects` and `occurrences`; a collection may be declared in a
separate file. All references are resolved after discovery, so filenames do not
impose dependency order.

An envelope contains `format`, `schemaVersion`, and at least one record in its
optional `collections`, `subjects`, or `occurrences` arrays. Enclosed records are
the existing `CollectionManifest`, `CanonicalSubjectManifest`, and
`CollectionOccurrenceManifest` types from `packages/catalog/src/schema.ts`.
`parseCatalogDocument` is the runtime decoder for this initial format. Both the
envelope and record versions are checked. A published editor JSON Schema and the
broader configuration authoring contract remain follow-up work in #87; this
format is currently internal/pre-migration.

## Validation and ordering

- Every declared field is checked, including nested facts, classification,
  rights, source links, and simulation bindings. Unknown fields and null values
  in optional fields fail instead of being silently dropped.
- IDs use lowercase letters/digits with `:`, `.`, `_`, or `-` separators. Slugs
  are lowercase URL segments. Ordinals and optional collection sequences must
  be positive safe integers in this authoring format.
- Duplicate IDs within each record namespace, subject slugs, collection
  sequences, and per-collection ordinals fail with source locations.
- Mapped/interactive occurrences must reference a known subject. Interactive
  occurrences must reference that subject's declared interactive model. The
  existing `createCatalog` validator remains the final catalog-semantic check.
- A single definition owns each record. There is no last-file-wins merge,
  inheritance, `extends`, reference indirection, or per-file default precedence
  in this slice. Such fields are rejected. Collections and subjects do not
  point back to occurrences, so the accepted reference graph cannot cycle.
- Filenames and output records are ordered using code-unit comparison, not the
  machine's locale. Record arrays are normalized by ID; display ordering still
  uses the authored ordinal/sequence. Editorial arrays retain their order.
- Validation owns newly parsed objects and deeply freezes them. The caller's
  input array is not sorted or mutated. Normalized records are JSON-serializable.

Errors expose `source` and a JSON Pointer in `pointer`, for example
`brown/001.json#/occurrences/0/canonicalSubject`. Reference failures do not turn
into silent partial catalogs.

## Pure and build-only APIs

```ts
// Browser-safe: no filesystem or build-tool dependency.
import { compileCatalogDocuments } from '@atlasmechanica/catalog/authoring';
const { manifests, catalog } = compileCatalogDocuments([
  { path: 'entry.json', text: jsonText },
]);

// Node/build-only: explicitly choose the content directory.
import { discoverCatalogDocuments } from '@atlasmechanica/catalog/authoring/node';
const result = await discoverCatalogDocuments(contentDirectory);
```

Discovery recursively reads lowercase `.json` files and returns forward-slash
relative paths. It ignores `.ts`, `.js`, and other non-JSON files and never
executes them. Every call rescans the directory: adding/removing a document does
not require touching an import/export list or a generated registry. Missing
roots fail; an existing empty directory has an empty manifest set.

Symbolic-link roots/entries, nonregular JSON files, invalid UTF-8, documents over
1 MiB, and directory nesting beyond 16 levels fail. This is a repository build
loader, not a sandbox for a concurrently hostile filesystem. Asset files and
editor schemas must not be placed in the scanned document directory.

Build consumers may serialize `result.manifests`; browsers can reconstruct the
existing catalog index using `createCatalog`. Maps themselves are not the
serialized build artifact. There is no persistent generated output to become
stale. Wiring discovery into the actual Astro build/page generation belongs to
#90/#91, not an implicit behavior of this API.

Source URLs are absolute HTTP(S) without credentials, raw whitespace, backslashes,
or control characters. URLs are never fetched by the decoder. Other strings are
plain text, including historical excerpts: consumers must escape text rather
than use `innerHTML` or `set:html`. This API is not an HTML sanitizer. Executable
callbacks, module paths, and precomputed motion programs are not supported.

## Fixtures, proof, and handoff

`packages/catalog/fixtures/authoring/brown/` contains one collection file and
one subject/occurrence file each for Brown 001, 002, and 003. Tests discover these
files automatically and compare their complete normalized records to the
existing production manifests. This preserves the current source wording and
planned/mapped boundary; it is not a claim that all older editorial wording is
up to date. Content corrections belong in the production migration.

The temporary-directory test then adds and removes a synthetic occurrence-only
file and verifies automatic discovery plus canonical reuse without registration
changes. This proves the **catalog-loading** portion only, not the final
JSON-only interactive proof in #92.

Next: finish #87's model/configuration, quantity, source/asset, editorial, and
presentation authoring contract against #88/#89/#90; use #91 to migrate the
production source of truth and finish Brown 003. Remove parity duplication when
the JSON records replace the TypeScript catalog. #92 must still demonstrate an
independently identified, meaningfully different interactive configuration in
the real generated page/lab with no engine, renderer, registry, page, or test
changes in the proof commit.
