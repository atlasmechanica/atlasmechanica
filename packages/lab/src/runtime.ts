import type { ModelId } from '@atlasmechanica/model';
import { beltLabProvider } from './providers/belt.js';
import { fourBarLabProvider } from './providers/fourBar.js';
import {
  resolveMechanismLabFromProvider,
  type MechanismLabRuntimeProvider,
  type ResolvedMechanismLab,
} from './provider.js';

const PROVIDERS_BY_MODEL: Readonly<Record<string, MechanismLabRuntimeProvider>> = Object.freeze({
  'foundation:belt-drive:open': beltLabProvider,
  'foundation:belt-drive:crossed': beltLabProvider,
  'foundation:four-bar:crank-rocker': fourBarLabProvider,
});

/** Eager resolver intended for server/build-time use. */
export function resolveMechanismLab(
  modelId: ModelId,
  adapterId: string,
  labId?: string,
): ResolvedMechanismLab {
  const provider = PROVIDERS_BY_MODEL[modelId];
  if (provider === undefined) throw new TypeError(`No mechanism lab runtime provider for model ${modelId}`);
  return resolveMechanismLabFromProvider(provider, modelId, adapterId, labId);
}

export type { ResolvedMechanismLab } from './provider.js';
