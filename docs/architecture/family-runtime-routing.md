# Family-level runtime routing

First runtime-registration slice of #88 within milestone #86. Builds on the
merged #96 lab/presentation contract and #97 editor-schema/parity checks.
The schema and runtime-routing suites run together in the repository checks.

## Capability ownership, not an item directory

Both public entrypoints keep their existing signatures:

- `resolveMechanismLab(modelId, adapterId, labId?)` for server/build use;
- `loadMechanismLab(modelId, adapterId, labId?)` for lazy browser use.

The eager resolver registers the belt and four-bar families once each. It indexes
adapter IDs from the actual family definitions. The lazy resolver declares the
same families with lightweight adapter-capability metadata and trusted import
callbacks. Neither routing table contains collection, occurrence, subject or
model IDs. Open, crossed and guided spatial belt models share one family loader.

A request selects the unique registered owner of its adapter capability. The
existing family resolver then selects the requested model/lab and verifies the
adapter and scene compiler support, model transforms and interaction bindings.
An unknown adapter fails without importing a family. A wrong model/adapter pair
fails in the selected family; the resolver never searches other families for an
unrelated fallback. Prototype-like names are ordinary Map keys, not inherited
object properties.

One adapter capability has exactly one registered family owner in this routing
contract. Duplicate family IDs, duplicate adapter IDs and competing owners fail
instead of using registration order. If future families intentionally share an
adapter, introduce explicit disambiguation rather than first-match fallback.

## Lazy loading and failures

The lazy resolver snapshots IDs, adapter lists and import callbacks at construction.
Changing caller registration arrays later does not change its routing. It does
not freeze or modify caller objects. These are trusted application registrations,
not a JavaScript sandbox or a manifest-supplied executable/module-path interface.

Promises are cached by family ID, not by model ID. Concurrent requests for open,
crossed and guided belts share the same pending family load even though the last
uses a different adapter. Only that family is imported; other families remain
lazy. Rejected asynchronous loads, synchronous loader throws and capability
metadata mismatches evict the failed promise and allow retry. A model or lab
resolution error after a successful import leaves the family cache available.
Failures in one family do not evict another family's successful load.

After loading, actual adapter IDs must exactly match the advertised set. Duplicate
model, lab and scene-compiler IDs are also rejected so subsequent resolution cannot
silently choose an ambiguous definition. The registry does not assert that metadata
alone proves topology support or valid physics: existing adapter/scene checks and
session evaluation remain required. Trusted family definitions themselves are not
copied, frozen or treated as hostile data.

## Tests and scope

The public eager and lazy paths are compared using real adapters and solved scenes
for all four existing configurations. Tests cover cross-model/cross-adapter
concurrency, isolated retry, no unrequested import, metadata drift, duplicate
identities, unknown capabilities and failed model/scene bindings.

A separate test supplies a four-bar model with a distinct physical ID and a 105 mm
ground length. Both resolvers evaluate it and build its scene using the existing
four-bar adapter/compiler, without a model-ID routing entry. This tests routing
and the four-bar family's existing structural support. It is not JSON model
instantiation, a new historical catalog record, or the #92 product-page proof.

The production browser and build consumers already use the public entrypoints,
so this removes their per-model routing tables now. It does not migrate production
catalog data or add pages. No solver, renderer, coordinate/material phase behavior,
parameter precedence, scene provenance guard or physical assumption is changed.
The family cache reuses module definitions, not mutable sessions or evaluated
geometry/state. Existing session and rendering caches keep their own invalidation.

## Remaining #88 work

- Connect normalized JSON presets/presentations to public runtime resolution
  without requiring callers to insert generated labs into a family definition list.
- Instantiate supported model/template configurations from normalized data.
- Replace remaining specialized belt model/scene identity allowlists with equally
  strong structural and provenance validation coordinated with #89.
- Verify exact parameters/state across generated labs, session changes and renderer
  consumption, including invalid geometry and unsupported views.

#89 shared rendering, #90 generated pages, #91 production migration/Brown 003
completion and #92's independent JSON/assets-only interactive proof remain
required. #88 and #86 stay open; family-level registration is a concrete step,
not completion of the full data-only authoring milestone.
