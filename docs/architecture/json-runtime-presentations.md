# Compiled presentations in the public runtime

Second runtime slice of #88, following #98, within milestone #86.

## Use the compiled record, not a new registration

Catalog compilation now adds `templateLabId` to each resolved lab presentation.
It is the ID of the supplied template's actual `MechanismLabDefinition`; the
existing `template` field remains its authoring alias. This is an additive
normalized-output field, not a new authoring field or document-envelope version.
The four existing JSON envelope versions and their editor schema are unchanged.

Both public resolvers accept a compiled presentation as their third argument:

```ts
const presentation = compiledCatalog.labPresentations.find(
  (entry) => entry.subject === subject.id,
);
if (presentation === undefined || subject.simulation === undefined) {
  throw new Error('Subject requires a compiled presentation and simulation');
}
const resolved = resolveMechanismLab(
  presentation.definition.modelId,
  subject.simulation.adapter,
  presentation,
);
// The same serializable selection works with the lazy browser API:
const lazy = await loadMechanismLab(
  presentation.definition.modelId,
  subject.simulation.adapter,
  presentation,
);
```

The entrypoint imports are `@atlasmechanica/lab/runtime` and
`@atlasmechanica/lab/lazy-runtime`. Both export `LabPresentationSelection` and
`MechanismLabSelection` types. The old optional string lab ID still selects a
registered definition; omission still selects the existing default. Passing a
new generated ID as a string intentionally does not register or discover it.

No consumer creates a replacement family or inserts a generated definition into
its `definitions` array. Only trusted family templates stay registered. Each
request produces an owned frozen presentation; only the family module load is
cached. Two requests can use the same presentation ID with different valid
presets without sharing parameters, controls, a session, or evaluated state.

## A loaded template remains authoritative

The runtime does not trust a serialized `MechanismLabDefinition` to choose
arbitrary behavior. It selects the registered `templateLabId` for the requested
model, extracts only the already-supported presentation settings and complete
physical preset, and passes them through `resolveLabPresentation` again. That is
the existing policy authority: units/domains, preset precedence, slider grids,
periodic endpoints, view subsets, and allowed UI overrides are not reimplemented.

It then compares the entire reconstructed definition to the supplied one.
Object key order is irrelevant; control/readout array order is significant.
Unknown fields, altered control/interaction/query bindings, renderer/scene/transform
IDs, readout formula/scaling, missing controls, default promotion, and divergent
parameter-slider initial values fail instead of being silently ignored or reset.
A catalog compiled with an incompatible same-ID template fails against the loaded
runtime template. This is semantic compatibility checking, not a cryptographic
integrity certificate or version-hash check. Intentionally editable labels and
parameters remain editable.

The runtime selector consumes only `templateLabId` and `definition`. Catalog
metadata such as source/preset IDs and canonical relationships is resolved by the
catalog compiler, not re-certified here. It is not an API for loading arbitrary
models: requested physical models must still exist in the selected family.

Before an asynchronous import yields, plain JSON-compatible data is copied and
frozen. Caller mutation cannot change an in-flight request. Getters, methods,
symbols, custom prototypes, sparse or non-enumerable array items, nonfinite values,
and cycles fail rather than executing callbacks or silently dropping properties.
This is an in-process plain-data contract, not a JavaScript/proxy sandbox.
Family definitions/import callbacks remain trusted application code.

## Physics and scenes still need evaluation

Resolution validates the model/template/adapter/compiler combination, not all
coupled geometry or future states. Consumers must use the returned definition,
model and adapter to build the exact initial request and evaluate the session,
then call `assertValidInitialLabState` before publishing an interactive lab.
Scene construction still receives those same evaluated parameters and state;
existing spatial provenance and interaction checks remain in place.

Tests send all three discovered belt presentations directly through the public
eager/lazy resolvers, including a JSON round trip, actual adapter/scene/readout
results, multiple revolutions and reset. The real spatial adapter still rejects a
scalar-valid but impossible route. Concurrent same-ID presets, deferred-import
mutation, template drift and post-compilation rebinding attempts are covered.
A temporary-directory test adds one synthetic subject/preset/presentation file,
uses the public runtime without registrations, and removes it again.

## Remaining milestone work

This does not migrate the live product pages or claim the #92 browser/page proof.
The Astro component currently selects registered labs by ID; its serialized
presentation handoff belongs to the live page integration work. Family-level
physical model instantiation and replacement of specialized belt identity checks
with equivalent structural/provenance checks remain #88/#89. Shared rendering,
generated pages, production migration/Brown 003 completion and the independent
JSON/assets-only interactive proof remain #89–#92. No catalog status is promoted.
