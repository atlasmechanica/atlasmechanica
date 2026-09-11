# Preset-bound JSON lab presentations

Part of #87 / #88 within milestone #86, following #93–#95.

## Scope

Document envelope `0.4` adds `labPresentations`. Enclosed catalog/model schemas
remain unchanged and document versions 0.1–0.3 remain accepted with their existing
field gates. This slice resolves discovered data to the existing
`MechanismLabDefinition`, not a competing UI or physical-model schema.

Applications supply trusted `labTemplates` next to `models` in
`CatalogCompileOptions`. Each template has an ID, adapter ID, and existing lab
definition. The catalog imports only `@atlasmechanica/lab/presentation`, whose
runtime graph is model + lab core/schema: no family, kinematics, scene compiler,
renderer, filesystem, or dynamic module loading. A regression guards that boundary.

There is deliberately no new production template registry or per-item import.
Family-level model instantiation, structural support checks, lazy resolution and
shared renderer extraction remain #88/#89. Existing identity/provenance checks
are not removed by this authoring bridge.

## One-file example

The subject, model preset and simulation binding may be declared in this file
or elsewhere in the discovered input. A second source occurrence can still reuse
the same canonical subject, preset and presentation without copying any of them.

```json
{
  "format": "atlas.catalog-document",
  "schemaVersion": "0.4",
  "labPresentations": [{
    "id": "example:open-lab",
    "subject": "open-belt-drive",
    "template": "belt:open-classic",
    "settings": {
      "controls": [{ "id": "driver-speed", "initial": 40, "max": 100 }],
      "readouts": [{ "id": "speed-ratio", "digits": 4 }]
    }
  }]
}
```

The supplied template ID is an example, not a newly registered production family.
Only supplied templates are selectable. Unknown template/model/subject references,
adapter mismatches, duplicate template IDs, duplicate presentation IDs and more
than one presentation per canonical subject fail. Multiple canonical subjects
may reuse the same physical model/template with different presets/presentations.

## Defaults, physical parameters and capabilities

A bound model preset is the authoritative physical baseline. It already resolves
model defaults plus explicit authored parameter values. Legacy lab-template
`parameterOverrides` are validated, but never merged over that preset. Templates
provide UI/renderer defaults, not a hidden second physical preset. Migration #91
must explicitly put any desired legacy 45/45 mm display configuration into JSON
presets instead of depending on the old template overrides.

Every parameter slider derives its initial value from the resolved preset in the
unchanged control unit. It cannot be assigned another initial value in presentation
settings. Out-of-range or off-step preset values fail rather than getting silently
clamped/snapped by a browser range control. Coordinate/rate initial values inherit
from the template and may be explicitly overridden within their permitted ranges.

Settings can override subtitles, control labels/ranges/steps and coordinate/rate
initial values, readout labels/numeric precision, and choose a subset of supported
views. Control ranges may only narrow the supplied template ranges; their values
must also obey the model's scalar parameter domains. Precision is 0–12 digits and
cannot be applied to text readouts. Array patches are matched by ID, preserve the
template's ordering and cannot add/remove/rebind controls or readouts.

Settings cannot change units, query keys, interaction mappings, signal/coordinate
bindings, animation pairs, readout scaling/suffixes, model transforms, scene
compilers or renderer IDs. They cannot turn on an unsupported 3D view or remove
the required 2D view. Templates with dependent-coordinate controls fail. Data has
no callback, script, dynamic module path or renderer-owned motion program.

## Runtime handoff

Compilation emits an immutable serializable `labPresentations` array alongside
catalog, preset and editorial records. Each result contains `id`, `subject`,
`template`, `preset` and the resolved `definition`. These definitions are
subject-selected presentations, not new global defaults for the physical model.
Supplied models/templates remain unmodified and are not frozen by compilation.

Tests use the resolved definition with the existing family resolver, adapter
session, lab request builder and scene compiler. All three belt examples verify
actual ratios, dependent angles, model-owned travel across 359°→361°, reset,
readout formatting and nonempty solved scenes. The synthetic temporary-directory
proof adds one file containing a new subject, parameter preset, binding and lab,
then evaluates/builds it without registering another lab/model. Removing the
file removes its records on the next scan.

This is NOT #92's final browser/page proof. Production pages/registries remain
unchanged. A template ID and valid scalar ranges do not certify coupled geometry,
renderer support for new topology or a successful published interactive page.
The application must resolve the real adapter/scene/renderer, evaluate the exact
initial request, enforce `assertValidInitialLabState`, and retain existing scene
provenance checks. A Brown 003 preset that passes scalar validation but violates
the route is still rejected by the real spatial adapter in regression coverage.

Text stays literal data for escaped rendering, not sanitized HTML. Manual phase
rebasing and continuous animation are unchanged. No physics or renderer is added.

## Remaining milestone work

#87 still requires the editor JSON Schema and decoder/schema parity. #88 owns
family-level instantiation, structural support and live lazy-runtime integration;
#89 owns reusable scene/rendering machinery; #90 owns actual generated pages;
#91 migrates the one production source of truth and completes Brown 003; #92 must
prove a separate JSON/assets-only commit produces a fully interactive product page.
