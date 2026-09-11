# Compiled presentations in the shared web lab

Part of #88 / milestone #86, following #99. This connects the public compiled
presentation runtime to the actual Astro component and browser controller.
It does not complete physical model instantiation, shared-renderer extraction,
production catalog/page migration, or #92's independent data-only product proof.

## Server to browser

`MechanismLab.astro` accepts an optional `presentation: LabPresentationSelection`
(the compiled catalog record is structurally compatible) in addition to `modelId`,
`adapterId`, and `title`. Existing optional `labId`/default calls remain supported.
Supplying both `labId` and `presentation` is an error; there is no precedence that
can silently select another lab.

The server calls the public eager resolver with the chosen selection, evaluates
its exact initial request, and enforces the existing initial-state guard. Controls,
readouts and available views come from that resolved definition. A shared display
formatter preserves fractional initial values on both sides of hydration.

For a compiled presentation, the server serializes only `templateLabId` and the
independently owned, validated definition into `data-lab-presentation`. Catalog
source/relationship metadata is not shipped as runtime authority. This is an
Astro-escaped HTML attribute, not `set:html`, executable script, or an interpolated
module path. Labels, quotes, ampersands, Unicode and HTML-looking text remain data.

The browser reads attributes from each component root and passes the decoded
selection to the public lazy resolver. Full template/control/readout/renderer
compatibility is rechecked there, not reimplemented in the DOM helper. The
resolved identity must agree with the rendered component's `data-lab-id`.
Only an **absent** payload selects the legacy string-ID path. Present-but-invalid
JSON, null, missing definitions and contradictory identities fail initialization;
they never fall back to a default with different physical parameters.

Parsing/identity errors reject the component's initialization promise. The
existing per-component error status handles them, clears the busy indicator,
and permits independent labs on the same page to initialize. Simulation, phase,
view switching, renderer loading, and geometry caches stay with the existing
controller and reviewed engines. No renderer-specific configuration branch is
added here. This is semantic validation, not cryptographic content integrity.

## Browser regression fixture

The normal production config is unchanged. `npm run build:test --workspace
@atlasmechanica/web` explicitly selects `astro.test.config.mjs`, injects a test-only
route and writes to `.test-output/dist`, separate from the deployed `dist`.
The fixture page imports the **real shared component**, discovers its JSON
presets/presentations, and compiles them with the existing supplied family models
and templates. These template registrations are test setup, not per-presentation
runtime registration. Brown 003's catalog status remains unchanged.

The existing renderer Playwright command now starts both its original preview
and this isolated Astro preview (ports 4173 and 4174). This reuses the already
installed Playwright dependency and the existing Chromium/WebKit CI gates;
no new dependency or privileged workflow is needed. CI does not reuse stale
preview servers. Additional screenshots use the existing evidence-artifact glob.

Coverage includes server-only content, fractional values, literal HTML-looking
text, all three preset ratios after hydration, legacy/configured isolation,
2D-only view subsets, real planar/spatial WebGL switching, reset to JSON defaults,
and material phase across displayed wrap, pause/resume, speed edits and hidden
3D. The clock test controls browser timers, not solver or renderer results.
Malformed serialized payloads fail one component without breaking the others.
The normal production build is checked to exclude the fixture route.

This is not a new catalog occurrence or the final manifest-only proof. The fixture
contains deliberate test configurations and still references existing physical
model identities. #88 still owns supported model instantiation and structural
support; #89 shared drawing; #90 generated pages; #91 production migration and
Brown 003 completion; #92 automatic final JSON/assets-only acceptance.
