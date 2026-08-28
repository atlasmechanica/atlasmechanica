# ezpz planar-kernel spike

Research for Atlas Mechanica issue #15.

This experiment evaluates `ezpz` 0.2.29 as a **generic numerical kernel**, not as Atlas's canonical mechanism model.

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
The exact geometric comparison is independently recomputed by circle
intersection inside the Rust experiment.

## Upstream revision

Evaluated release:

- crate: `ezpz = 0.2.29`
- upstream release commit: `915882cc731da31042ce494c89b10334ee57837a`
- release date: 2026-08-05

The crate metadata declares MIT. The upstream root `LICENSE` currently contains
the MIT text but retains the placeholder line `Copyright (c) [year] [fullname]`.
This spike may execute the published crate for evaluation, but Atlas keeps
production adoption/source reuse behind the licensing clarification gate in
#13/#15.

## Findings

### Canonical crank-rocker

Both open and crossed configurations completed 0→720°→0° in 1° increments
with:

- zero solver failures
- zero non-convergence
- zero unsatisfied samples
- zero branch jumps
- maximum B-point error ≈ `1.37e-12 m`
- at most 3 iterations with warm continuation
- roughly 90k–100k native solves/second on the GitHub Ubuntu runner

Cold solves from the original branch seed also completed without branch jumps,
at roughly 65k–75k solves/second and at most 5 iterations.

The throughput includes `ezpz::solve()` rebuilding its currently private
internal `Model` on every call. For a four-bar this cost is plainly not a
product bottleneck.

### Parameter edits

A dedicated test changes the coupler from 80 mm to 85 mm at a live pose,
warm-starts from the prior solved state, and then restores the original length.
Both edits retain the intended configuration and solve within Atlas's current
position tolerance.

### Root coalescence / physical singularity

An exact parallelogram was used because the intended continuous solution passes
through an aligned configuration where the two ordinary geometric roots meet.
That is a harder continuation problem than the canonical crank-rocker.

For -30°→+30° in 0.25° steps:

- previous-pose-only continuation: max error ≈ `1.28e-7 m`, max 10 iterations
- linear extrapolation from the previous two poses: max error ≈ `2.49e-9 m`, max 3 iterations
- neither policy jumped to the wrong physical path

The CI gate requires the extrapolated policy to remain below `1e-8 m` for this
100 mm test mechanism.

This supports an Atlas-owned continuation policy:

1. named configuration/body-pose seed for cold arbitrary evaluation,
2. prior state for ordinary motion,
3. velocity/extrapolation-informed seed near singular configurations,
4. explicit `physical-singularity` / `branch-ambiguity` diagnostics where
   position alone cannot uniquely define the outgoing motion.

A static orientation sign is useful for some configurations but is **not** the
universal definition of assembly identity.

### Raw WebAssembly

The same Rust solver mapping compiles directly to `wasm32-unknown-unknown` and
instantiates in Node/V8 using the raw WebAssembly API with no wasm-bindgen or
JavaScript solver glue.

Representative CI result:

- raw module: ~648 kB
- gzip: ~206 kB
- Brotli: ~162 kB
- canonical branch validation failures: 0
- 50,000 warm solves: ~61k solves/second in V8 WASM

This is already far beyond interactive requirements for individual mechanism
views. Browser/UI integration should therefore optimize ergonomics and
correctness before solver micro-performance.

## Provisional decision

**`ezpz` is the provisional preferred generic planar numerical kernel for
Atlas Mechanica.**

That does not mean it becomes the model, the only solver, or a production
dependency yet.

Atlas should continue to:

- use exact analytic adapters where they are simpler and more explanatory,
- keep `SimulationModel` / body topology solver-neutral,
- compile generic linkages into an ezpz constraint execution plan,
- keep continuation/configuration semantics in Atlas sessions,
- derive p/v/a through a deliberate derivative layer rather than assuming a
  position solver owns all analysis.

Production integration remains contingent on:

1. clarifying the upstream license-file placeholder,
2. designing a reusable data-driven WASM ABI instead of the fixture-bound raw
   exports used by this spike,
3. deciding the Jacobian/differentiation strategy for velocity and
   acceleration,
4. broadening fixtures to prismatic and more complex planar topology before
   declaring the kernel generally sufficient.

The live PR bot comment is the authoritative benchmark output for the current
revision; this document records the architectural conclusions rather than
freezing runner-dependent timing numbers.
