# Named physical models from JSON

Part of #88 and milestone #86, following the compiled presentation and web-lab
handoffs in #99/#100. This adds physical model identity to the data path; it does
not complete shared rendering, generated public pages or the final #92 proof.

## Authoring

Document envelope 0.5 adds one closed record shape:

```json
{
  "format": "atlas.catalog-document",
  "schemaVersion": "0.5",
  "modelInstances": [{
    "id": "test:four-bar:wide-ground",
    "templateModelId": "foundation:four-bar:crank-rocker"
  }]
}
```

An instance declares a new physical identity of an application-supplied model
template. It cannot supply topology patches, renderer IDs, module paths, formulas
or executable callbacks. Its physical subject, variant, coordinates, joints,
signals, assumptions and configurations all remain owned by the template. The
enclosed SimulationModel and catalog-record versions do not change.

Use the existing `modelPresets` to set dimensions, `simulationBindings` to select
the preset for a canonical subject, and `labPresentations` to choose the shared
lab template and bounded controls/readouts. These can all live in the same file.
The complete synthetic example is
`apps/web/tests/fixtures/four-bar-instance.atlas.json`: its ground link is 105 mm,
initial input angle is 25 degrees, and initial speed is 45 rpm. It is explicitly a
test configuration, not an attribution to Brown or another historical source.

A new historical occurrence of the same existing canonical mechanism should
still reference that subject. A parameter preset alone does not require a new
physical model identity; `modelInstances` is for cases that need one.

## Compilation and runtime

The compiler resolves instances before presets and lab presentations. Template
roots must come from the application-supplied model list, not another instance.
Unknown roots, chains/cycles, duplicate instances and collisions with supplied
model IDs fail at their authoring filename and field. No global model or lab
array is modified. Filesystem discovery and editor associations remain automatic.

The shared model helper copies and validates the template with only its top-level
ID changed, then freezes the independently owned result. Preset values remain
separate and use the existing unit/domain/precedence rules.

Normalized instance data contains `id`, `templateModelId` and the complete
untransformed physical `model`. This model is a compatibility witness, not a
serialized drawing or solved motion. The compiled lab carries it to the existing
eager/lazy APIs. The runtime rebuilds the instance from its actually loaded
trusted template and compares the full data before rebinding the shared lab.
Object-key order is irrelevant; array order and every value remain significant.
This intentionally rejects template drift, including descriptive fields; rebuild
compiled artifacts after changing a template. It avoids silently evaluating a
different same-ID template in the browser.

Only the validated resolved instance and presentation are serialized by the
shared Astro component, using its existing escaped data attribute. The browser
still uses the public lazy resolver. An invalid witness fails the affected lab
without falling back to a registered model or stopping other lab initializations.
The lazy loader caches family code, not per-instance data, presets or sessions.

This is semantic compatibility checking, not a cryptographic signature or a
JavaScript/proxy sandbox. The plain-data snapshot boundary rejects callbacks,
accessors, custom arrays, cycles and non-finite numbers before lazy imports yield.
Template code/data supplied by the application remains trusted. Instance checking
does not authenticate catalog metadata or arbitrary caller-supplied ModelState.

## Capability and feasibility boundaries

The first complete supported case uses the existing analytic four-bar adapter
and shared 2D scene compiler. A new physical ID resolves through the unchanged
family registration, evaluates with the declared parameters, and reaches the
actual web controller. Its existing 2D-only capability is not upgraded to 3D.

The instance compiler does not certify adapter/scene support. Planar open/crossed
belt instances now pass a [structural scene boundary](planar-belt-capability.md)
that checks bindings, geometry assumptions and state/parameter consistency. Their
existing drawing code is reused. Spatial guided-belt identity checks remain until
#88/#89 replace them with equivalent or stronger route/provenance checks; a
regression explicitly retains that restriction. No new routing algorithm is
introduced by model instantiation.

Likewise, individually valid parameters can still describe an impossible linkage.
Consumers must evaluate the exact initial request and enforce
`assertValidInitialLabState`; every later state/scene/renderer must retain its
existing provenance and validity checks. Normalization is not a feasibility
certificate or permission to promote a catalog item to interactive.

## Regression coverage

`packages/lab/src/modelInstances.test.ts` checks actual filesystem add/remove
discovery, JSON Schema/parser agreement and old-version rejection, root/identity
errors, immutable data ownership, same-ID template drift, serialization/tampering,
concurrent request isolation and lazy mutation protection. Real adapter and scene
results are compared across 0, 25, 90, 179, 359, 361 and 721 degrees and reset.
An impossible four-bar and unsupported spatial-belt/3D claims remain failures.

`model-instance-web.spec.ts` uses the production-built isolated Astro fixture and
actual shared lab: server output with JavaScript disabled, hydration, parameter
edits, animation through displayed wrap, reset to JSON defaults, and rejection
of altered same-ID topology while neighboring labs initialize. It runs in both
Chromium and WebKit through the existing browser command. The fixture route is
not included in the normal deployed output.

```sh
npx vitest run packages/lab/src/modelInstances.test.ts
npm run check
npm run test:e2e --workspace @atlasmechanica/svg-bakeoff
```

#88 remains open for the specialized structural/provenance work; #89 shared
rendering, #90 generated safe pages, #91 production migration/Brown 003 completion
and #92 the independent JSON/assets-only product proof remain required.
