# @atlasmechanica/lab

Declarative interaction contracts for Atlas Mechanica mechanism labs.

The lab layer sits between canonical simulation semantics and product UI:

- the catalog says **what the mechanism is**;
- `SimulationModel` says **what is physically true**;
- `MechanismLabDefinition` says **how a learner may explore it**;
- a registered scene compiler turns evaluated state into renderer-neutral `MechanismScene`;
- renderers paint that scene without solving mechanics.

Lab definitions may choose controls, display ranges/units, readouts, initial presentation parameters, camera/renderer capabilities, and direct-manipulation mappings. They must not store solved geometry, animation keyframes, or renderer-owned state.

The registry deliberately resolves models, solver adapters, model-view transforms, and scene compilers by stable IDs. The same resolver is exercised by both the Brown belt definitions and the canonical four-bar fixture so the generic runtime cannot depend on belt-specific branching.
