import { describe, expect, it, vi } from 'vitest';
import { hasErrors, quantity } from '@atlasmechanica/model';
import { buildLabEvaluationRequest, defaultLabValues } from './core.js';
import type { MechanismLabFamily, ResolvedMechanismLab } from './family.js';
import { beltLabFamily, openBeltDriveLab, crossedBeltDriveLab, brown003QuarterTurnLab } from './families/belt.js';
import { fourBarLabFamily, canonicalFourBarLab } from './families/fourBar.js';
import {
  createLazyMechanismLabResolver, createMechanismLabResolver,
  type LazyMechanismLabFamilyRegistration,
} from './familyRegistry.js';
import { loadMechanismLab } from './lazyRuntime.js';
import { resolveMechanismLab } from './runtime.js';

const BELT = 'atlas.analytic-belt.v0';
const SPATIAL = 'atlas.spatial-belt.v0';
const FOUR_BAR = 'atlas.analytic-four-bar.v0';
const cases = [
  { definition: openBeltDriveLab, adapter: BELT },
  { definition: crossedBeltDriveLab, adapter: BELT },
  { definition: brown003QuarterTurnLab, adapter: SPATIAL },
  { definition: canonicalFourBarLab, adapter: FOUR_BAR },
];
function beltRegistration(load: () => Promise<MechanismLabFamily> = async () => beltLabFamily): LazyMechanismLabFamilyRegistration {
  return { id: 'test:belt-family', adapterIds: [BELT, SPATIAL], load };
}
function evaluate(resolved: ResolvedMechanismLab, angle = 361) {
  const { definition, model, adapter, sceneCompiler } = resolved;
  const values = { ...defaultLabValues(definition), 'driver-angle': angle };
  const request = buildLabEvaluationRequest(definition, values);
  const session = adapter.compile(model).createSession(definition.sessionConfiguration === undefined
    ? undefined : { configuration: definition.sessionConfiguration });
  const state = session.evaluate(request);
  expect(hasErrors(state)).toBe(false);
  const scene = sceneCompiler.build({ model, state, parameters: request.parameters });
  expect(scene.primitives.length).toBeGreaterThan(0);
  return { state, scene, request };
}

describe('family-level runtime routing', () => {
  it.each(cases)('preserves eager/lazy physical state and scene for $definition.id', async ({ definition, adapter }) => {
    const eager = resolveMechanismLab(definition.modelId, adapter, definition.id);
    const lazy = await loadMechanismLab(definition.modelId, adapter, definition.id);
    expect(lazy.definition).toEqual(eager.definition);
    const left = evaluate(eager);
    const right = evaluate(lazy);
    expect(right.state.coordinates).toEqual(left.state.coordinates);
    expect(right.state.signals).toEqual(left.state.signals);
    expect(right.state.diagnostics).toEqual(left.state.diagnostics);
    expect(right.scene).toEqual(left.scene);
  });

  it('shares an in-flight family load across different models and adapters', async () => {
    let finish!: (family: MechanismLabFamily) => void;
    const imported = new Promise<MechanismLabFamily>((resolve) => { finish = resolve; });
    const load = vi.fn(() => imported);
    const unrelated = vi.fn(async () => fourBarLabFamily);
    const resolve = createLazyMechanismLabResolver([
      beltRegistration(load), { id: 'test:four-bar-family', adapterIds: [FOUR_BAR], load: unrelated },
    ]);
    const requests = [
      resolve(openBeltDriveLab.modelId, BELT),
      resolve(crossedBeltDriveLab.modelId, BELT),
      resolve(brown003QuarterTurnLab.modelId, SPATIAL),
    ];
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(unrelated).not.toHaveBeenCalled();
    finish(beltLabFamily);
    expect((await Promise.all(requests)).map((item) => item.model.id)).toEqual([
      openBeltDriveLab.modelId, crossedBeltDriveLab.modelId, brown003QuarterTurnLab.modelId,
    ]);
    await resolve(openBeltDriveLab.modelId, BELT);
    expect(load).toHaveBeenCalledTimes(1);
    await resolve(canonicalFourBarLab.modelId, FOUR_BAR);
    expect(unrelated).toHaveBeenCalledTimes(1);
  });

  it.each(['sync', 'async'] as const)('retries a %s loader failure without evicting another family', async (mode) => {
    let fail = true;
    const load = vi.fn(() => {
      if (fail) {
        if (mode === 'sync') throw new Error('temporary import failure');
        return Promise.reject(new Error('temporary import failure'));
      }
      return Promise.resolve(beltLabFamily);
    });
    const other = vi.fn(async () => fourBarLabFamily);
    const resolve = createLazyMechanismLabResolver([
      beltRegistration(load), { id: 'test:four-bar-family', adapterIds: [FOUR_BAR], load: other },
    ]);
    await resolve(canonicalFourBarLab.modelId, FOUR_BAR);
    const failed = await Promise.allSettled([
      resolve(openBeltDriveLab.modelId, BELT), resolve(brown003QuarterTurnLab.modelId, SPATIAL),
    ]);
    expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(load).toHaveBeenCalledTimes(1);
    fail = false;
    await Promise.all([resolve(openBeltDriveLab.modelId, BELT), resolve(crossedBeltDriveLab.modelId, BELT)]);
    await resolve(canonicalFourBarLab.modelId, FOUR_BAR);
    expect(load).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'constructor', '__proto__', 'toString', './untrusted.js'])('rejects unknown capability %s without loading a family', async (adapter) => {
    const load = vi.fn(async () => beltLabFamily);
    const lazy = createLazyMechanismLabResolver([beltRegistration(load)]);
    const eager = createMechanismLabResolver([{ id: 'test:belt-family', family: beltLabFamily }]);
    await expect(lazy(openBeltDriveLab.modelId, adapter)).rejects.toThrow('No mechanism lab family for adapter');
    expect(() => eager(openBeltDriveLab.modelId, adapter)).toThrow('No mechanism lab family for adapter');
    expect(load).not.toHaveBeenCalled();
  });

  it('never scans an unrelated family to rescue a wrong model/adapter pair', async () => {
    const load = vi.fn(async () => beltLabFamily);
    const other = vi.fn(async () => fourBarLabFamily);
    const resolve = createLazyMechanismLabResolver([
      beltRegistration(load), { id: 'test:four-bar-family', adapterIds: [FOUR_BAR], load: other },
    ]);
    await expect(resolve(canonicalFourBarLab.modelId, BELT)).rejects.toThrow('No mechanism lab definition');
    await expect(resolve(openBeltDriveLab.modelId, SPATIAL)).rejects.toThrow('does not support');
    await expect(resolve(openBeltDriveLab.modelId, BELT, 'unknown-lab')).rejects.toThrow('No mechanism lab');
    expect(other).not.toHaveBeenCalled();
    await resolve(openBeltDriveLab.modelId, BELT);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('snapshots registration metadata without freezing caller data', async () => {
    const original = vi.fn(async () => beltLabFamily);
    const replacement = vi.fn(async () => fourBarLabFamily);
    const registration = { id: 'test:belt-family', adapterIds: [BELT, SPATIAL], load: original };
    const registrations = [registration];
    const resolve = createLazyMechanismLabResolver(registrations);
    registration.id = 'changed';
    registration.adapterIds.splice(0, 2, FOUR_BAR);
    registration.load = replacement;
    registrations.length = 0;
    expect(Object.isFrozen(registration)).toBe(false);
    expect((await resolve(openBeltDriveLab.modelId, BELT)).model.id).toBe(openBeltDriveLab.modelId);
    expect(original).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
    await expect(resolve(canonicalFourBarLab.modelId, FOUR_BAR)).rejects.toThrow('No mechanism lab family');
  });

  it('rejects ambiguous family and capability ownership at registration time', () => {
    const entry = beltRegistration();
    expect(() => createLazyMechanismLabResolver([entry, entry])).toThrow('Duplicate mechanism lab family');
    expect(() => createLazyMechanismLabResolver([entry, { ...entry, id: 'other' }])).toThrow('owned by both');
    expect(() => createLazyMechanismLabResolver([{ ...entry, adapterIds: [BELT, BELT] }])).toThrow('Duplicate adapter');
    expect(() => createLazyMechanismLabResolver([{ ...entry, adapterIds: [] }])).toThrow('advertises no adapters');
    expect(() => createLazyMechanismLabResolver([{ ...entry, adapterIds: [''] }])).toThrow('Invalid adapter');
    expect(() => createLazyMechanismLabResolver([{ ...entry, id: ' ' }])).toThrow('Invalid mechanism lab family');
    expect(() => createMechanismLabResolver([
      { id: 'a', family: beltLabFamily }, { id: 'b', family: beltLabFamily },
    ])).toThrow('owned by both');
  });

  it('rejects drift between lazy capability metadata and the actual module, then permits retry', async () => {
    let family: MechanismLabFamily = { ...beltLabFamily, adapters: [beltLabFamily.adapters[0]!] };
    const load = vi.fn(async () => family);
    const resolve = createLazyMechanismLabResolver([beltRegistration(load)]);
    await expect(resolve(openBeltDriveLab.modelId, BELT)).rejects.toThrow('advertised adapters');
    family = beltLabFamily;
    await resolve(openBeltDriveLab.modelId, BELT);
    expect(load).toHaveBeenCalledTimes(2);
    const extra = createLazyMechanismLabResolver([{ ...beltRegistration(), adapterIds: [BELT] }]);
    await expect(extra(openBeltDriveLab.modelId, BELT)).rejects.toThrow('advertised adapters');
  });

  it.each(['adapters', 'models', 'definitions', 'sceneCompilers'] as const)('rejects duplicate identities in loaded %s', async (key) => {
    const family = { ...beltLabFamily, [key]: [...beltLabFamily[key], beltLabFamily[key][0]!] } as MechanismLabFamily;
    const resolve = createLazyMechanismLabResolver([beltRegistration(async () => family)]);
    await expect(resolve(openBeltDriveLab.modelId, BELT)).rejects.toThrow('Duplicate');
    expect(() => createMechanismLabResolver([{ id: 'test:belt-family', family }])).toThrow('Duplicate');
  });

  it('keeps family model/scene support guards rather than accepting a familiar model id alone', async () => {
    const base = beltLabFamily.models.find((model) => model.id === openBeltDriveLab.modelId)!;
    const incompatible = { ...base, systems: {} };
    const family = {
      ...beltLabFamily,
      models: beltLabFamily.models.map((model) => model.id === base.id ? incompatible : model),
    };
    const resolve = createLazyMechanismLabResolver([beltRegistration(async () => family)]);
    await expect(resolve(base.id, BELT)).rejects.toThrow();
    const badSceneFamily = {
      ...beltLabFamily,
      definitions: beltLabFamily.definitions.map((definition) => definition.id === openBeltDriveLab.id
        ? { ...definition, sceneCompilerId: 'unregistered-scene' } : definition),
    };
    const badScene = createMechanismLabResolver([{ id: 'test:belt-family', family: badSceneFamily }]);
    expect(() => badScene(base.id, BELT)).toThrow('No registered scene compiler');
  });

  it('routes an independently identified supported four-bar configuration without a model-id routing entry', async () => {
    const model = structuredClone(fourBarLabFamily.models[0]!);
    model.id = 'test:four-bar:independent';
    model.parameters['ground-length']!.default = quantity(105, 'mm');
    const definition = {
      ...canonicalFourBarLab, id: 'test:four-bar:independent-lab', modelId: model.id,
      controls: canonicalFourBarLab.controls.map((control) => control.id === 'ground-length'
        ? { ...control, initial: 105 } : control),
    };
    const family = { ...fourBarLabFamily, models: [model], definitions: [definition] };
    const eager = createMechanismLabResolver([{ id: 'test:four-bar-family', family }]);
    const load = vi.fn(async () => family);
    const lazy = createLazyMechanismLabResolver([{ id: 'test:four-bar-family', adapterIds: [FOUR_BAR], load }]);
    const result = await lazy(model.id, FOUR_BAR, definition.id);
    expect(result.model.id).toBe(model.id);
    expect(result.model.parameters['ground-length']!.default).toEqual(quantity(105, 'mm'));
    const actual = evaluate(result, 90);
    const expected = evaluate(eager(model.id, FOUR_BAR, definition.id), 90);
    expect(actual.state.coordinates).toEqual(expected.state.coordinates);
    expect(actual.state.signals).toEqual(expected.state.signals);
    expect(load).toHaveBeenCalledTimes(1);
    // This proves routing + existing four-bar structural support, not JSON model
    // instantiation or broader support in the still-specialized belt compilers.
  });
});
