# SVG renderer bake-off

Implementation evidence for Atlas Mechanica #21 / #39 / PR #46.

Every candidate consumes the same `MechanismScene`, compiled from Atlas `SimulationModel` + `ModelState` + current authored parameters. No renderer computes kinematics, tangent geometry, linkage closure, or transmission ratios.

Pinned comparison:

- native SVG DOM — no rendering dependency
- `@svgdotjs/svg.js` 3.2.8
- `jsxgraph` 1.13.2
- Vite 8.2.2
- Playwright 1.62.1 for Chromium/WebKit evidence

The playground deliberately exercises the canonical four-bar and belt fixtures already established by #19/#20. Mechanism animation is external state. Candidate drag callbacks propose input/parameter changes; Atlas re-evaluates the mechanism and then pushes a new immutable scene back into all three renderers.

## Result

**Native SVG won and is the accepted primary 2D mechanism renderer.** See `docs/adr/0001-native-svg-primary-renderer.md`.

All 12 shared interaction/accessibility checks passed in both Chromium and WebKit.

Representative synchronous update cost:

| Browser | Native SVG | SVG.js | JSXGraph |
|---|---:|---:|---:|
| Chromium | 0.120 ms | 0.469 ms | 0.995 ms |
| WebKit | 0.193 ms | 1.276 ms | 1.431 ms |

Twelve-thumbnail stress (720 updates):

| Browser | Native SVG | SVG.js | JSXGraph |
|---|---:|---:|---:|
| Chromium | 93.3 ms | 286.6 ms | 692.5 ms |
| WebKit | 133 ms | 972 ms | 1,027 ms |

Production bundle vendor chunks from the bake-off:

- SVG.js: 90.4 kB raw / 29.1 kB gzip / 25.8 kB Brotli
- JSXGraph: 1,038.7 kB raw / 258.8 kB gzip / 201.3 kB Brotli
- native SVG: no renderer vendor dependency

JSXGraph remains interesting for optional dynamic-geometry/math/plotting experiences, not the core mechanism-motion renderer.

## Recorded evidence

The dedicated PR workflow records:

- one-view synchronous update cost
- 12-thumbnail update cost
- 5,000-point trace update cost
- DOM node count
- SVG export byte count
- focusable/selectable element count
- Vite raw/gzip/Brotli bundle chunks
- Chromium and WebKit results
- screenshots of the three candidates rendering the same state

The experiment stays in the repo as reproducible decision evidence. Production native-SVG code should be promoted into its own package rather than importing this playground.
