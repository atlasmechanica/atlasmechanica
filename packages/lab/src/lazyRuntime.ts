import type { ModelId } from '@atlasmechanica/model';
import {
  resolveMechanismLabFromFamily,
  type MechanismLabFamily,
  type ResolvedMechanismLab,
} from './family.js';

type FamilyLoader = () => Promise<MechanismLabFamily>;

const FAMILY_LOADERS: Readonly<Record<string, FamilyLoader>> = Object.freeze({
  'foundation:belt-drive:open': () => import('./families/belt.js').then((module) => module.beltLabFamily),
  'foundation:belt-drive:crossed': () => import('./families/belt.js').then((module) => module.beltLabFamily),
  'foundation:belt-drive:quarter-turn-guided': () => import('./families/belt.js').then((module) => module.beltLabFamily),
  'foundation:four-bar:crank-rocker': () => import('./families/fourBar.js').then((module) => module.fourBarLabFamily),
});

const familyPromises = new Map<string, Promise<MechanismLabFamily>>();

async function loadFamily(modelId: ModelId): Promise<MechanismLabFamily> {
  const loader = FAMILY_LOADERS[modelId];
  if (loader === undefined) throw new TypeError(`No mechanism lab family for model ${modelId}`);
  let pending = familyPromises.get(modelId);
  if (pending === undefined) {
    pending = loader().catch((error: unknown) => {
      familyPromises.delete(modelId);
      throw error;
    });
    familyPromises.set(modelId, pending);
  }
  return pending;
}

/** Lazy browser resolver: only the selected mechanism family is loaded. */
export async function loadMechanismLab(
  modelId: ModelId,
  adapterId: string,
  labId?: string,
): Promise<ResolvedMechanismLab> {
  const family = await loadFamily(modelId);
  return resolveMechanismLabFromFamily(family, modelId, adapterId, labId);
}

export type { ResolvedMechanismLab } from './family.js';
