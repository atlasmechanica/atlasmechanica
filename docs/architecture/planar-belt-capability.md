# Planar belt scene capability

Part of #88/#89 within milestone #86. The existing planar scene compiler now
selects by validated physical structure rather than an allowlist of Brown model
IDs. Its existing `atlas.scene.brown-belt.v0` capability ID is retained for
compatibility with compiled presentations; a new model needs no registration.
This is a structural boundary and reuse proof, not completion of #89.

## Supported structure

`resolvePlanarBeltTopology` in the scene package derives driver/driven roles from
the single open/crossed coupling. Body, feature, bearing, coordinate and parameter
IDs are bindings, not reserved fixture names. It validates the full subset that
this scene profile actually implements: a planar ground frame, two centered
pulleys, two fixed revolute bearings along positive Z, and two periodic angle
coordinates with the correct roles and joint bindings. The driven center uses
one positive separation parameter along X or Y. The two radii and separation are
independent length parameters. Only the existing analytic signal vocabulary is
supported; body-pose seeds, extra systems, extra bodies/couplings and configuration
modes are rejected rather than ignored. Reference configurations supply both
finite phases; nonzero reference phases are supported.

This does not widen the physics adapter to arbitrary planar machinery. Eccentric
pulleys, tilted/reversed axes, translated/rotated reference frames and additional
constraints need their own supported contract. Descriptive variant names and
labels cannot change routing. The physical `belt-drive` family is not a canonical
catalog subject or historical occurrence number.

The shared schematic builder uses these derived physical bindings for geometry,
selection and interaction handles. The illustration enrichment and existing SVG
and Three.js drawing code are reused unchanged. The current trusted lab templates
still select their fixed control mappings and vertical transform; model-instance
JSON does not author new mappings, geometry or executable code.

## State and parameter consistency

Both the direct schematic builder and the illustrated production path validate
before consuming solved geometry. The state must name the supplied model and a
known configuration and have no error diagnostic. The existing parameter resolver
checks every default and effective override, including units, domains, unknown
keys and non-finite/underflowing quantities.

The boundary re-evaluates the **existing analytic adapter** with the exact
configuration, effective parameters and unwrapped driver position/rate/acceleration.
It compares the supplied coordinates, body poses/derivatives, signals and modes
with that result. This includes tangent points, wraps, ratio, speed and accumulated
belt travel. No replacement physics or renderer-owned travel formula is introduced.
A state from the same model ID but different radii, separation, routing or reference
phase cannot be silently combined with the new geometry. The caller must supply
effective session/evaluation parameters, not just the last incremental override.

Comparison is exact for this deterministic adapter's canonical output, ignoring
object-key order. It rejects non-finite numbers and does not claim compatibility
with rounded/exported state or a different numerical solver. It is a consistency
check, not cryptographic authentication: independently produced identical states
are equivalent. The runtime's separate whole-template witness check remains in
place. These APIs accept trusted plain-data models and canonical adapter states;
they are not a JavaScript/proxy sandbox.

The state recheck is intentionally uncached so a mutable same-ID object cannot
reuse stale validation. The existing WebGL mesh cache remains authoritative for
static drawing geometry. Browser regressions require pose-only updates to keep
its build count unchanged and a separation edit to invalidate it. A later cached
validated-model boundary must preserve mutation and provenance tests.

## Independent JSON configurations

`apps/web/tests/fixtures/planar-belt-instances.atlas.json` adds two synthetic models
using the existing 0.5 authoring format and existing lab templates:

| Configuration | Radii | Separation | Signed ratio |
| --- | --- | --- | --- |
| Open | 40 / 60 mm | 210 mm | +2/3 |
| Crossed | 35 / 55 mm | 200 mm | -7/11 |

The fixture's subjects, models, presets and presentations are discovered by the
unchanged Astro fixture page. No family, model, lab or renderer registration was
added. Tests compare physical state and rendered primitives with the original
models at the same parameters, including negative and multi-turn angles, and
exercise real browser SVG/WebGL switching, edits, reset and animation.

The fixture is test-only and does not invent historical attribution. It is not
#92's separate JSON/assets-only public product proof: the general test harness,
production catalog source and generated editorial pages are still unfinished.

## Remaining milestone work

Spatial guided-belt identity guards remain unchanged and explicitly regression
tested. Their replacement must preserve route/contact/face-width/coordinate
provenance. #89 must still extract neutral resolved drawing data and shared
components/lifecycle from the planar and spatial implementations, including the
legacy primitive-name/scene-ID parsing and planar texture-phase handling. A new
identity passing this planar boundary does not mean that consolidation is done.
#90/#91 own safe generated pages and production migration/Brown 003 completion.
#86/#88/#89 remain open until their outstanding acceptance criteria are met.
