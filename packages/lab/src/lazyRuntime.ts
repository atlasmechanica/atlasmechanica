import { createLazyMechanismLabResolver } from './familyRegistry.js';

/**
 * Lazy browser resolver. These trusted capability registrations are per family;
 * catalog/model/preset identities do not appear in the module-loading registry.
 */
export const loadMechanismLab = createLazyMechanismLabResolver([
  {
    id: 'atlas.lab.belt.v0',
    adapterIds: ['atlas.analytic-belt.v0', 'atlas.spatial-belt.v0'],
    load: () => import('./families/belt.js').then((module) => module.beltLabFamily),
  },
  {
    id: 'atlas.lab.four-bar.v0',
    adapterIds: ['atlas.analytic-four-bar.v0'],
    load: () => import('./families/fourBar.js').then((module) => module.fourBarLabFamily),
  },
]);

export type { ResolvedMechanismLab } from './family.js';
