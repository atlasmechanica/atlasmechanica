# JSON model presets (catalog-document 0.2)

Part of #87 / milestone #86. Builds on #93; this is a parameter-authoring bridge, not completion of JSON-only interactive pages or generic family instantiation.

## Boundaries

`atlas.catalog-document` 0.1 remains accepted unchanged. Envelope version 0.2 adds `modelPresets` and `simulationBindings`; enclosed catalog records and referenced `SimulationModel`s still use their own 0.1 schemas. Unknown fields fail in both versions, and the new fields require envelope 0.2.

A preset is a stable name for parameters of an existing model and a reference configuration. It is not a new canonical subject, physical model, or motion keyframe. One envelope can contain the subject/occurrence plus its preset and binding; additional source occurrences can simply reference the same canonical subject. Preset-only files can be discovered alongside catalog files without new imports. Defaults live on the model, not in copied preset data.

```json
{
  "format": "atlas.catalog-document",
  "schemaVersion": "0.2",
  "modelPresets": [{
    "id": "example:open-ratio",
    "modelId": "foundation:belt-drive:open",
    "configuration": "reference",
    "parameters": { "driver-radius": { "value": 45, "unit": "mm" } }
  }],
  "simulationBindings": [{ "subject": "open-belt-drive", "preset": "example:open-ratio" }]
}
```

This example relies on an existing `open-belt-drive` catalog subject and is an Atlas-authored example, not a claim that Brown specifies these dimensions.

## Compilation and handoff

`compileCatalogDocuments(sources, { models })` and Node-only `discoverCatalogDocuments(root, { models })` accept an explicit list of known model definitions from their caller. There is no imported fixture registry in production catalog code. Missing/duplicate model identities fail. A binding resolves a known subject and preset and requires its model ID to agree with the subject's declared simulation model.

Compilation returns the unchanged normalized catalog records plus immutable, serializable `modelPresets` and `simulationBindings` arrays. A resolved preset contains its ID, model ID, a known reference-configuration ID, and the full parameter dictionary in canonical units. If a model has several configurations, the author must select one explicitly; array/key order never chooses a branch.

The future family/lab resolver (#88) selects the model and adapter, passes the preset's configuration and exact parameters to the session, and gives that same resolved parameter set to route/scene construction. A preset is initial configuration data, **not evaluated-state provenance**: serialized presets must not be trusted as solver results or replay certificates.

## Quantities and overrides

`@atlasmechanica/model` owns `normalizeParameterQuantity()` and `resolveParameterValues()`. They reuse the existing unit-conversion definitions, check finite quantities and inclusive declared scalar domains, and produce owned immutable values. They do not freeze or mutate caller models or overrides.

The generic composition rule is:

```text
model defaults < preset parameters < session overrides < evaluation overrides
```

Pass explicit layers in that order to `resolveParameterValues(model.parameters, preset, session, evaluation)`. Omitted layers are omitted arguments, not null/undefined values. Each quantity replaces the entire `{value, unit}` record; fields are never deep-merged. Every layer and every model default/domain is validated before the next is applied, so a valid later value cannot mask an invalid earlier one.

Inherited override properties are ignored. All own keys, including non-enumerable keys, are validated. Symbols/accessors/unknown parameters/explicit undefined values fail; getters are not invoked. Unsupported units are not guessed or silently converted. Unit support is exactly the current model unit vocabulary; for example rpm is not a model unit code here.

Catalog compilation wraps errors with a filename and JSON Pointer. Invalid supplied model definitions point to the preset's model reference; malformed authored values point to their exact parameter field.

## What successful authoring validation does NOT mean

Scalar domain validity does not establish coupled geometric feasibility, engine support, or product interactivity. The Brown 003 driver-radius=30 mm example is within its declared scalar domain but violates the existing guided route. It passes scalar preset resolution and must still be rejected by the spatial adapter as invalid geometry. Tests preserve that distinction.

The shared runtime must compile/evaluate the selected adapter before accepting a render state. No route/render provenance guard is removed by this change; no physical/contact claim is broadened. The catalog's existing interactive/planned flags are retained, not promoted by parsing. No new production page, lab binding, or renderer is added here.

## Proof and next work

Automatically discovered test-only presets cover open, crossed, and quarter-turn guided belts with changed ratios and mixed authored units. Integration tests feed them to the existing real adapters and test file add/remove, reference errors, invalid domains, explicit configurations, and immutable output. The old Brown 001–003 JSON parity suite remains unchanged.

This is not #92's no-code interactive-page proof: the application is not yet consuming these bindings. Remaining #87 work includes richer source/asset metadata, bounded editorial/presentation data, and an editor JSON Schema. #88 owns reusable family/template instantiation and lab resolution, #89 shared rendering, #90 page generation, and #91 production migration/Brown 003 completion. No preset inheritance, arbitrary module paths, executable callbacks, universal topology schema, or bulk collection ingestion is introduced.
