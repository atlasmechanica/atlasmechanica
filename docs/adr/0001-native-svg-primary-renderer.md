# ADR 0001: Native SVG is the primary 2D mechanism renderer

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decision owners:** Atlas Mechanica maintainers
- **Related:** #21, #39, PR #46

## Context

Atlas Mechanica needs a default renderer for interactive 2D mechanism diagrams. The renderer must consume Atlas-owned mechanical state rather than become a second simulation system, and it must support crisp schematic graphics, direct manipulation, selection, keyboard/touch access, traces, vectors, dimensions, annotations, reduced-motion behavior, deterministic export, and many simultaneous mechanism thumbnails.

We evaluated three foundations against the same Atlas-owned `MechanismScene`, itself derived from canonical `SimulationModel` + evaluated `ModelState` + current authored parameters:

1. native SVG DOM with keyed Atlas-owned nodes;
2. SVG.js 3.2.8;
3. JSXGraph 1.13.2.

The bake-off used the canonical four-bar and open/crossed belt fixtures. Mechanism animation and physics remained external to all three candidates. Candidate drag events proposed changes to the shared controller; Atlas re-evaluated the mechanism and pushed a new scene to every renderer.

All 12 shared interaction/accessibility tests passed in both Chromium and WebKit before performance results were considered.

## Decision

**Use native SVG with Atlas-owned keyed DOM updates as the primary 2D mechanism renderer.**

The renderer consumes a derived, renderer-neutral scene representation. It does not solve mechanism geometry, transmission behavior, kinematics, or dynamics.

SVG.js is not a default dependency. It may be reconsidered if a future concrete feature demonstrates enough implementation-value to justify its cost.

JSXGraph is not the primary mechanism-motion renderer. It remains a candidate for optional educational math/analysis experiences where its dynamic-geometry, plotting, and construction features materially reduce Atlas-owned code.

Three.js remains the separate renderer for genuinely spatial mechanisms.

## Evidence

### Synchronous scene updates

| Browser | Native SVG | SVG.js | JSXGraph |
|---|---:|---:|---:|
| Chromium | 0.120 ms/update | 0.469 ms/update | 0.995 ms/update |
| WebKit | 0.193 ms/update | 1.276 ms/update | 1.431 ms/update |

Relative to native SVG, SVG.js was ~3.9× slower in Chromium and ~6.6× slower in WebKit. JSXGraph was ~8.3× slower in Chromium and ~7.4× slower in WebKit.

### Twelve-thumbnail stress

720 total renderer updates across 12 simultaneous instances:

| Browser | Native SVG | SVG.js | JSXGraph |
|---|---:|---:|---:|
| Chromium | 93.3 ms | 286.6 ms | 692.5 ms |
| WebKit | 133 ms | 972 ms | 1,027 ms |

Native SVG retained a particularly large advantage in WebKit, an important target for Safari/iOS.

### 5,000-point trace stress

Twenty large-trace updates:

| Browser | Native SVG | SVG.js | JSXGraph |
|---|---:|---:|---:|
| Chromium | 23.5 ms | 37.9 ms | 65.1 ms |
| WebKit | 27 ms | 62 ms | 78 ms |

### DOM and export

All three candidates could expose five focusable/selectable controls in the fixture. DOM node counts were similar (45–49 nodes), so the performance result was not caused by radically different visible scene complexity.

Representative exported SVG sizes were approximately 12.5 kB for native SVG and SVG.js versus 27.7 kB for JSXGraph.

### Bundle cost

The bake-off Vite build produced:

- SVG.js vendor: **90.4 kB raw / 29.1 kB gzip / 25.8 kB Brotli**;
- JSXGraph vendor: **1,038.7 kB raw / 258.8 kB gzip / 201.3 kB Brotli**;
- native SVG: **no renderer vendor chunk**.

The shared experiment/application chunk was ~62.0 kB raw and is not attributable to native SVG itself.

### Integration/ergonomics evidence

The visual output of native SVG and SVG.js was effectively equivalent in the captured four-bar comparison. Native SVG therefore does not sacrifice the desired schematic quality to obtain its performance/bundle advantage.

JSXGraph required more adaptation to match Atlas's external-state visual language. During the bake-off:

- the package shipped `distrib/jsxgraph.css` but did not expose it through the package export map, requiring a local direct asset import in the experiment;
- JSXGraph changed the host accessibility role to `region`, requiring Atlas to add an appropriate region label;
- the production build reported direct `eval` use in JSXGraph's JessieCode parser;
- its vendor chunk exceeded Vite's 500 kB chunk warning threshold.

These are not claims that JSXGraph is a poor library; they are evidence that it is a poor fit for Atlas's default motion-rendering layer.

## Architectural consequences

The production renderer should preserve this boundary:

```text
SimulationModel + ModelState + current authored parameters
                         ↓
                Atlas scene compiler
                         ↓
                  MechanismScene
                         ↓
             keyed native SVG renderer
```

The scene compiler may resolve authored body-local presentation geometry, but it must not re-solve mechanism physics. Derived tangent points, body poses, ratios, velocities, diagnostics, and other simulated facts come from the simulation/analysis layers.

The SVG renderer owns:

- stable SVG DOM nodes and update scheduling;
- hit targets and pointer capture;
- semantic selection/focus state;
- keyboard/touch interaction surfaces;
- visual primitives and schematic style;
- deterministic SVG export.

The SVG renderer does **not** own:

- linkage closure;
- belt/contact geometry that belongs to the simulation adapter;
- branch/assembly decisions;
- mechanism time integration;
- physical calculations.

## Consequences

### Positive

- zero rendering-library dependency for the core 2D path;
- smallest bundle and best measured performance;
- direct control of accessibility and exported markup;
- straightforward server/static generation of diagrams and thumbnails;
- no third-party rendering state to synchronize with Atlas sessions;
- easy specialization of an Atlas-specific schematic visual language.

### Costs

- Atlas must maintain a small keyed SVG primitive/update layer;
- conveniences such as element wrappers, dynamic geometry constructions, and plot widgets are not obtained automatically;
- interaction/hit-testing/accessibility patterns need shared production utilities rather than being delegated to a rendering library.

These costs are acceptable because the bake-off implemented the required primitive set with modest code and no physics leakage.

## Revisit conditions

Revisit this decision if at least one of the following becomes true:

- a required editing/construction feature would substantially duplicate a mature library;
- profiling shows the Atlas keyed renderer itself has become the bottleneck after production-scale scenes are introduced;
- a library can provide a materially better accessible interaction model without owning mechanism state;
- the default Atlas visual language changes away from SVG-friendly schematic rendering.

A future JSXGraph analysis integration does not require revisiting this ADR unless it is proposed as the default motion renderer.
