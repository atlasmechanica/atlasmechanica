import type { ModelId } from '@atlasmechanica/model';
import {
  resolveMechanismLabFromFamily,
  type MechanismLabFamily,
  type ResolvedMechanismLab,
} from './family.js';
import { snapshotLabSelection, type MechanismLabSelection } from './presentationSelection.js';

/** Trusted application registrations, never module paths supplied by a manifest. */
export interface MechanismLabFamilyRegistration {
  readonly id: string;
  readonly family: MechanismLabFamily;
}
export interface LazyMechanismLabFamilyRegistration {
  readonly id: string;
  /** Lightweight capability metadata, checked against the loaded family. */
  readonly adapterIds: readonly string[];
  readonly load: () => Promise<MechanismLabFamily>;
}

function uniqueIds(values: readonly string[], description: string): Set<string> {
  const ids = new Set<string>();
  for (const id of values) {
    if (typeof id !== 'string' || id.trim() === '') throw new TypeError(`Invalid ${description} id`);
    if (ids.has(id)) throw new TypeError(`Duplicate ${description} id ${id}`);
    ids.add(id);
  }
  return ids;
}

/** One owner per adapter capability; ambiguous registrations never use first-match wins. */
function indexByAdapter<T extends { readonly id: string; readonly adapterIds: readonly string[] }>(
  registrations: readonly T[],
): ReadonlyMap<string, T> {
  uniqueIds(registrations.map((registration) => registration.id), 'mechanism lab family');
  const byAdapter = new Map<string, T>();
  for (const registration of registrations) {
    const adapters = uniqueIds(registration.adapterIds, `adapter in family ${registration.id}`);
    if (adapters.size === 0) throw new TypeError(`Mechanism lab family ${registration.id} advertises no adapters`);
    for (const adapter of adapters) {
      const owner = byAdapter.get(adapter);
      if (owner !== undefined) {
        throw new TypeError(`Adapter ${adapter} is owned by both ${owner.id} and ${registration.id}`);
      }
      byAdapter.set(adapter, registration);
    }
  }
  return byAdapter;
}

function requireRegistration<T>(registrations: ReadonlyMap<string, T>, adapterId: string): T {
  const registration = registrations.get(adapterId);
  if (registration === undefined) throw new TypeError(`No mechanism lab family for adapter ${adapterId}`);
  return registration;
}

function validateFamily(family: MechanismLabFamily, id: string, advertised: readonly string[]): void {
  const actual = uniqueIds(family.adapters.map((adapter) => adapter.id), `adapter in family ${id}`);
  if (actual.size !== advertised.length || advertised.some((adapter) => !actual.has(adapter))) {
    throw new TypeError(`Loaded mechanism lab family ${id} does not match its advertised adapters`);
  }
  uniqueIds(family.models.map((model) => model.id), `model in family ${id}`);
  uniqueIds(family.definitions.map((definition) => definition.id), `lab in family ${id}`);
  uniqueIds(family.sceneCompilers.map((compiler) => compiler.id), `scene compiler in family ${id}`);
}

/** Build-time routing indexes actual family capabilities, never catalog/model IDs. */
export function createMechanismLabResolver(registrations: readonly MechanismLabFamilyRegistration[]) {
  const snapshots = registrations.map(({ id, family }) => ({
    id, family, adapterIds: family.adapters.map((adapter) => adapter.id),
  }));
  const byAdapter = indexByAdapter(snapshots);
  for (const registration of snapshots) {
    validateFamily(registration.family, registration.id, registration.adapterIds);
  }
  return (modelId: ModelId, adapterId: string, lab?: MechanismLabSelection): ResolvedMechanismLab => {
    const { family } = requireRegistration(byAdapter, adapterId);
    return resolveMechanismLabFromFamily(family, modelId, adapterId, lab);
  };
}

/**
 * Lazy routing loads one capability owner and shares one in-flight promise across
 * every model and adapter in that family. Failed imports/descriptor checks evict
 * only that family's promise; an invalid model request does not poison the cache.
 */
export function createLazyMechanismLabResolver(registrations: readonly LazyMechanismLabFamilyRegistration[]) {
  const snapshots = registrations.map(({ id, adapterIds, load }) => {
    if (typeof load !== 'function') throw new TypeError(`Mechanism lab family ${id} needs a loader`);
    return { id, adapterIds: [...adapterIds], load };
  });
  const byAdapter = indexByAdapter(snapshots);
  const pendingFamilies = new Map<string, Promise<MechanismLabFamily>>();
  return async (modelId: ModelId, adapterId: string, lab?: MechanismLabSelection): Promise<ResolvedMechanismLab> => {
    const registration = requireRegistration(byAdapter, adapterId);
    const selection = snapshotLabSelection(lab);
    let pending = pendingFamilies.get(registration.id);
    if (pending === undefined) {
      // Defer invocation so a synchronous loader throw is also retryable, and
      // simultaneous requests see the promise before the loader starts running.
      pending = Promise.resolve().then(() => registration.load()).then((family) => {
        validateFamily(family, registration.id, registration.adapterIds);
        return family;
      }).catch((error: unknown) => {
        if (pendingFamilies.get(registration.id) === pending) pendingFamilies.delete(registration.id);
        throw error;
      });
      pendingFamilies.set(registration.id, pending);
    }
    const family = await pending;
    // Each presentation is resolved independently; only family code is cached.
    return resolveMechanismLabFromFamily(family, modelId, adapterId, selection);
  };
}
