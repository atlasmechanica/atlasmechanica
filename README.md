# Atlas Mechanica

**Understand how machines move.**

Atlas Mechanica is an open, interactive atlas of mechanisms and machines connecting simulation, mathematics, history, lineage, applications, and learning.

Brown's *Five Hundred and Seven Mechanical Movements* is the first collection, not the product hierarchy. Canonical subjects, executable models, historical sources, functional relationships, and learning paths are separate reusable layers.

## Foundation

The first implementation work is intentionally small:

- `packages/model` — portable `SimulationModel` / `ModelState` contracts and validation
- `packages/kinematics` — solver-neutral runtime adapters and canonical mechanism fixtures

The architecture and research roadmap live in [GitHub issue #1](https://github.com/atlasmechanica/atlasmechanica/issues/1).

## Principles

- Atlas owns semantic mechanism data, not solver-specific constraints.
- Rendering consumes physical state; it does not define physics.
- Canonical models are serializable and deterministic.
- Equations, analysis, simulation, and educational explanations should share the same underlying model and source provenance.
- Historical source material retains its actual rights status rather than being blanket relicensed by Atlas.
