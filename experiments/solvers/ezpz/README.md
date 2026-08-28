# ezpz four-bar spike

Research for Atlas Mechanica issue #15.

This experiment evaluates `ezpz` 0.2.29 as a **numerical kernel**, not as Atlas's canonical mechanism model.

## Input boundary

The Rust code consumes `packages/kinematics/src/fixtures/fourBarConstraintPlan.json`.
That file is a point-level execution-plan snapshot generated from the canonical
Atlas `SimulationModel` by `compileFourBarConstraintPlan()`. A TypeScript test
requires the committed snapshot to remain exactly equal to compiler output.

The ezpz-specific mapping is deliberately small:

- driver point A: fixed to the prescribed crank position
- ground output pivot O4: fixed
- B: unknown point
- `distance(A, B) = couplerLength`
- `distance(O4, B) = rockerLength`

Warm-start trajectory tests feed the previously solved B position into the
next solve. Cold tests reuse the original configuration seed for every solve.

## Upstream revision

Evaluated release:

- crate: `ezpz = 0.2.29`
- upstream release commit: `915882cc731da31042ce494c89b10334ee57837a`
- release date: 2026-08-05

The crate metadata declares MIT. The upstream root `LICENSE` currently contains
the MIT text but retains the placeholder line `Copyright (c) [year] [fullname]`.
This spike may execute the published crate for evaluation, but Atlas must keep
production adoption/source reuse behind the licensing clarification gate in #13/#15.

## What this spike currently measures

- exact branch preservation for open and crossed configurations
- forward/reverse repeated trajectories
- convergence / unsatisfied counts
- maximum B-point error against an independent circle-intersection oracle
- maximum solver iterations
- cold-start vs warm-start behavior
- end-to-end solve throughput, including ezpz's current per-call model rebuild

WASM and cached-model API experiments come after the native numerical result is
known to be worth carrying forward.
