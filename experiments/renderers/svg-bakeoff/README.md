# SVG renderer bake-off

Implementation evidence for Atlas Mechanica #21 / #39.

Every candidate consumes the same `MechanismScene`, compiled from Atlas `SimulationModel` + `ModelState` + current authored parameters. No renderer computes kinematics, tangent geometry, linkage closure, or transmission ratios.

Pinned comparison:

- native SVG DOM — no rendering dependency
- `@svgdotjs/svg.js` 3.2.8
- `jsxgraph` 1.13.2
- Vite 8.2.2
- Playwright 1.62.1 for Chromium/WebKit evidence

The playground deliberately exercises the canonical four-bar and belt fixtures already established by #19/#20. Mechanism animation is external state. Candidate drag callbacks propose input/parameter changes; Atlas re-evaluates the mechanism and then pushes a new immutable scene back into all three renderers.

The dedicated PR workflow records:

- one-view synchronous update cost
- 12-thumbnail update cost
- 5,000-point trace update cost
- DOM node count
- SVG export byte count
- focusable/selectable element count
- Vite raw/gzip/Brotli bundle chunks
- Chromium and WebKit results

This is research code. The winning foundation should be promoted into a production package only after #21 records the decision/ADR.
