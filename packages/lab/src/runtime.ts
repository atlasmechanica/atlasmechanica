import type { ModelId } from '@atlasmechanica/model';
import { beltLabFamily } from './families/belt.js';
import { fourBarLabFamily } from './families/fourBar.js';
import {
  resolveMechanismLabFromFamily,
  type MechanismLabFamily,
  type ResolvedMechanismLab,
} from './family.js';

const FAMILIES_BY_MODEL: Readonly<Record<string, MechanismLabFamily>> = Object.freeze({
  'foundation:belt-drive:open': beltLabFamily,
  'foundation:belt-drive:crossed': beltLabFamily,
  'foundation:four-bar:crank-rocker': fourBarLabFamily,
});

/** Eager resolver intended for server/build-time use. */
export function resolveMechanismLab(
  modelId: ModelId,
  adapterId: string,
  labId?: string,
): ResolvedMechanismLab {
  const family = FAMILIES_BY_MODEL[modelId];
  if (family === undefined) throw new TypeError(`No mechanism lab family for model ${modelId}`);
  return resolveMechanismLabFromFamily(family, modelId, adapterId, labId);
}

export type { ResolvedMechanismLab } from './family.js';
