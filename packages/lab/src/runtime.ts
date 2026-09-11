import { beltLabFamily } from './families/belt.js';
import { fourBarLabFamily } from './families/fourBar.js';
import { createMechanismLabResolver } from './familyRegistry.js';

/** Eager server/build resolver. Register a family once, not each model or occurrence. */
export const resolveMechanismLab = createMechanismLabResolver([
  { id: 'atlas.lab.belt.v0', family: beltLabFamily },
  { id: 'atlas.lab.four-bar.v0', family: fourBarLabFamily },
]);

export type { ResolvedMechanismLab } from './family.js';
export type { LabPresentationSelection, MechanismLabSelection } from './presentationSelection.js';
