# Source-aware JSON editorial content

Part of #87 in milestone #86; consumer handoff to #90. Builds on JSON discovery
(#93) and model presets (#94). This is the content contract, not a claim that
JSON-only interactive authoring or generated product pages are complete.

## Envelope and ownership

`atlas.catalog-document` v0.3 adds `referenceSources`, `assets`, and
`subjectContent`. v0.1 catalog documents and v0.2 preset documents remain valid,
including when mixed in one discovery pass. New fields require v0.3, even when
their arrays are empty. Enclosed catalog and physical-model versions remain 0.1.

Each source/asset has one declaration by ID; each canonical subject has at most
one content record. A content record can live alongside its subject, occurrence,
and preset in one JSON file or reference a subject in another discovered file.
No imports or per-file registries are involved. Adding another occurrence of a
subject reuses its content instead of producing another canonical page.

Compilation returns `referenceSources`, `assets`, and `subjectContent` as owned,
deeply frozen, JSON-serializable arrays alongside the existing `manifests`,
`catalog`, `modelPresets`, and `simulationBindings`. Content does not alter those
catalog records, model definitions, interactive statuses, or preset parameters.

Top-level output is sorted by source/asset ID or canonical subject using code-unit
comparison; sections, blocks, list items and inline runs keep their authored
order. Duplicate declarations, asset paths and per-subject section IDs fail.
There is no merge-by-filename, inheritance, remote include, or embedded content
reference expansion. Navigation links may form cycles; the compiler does not
recursively expand them.

## Sources, images, and honest provenance

Source records require `id`, `title`, `locator`, and `rights`, with optional
`author`, `edition`, and `url`. Locators identify the page, movement, figure, or
other cited portion of the work. Print-only sources are valid for quotation;
a `reference-link` additionally requires the source to have a URL.

Rights metadata requires a status (`public-domain`, `copyrighted`, or `unknown`)
and attribution, with an optional note. These are authored claims, not automated
license verification. A modern scan/illustration does not inherit public-domain
rights merely because its historical source is public domain.

Every asset declares its own rights, root-relative path and raster media type.
`source-reproduction` provenance requires a known source reference.
`atlas-illustration` provenance requires an explanatory note and may cite a
source. This distinction prevents silently presenting Atlas illustration or
reference dimensions as measurements from the historical plate.

Paths must stay under `/assets/catalog/` using plain safe segments; no traversal,
percent encoding, dotfiles, remote hosts, backslashes, queries, or fragments.
Only PNG, JPEG and WebP are accepted, with matching extensions. This initial
vocabulary intentionally excludes executable/vector documents and raw SVG.
Image uses require nonempty alternative text and may provide a caption.

**The parser validates declarations, not image bytes.** It neither fetches source
URLs nor reads/copies assets. #90/#91 must check local asset existence, actual
media type, build copying, and attribution before publishing image-bearing pages.
The test suite uses synthetic image declarations and does not claim those files
exist. Missing-asset publication must fail rather than silently emit broken HTML.

## Bounded editorial vocabulary

A `subjectContent` record identifies `subject` and a nonempty `sections` array.
Each section requires a slug-shaped `id`, `title` and nonempty `blocks`; `eyebrow`
is optional. Section IDs are local to a subject; the shared page must avoid
collisions with other page anchors, for example by prefixing editorial IDs.

| Block | Required content | Intended consumer semantics |
| --- | --- | --- |
| `paragraph` | `content` inline runs | Paragraph |
| `heading` | `text` | Subheading below section title |
| `list` | nonempty `items` of inline runs | Unordered by default; optional `style: ordered` |
| `formula` | `expression`, inline `caption` | Display-only expression and explanation |
| `quote` | `text`, source `reference` | Quotation with source locator/attribution |
| `note` | `kind`, inline `content` | Assumption, limitation, or reference-geometry note |
| `image` | asset ID, `alt`; optional inline `caption` | Raster image with its own rights/provenance |
| `related` | canonical `subject`, `label`; optional `description` | Link resolved through canonical records |

Inline runs are nonrecursive: `text`, `emphasis`, `strong`, or `code` with `text`;
`reference-link` with `reference` and `text`; `subject-link` with `subject` and
`text`. There is no raw `href`, executable callback, style object, module path,
Markdown/MDX component, HTML block, interpolation, or precomputed animation.
All nested fields and discriminators are checked. Inline text is retained exactly,
not trimmed or reformatted. Text fields must contain at least one non-whitespace
character; runs can include leading/trailing whitespace for sentence spacing.

Expressions are literal display strings. They are not evaluated, parsed as code,
or used as a second physics implementation. The model/adapter remains responsible
for computed readouts; #88 owns their presentation bindings.

## Validation versus rendering

The compiler checks all source, image, and canonical-subject references after
reading every file. Broken references in list items, formula/image captions,
notes and inline links are checked, not just top-level links. Errors retain the
source filename and exact JSON Pointer. Source URLs reuse the existing HTTP(S)
validator; credentials, unsafe schemes and raw whitespace/control characters fail.

The decoder is **not an HTML sanitizer**. Markup-looking strings remain literal
data. #90 must render text via escaped template nodes and select semantic elements
from the closed vocabulary, never use author strings as `innerHTML`/`set:html`,
attributes, script content or dynamic component/module names. Safe link destinations
come from validated source URLs or canonical subject slugs. Quote and image
attribution must remain visible. A source reference proves neither historical
accuracy nor permission to reproduce an unlimited excerpt.

Known subjects may still be planned or have no product page. Reference validation
is not page availability: #90 must validate advertised navigation and interactive
bindings before publication. No content record promotes a mechanism to interactive.

## Example and evidence

`packages/catalog/fixtures/editorial/belts.json` is a test-only example for all
three current belt subjects. Open/crossed prose and formulas are excerpts of their
existing Astro pages, not a full migration. Brown 001's quote is regression-checked
against the existing occurrence excerpt. Brown 003's notes retain the reviewed
reference-dimension and lumped-ratio/slip limitations. The production TS catalog
and existing pages remain the sole live source of truth until #91 migrates them.

Tests cover mixed versions, round trips, deterministic cross-file resolution,
ownership, every content kind, invalid references/paths/URLs/fields, print-only
sources, separate source/image rights, and real filesystem add/remove discovery.
This is not #92's independent JSON-only interactive-page proof.

Remaining #87 work: editor JSON Schema with validation parity and the declarative
lab/presentation contract agreed with #88. #88/#89/#90 still supply family runtime,
shared scene/rendering components and actual generated pages. #91 completes
migration including Brown 003. #92 proves a manifest-only interactive addition.
