import type { ModelId } from '@atlasmechanica/model';
import {
  resolveMechanismLabFromProvider,
  type MechanismLabRuntimeProvider,
  type ResolvedMechanismLab,
} from './provider.js';

type ProviderLoader = () => Promise<MechanismLabRuntimeProvider>;

const PROVIDER_LOADERS: Readonly<Record<string, ProviderLoader>> = Object.freeze({
  'foundation:belt-drive:open': () => import('./providers/belt.js').then((module) => module.beltLabProvider),
  'foundation:belt-drive:crossed': () => import('./providers/belt.js').then((module) => module.beltLabProvider),
  'foundation:four-bar:crank-rocker': () => import('./providers/fourBar.js').then((module) => module.fourBarLabProvider),
});

const providerPromises = new Map<string, Promise<MechanismLabRuntimeProvider>>();

async function loadProvider(modelId: ModelId): Promise<MechanismLabRuntimeProvider> {
  const loader = PROVIDER_LOADERS[modelId];
  if (loader === undefined) throw new TypeError(`No mechanism lab runtime provider for model ${modelId}`);
  let pending = providerPromises.get(modelId);
  if (pending === undefined) {
    pending = loader().catch((error: unknown) => {
      providerPromises.delete(modelId);
      throw error;
    });
    providerPromises.set(modelId, pending);
  }
  return pending;
}

/** Lazy browser resolver: only the selected mechanism family's provider is loaded. */
export async function loadMechanismLab(
  modelId: ModelId,
  adapterId: string,
  labId?: string,
): Promise<ResolvedMechanismLab> {
  const provider = await loadProvider(modelId);
  return resolveMechanismLabFromProvider(provider, modelId, adapterId, labId);
}

export type { ResolvedMechanismLab } from './provider.js';
