import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hasErrors, quantity, type ModelState } from '@atlasmechanica/model';
import { compileCatalogDocuments, type CatalogLabTemplate } from '../../catalog/src/authoring.js';
import { discoverCatalogDocuments, readCatalogDocuments } from '../../catalog/src/discoverDocuments.js';
import { assertValidInitialLabState, buildLabEvaluationRequest, defaultLabValues, formatLabReadout } from './core.js';
import { beltLabFamily, openBeltDriveLab, crossedBeltDriveLab, brown003QuarterTurnLab } from './families/belt.js';
import { createLazyMechanismLabResolver } from './familyRegistry.js';
import { resolveMechanismLabFromFamily, type MechanismLabFamily, type ResolvedMechanismLab } from './family.js';
import { loadMechanismLab } from './lazyRuntime.js';
import { resolveMechanismLab, type LabPresentationSelection } from './runtime.js';
import type { MechanismLabDefinition } from './schema.js';

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
const BELT = 'atlas.analytic-belt.v0';
const SPATIAL = 'atlas.spatial-belt.v0';
const catalogSources = await readCatalogDocuments(new URL('../../catalog/fixtures/authoring/', import.meta.url));
const presetSources = await readCatalogDocuments(new URL('../../catalog/fixtures/presets/', import.meta.url));
const presentationSources = await readCatalogDocuments(new URL('../../catalog/fixtures/presentations/', import.meta.url));
const templates: readonly CatalogLabTemplate[] = [
  { id: 'belt:open-classic', adapterId: BELT, definition: openBeltDriveLab },
  { id: 'belt:crossed-classic', adapterId: BELT, definition: crossedBeltDriveLab },
  { id: 'belt:guided-classic', adapterId: SPATIAL, definition: brown003QuarterTurnLab },
];
const options = { models: beltLabFamily.models, labTemplates: templates };
const compiled = compileCatalogDocuments([...catalogSources, ...presetSources, ...presentationSources], options);
function selection(id = 'example:open-lab'): Mutable<LabPresentationSelection> {
  const item = compiled.labPresentations.find((entry) => entry.id === id)!;
  return structuredClone({ templateLabId: item.templateLabId, definition: item.definition }) as Mutable<LabPresentationSelection>;
}
function scalar(state: ModelState, id: string): number {
  const value = state.signals[id];
  if (value?.type !== 'scalar') throw new Error(`Missing scalar ${id}`);
  return value.value.value;
}
function evaluated(resolved: ResolvedMechanismLab, angle = 361) {
  const { definition, model, adapter, sceneCompiler } = resolved;
  const values = { ...defaultLabValues(definition), 'driver-angle': angle };
  const request = buildLabEvaluationRequest(definition, values);
  const session = adapter.compile(model).createSession({ configuration: definition.sessionConfiguration! });
  const state = session.evaluate(request);
  assertValidInitialLabState(definition, state);
  const scene = sceneCompiler.build({ model, state, parameters: request.parameters });
  expect(scene.primitives.length).toBeGreaterThan(0);
  return { values, request, session, state, scene };
}
function patchControl(definition: Mutable<MechanismLabDefinition>, id: string, patch: Record<string, unknown>): void {
  definition.controls = definition.controls.map((control) => control.id === id ? { ...control, ...patch } : control);
}
function registry(load: () => Promise<MechanismLabFamily>) {
  return createLazyMechanismLabResolver([{ id: 'test:belt', adapterIds: [BELT, SPATIAL], load }]);
}

const cases = [
  ['example:open-lab', BELT, 'angular-ratio', 0.75],
  ['example:crossed-lab', BELT, 'angular-ratio', -0.375],
  ['example:guided-lab', SPATIAL, 'output-angular-ratio', 45 / 55],
] as const;

describe('compiled presentations through the public family runtime', () => {
  it.each(cases)('resolves %s without adding the generated lab to a family array', async (id, adapterId, ratioSignal, ratio) => {
    const item = compiled.labPresentations.find((entry) => entry.id === id)!;
    const before = JSON.stringify(beltLabFamily.definitions);
    expect(beltLabFamily.definitions.some((definition) => definition.id === item.id)).toBe(false);
    const wire = JSON.parse(JSON.stringify(item)) as typeof item;
    const eager = resolveMechanismLab(item.definition.modelId, adapterId, item);
    const lazy = await loadMechanismLab(item.definition.modelId, adapterId, wire);
    expect(eager.definition).toEqual(item.definition);
    expect(lazy.definition).toEqual(item.definition);
    const a = evaluated(eager);
    const b = evaluated(lazy);
    expect(b.state.coordinates).toEqual(a.state.coordinates);
    expect(b.state.signals).toEqual(a.state.signals);
    expect(b.scene).toEqual(a.scene);
    expect(scalar(b.state, ratioSignal)).toBeCloseTo(ratio, 12);
    expect(b.state.coordinates['driven-angle']!.position.value).toBeCloseTo(ratio * 361 * Math.PI / 180, 12);
    for (const angle of [359, 361, 721]) {
      const state = b.session.evaluate(buildLabEvaluationRequest(lazy.definition, { ...b.values, 'driver-angle': angle }));
      expect(hasErrors(state)).toBe(false);
      expect(scalar(state, 'belt-travel')).toBeCloseTo(lazy.definition.parameterOverrides!['driver-radius']!.value * angle * Math.PI / 180, 12);
    }
    const readout = lazy.definition.readouts.find((entry) => entry.id === 'speed-ratio')!;
    expect(formatLabReadout(readout, b.state)).toBe(Math.abs(ratio).toFixed(readout.digits));
    b.session.reset(lazy.definition.sessionConfiguration);
    const reset = b.session.evaluate(buildLabEvaluationRequest(lazy.definition, defaultLabValues(lazy.definition)));
    expect(scalar(reset, 'belt-travel')).toBeCloseTo(0, 12);
    expect(JSON.stringify(beltLabFamily.definitions)).toBe(before);
    expect(Object.isFrozen(lazy.definition.controls[0])).toBe(true);
    expect(lazy.definition).not.toBe(item.definition);
    expect(() => resolveMechanismLab(item.definition.modelId, adapterId, item.id)).toThrow('No mechanism lab');
  });

  it('preserves legacy defaults and explicit registered lab IDs', async () => {
    const before = resolveMechanismLab(openBeltDriveLab.modelId, BELT);
    await loadMechanismLab(openBeltDriveLab.modelId, BELT, selection());
    const after = resolveMechanismLab(openBeltDriveLab.modelId, BELT, openBeltDriveLab.id);
    expect(after.definition).toBe(openBeltDriveLab);
    expect(after.definition).toEqual(before.definition);
    expect(after.definition.parameterOverrides?.['driven-radius']).toEqual(quantity(45, 'mm'));
  });

  it('does not depend on object-key serialization order', async () => {
    const reverse = (value: unknown): unknown => Array.isArray(value) ? value.map(reverse)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).reverse().map(([key, nested]) => [key, reverse(nested)])) : value;
    const input = reverse(selection()) as LabPresentationSelection;
    expect((await loadMechanismLab(openBeltDriveLab.modelId, BELT, input)).definition).toEqual(selection().definition);
  });

  it('shares code, not parameter or presentation state, between concurrent same-ID requests', async () => {
    const first = selection();
    const second = selection();
    second.definition.parameterOverrides!['driver-radius'] = quantity(0.04, 'm');
    second.definition.subtitle = 'Independent preset';
    const load = vi.fn(async () => beltLabFamily);
    const resolve = registry(load);
    const [a, b] = await Promise.all([
      resolve(openBeltDriveLab.modelId, BELT, first), resolve(openBeltDriveLab.modelId, BELT, second),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(scalar(evaluated(a).state, 'angular-ratio')).toBeCloseTo(0.75, 12);
    expect(scalar(evaluated(b).state, 'angular-ratio')).toBeCloseTo(2 / 3, 12);
    expect(a.definition.subtitle).not.toBe(b.definition.subtitle);
    expect(first.definition.parameterOverrides!['driver-radius']).toEqual(quantity(0.045, 'm'));
  });

  it('takes ownership before waiting for a lazy family import', async () => {
    let finish!: (family: MechanismLabFamily) => void;
    const imported = new Promise<MechanismLabFamily>((resolve) => { finish = resolve; });
    const resolve = registry(() => imported);
    const input = selection();
    const expected = structuredClone(input.definition);
    const pending = resolve(openBeltDriveLab.modelId, BELT, input);
    input.templateLabId = 'missing';
    input.definition.parameterOverrides!['driver-radius'] = quantity(0.04, 'm');
    input.definition.controls[0]!.initial = 100;
    finish(beltLabFamily);
    const result = await pending;
    expect(result.definition).toEqual(expected);
    expect(Object.isFrozen(input)).toBe(false);
  });

  it('does not evict a loaded family when a presentation fails validation', async () => {
    const load = vi.fn(async () => beltLabFamily);
    const resolve = registry(load);
    const invalid = selection();
    invalid.definition.threeRendererId = 'untrusted-renderer';
    await expect(resolve(openBeltDriveLab.modelId, BELT, invalid)).rejects.toThrow('incompatible');
    expect((await resolve(openBeltDriveLab.modelId, BELT, selection())).definition.id).toBe('example:open-lab');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rejects compilation against an incompatible same-ID template at runtime', async () => {
    const foreign = { ...openBeltDriveLab, threeRendererId: 'foreign-renderer' };
    const result = compileCatalogDocuments([...catalogSources, ...presetSources, ...presentationSources], {
      ...options, labTemplates: templates.map((template) => template.definition.id === foreign.id ? { ...template, definition: foreign } : template),
    });
    const input = result.labPresentations.find((entry) => entry.id === 'example:open-lab')!;
    await expect(loadMechanismLab(openBeltDriveLab.modelId, BELT, input)).rejects.toThrow('incompatible');
  });

  it('keeps coupled-route feasibility with the real adapter and initial-state guard', async () => {
    const input = selection('example:guided-lab');
    input.definition.parameterOverrides!['driver-radius'] = quantity(0.03, 'm');
    const resolved = await loadMechanismLab(input.definition.modelId, SPATIAL, input);
    const state = resolved.adapter.compile(resolved.model).createSession({ configuration: 'reference' })
      .evaluate(buildLabEvaluationRequest(resolved.definition, defaultLabValues(resolved.definition)));
    expect(state.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(() => assertValidInitialLabState(resolved.definition, state)).toThrow('invalid initial state');
  });

  it('retains rejection of inconsistent spatial scene parameters', async () => {
    const input = selection('example:guided-lab');
    const resolved = await loadMechanismLab(input.definition.modelId, SPATIAL, input);
    const result = evaluated(resolved);
    expect(() => resolved.sceneCompiler.build({ model: resolved.model, state: result.state,
      parameters: { ...result.request.parameters, 'driver-radius': quantity(0.03, 'm') },
    })).toThrow();
  });

  it('discovers one new JSON subject/preset/presentation file and uses the unchanged public runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-runtime-presentation-'));
    try {
      for (const source of catalogSources) {
        const path = join(root, source.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, source.text);
      }
      const before = await discoverCatalogDocuments(root, options);
      const subject = before.catalog.subjects.get('open-belt-drive')!;
      const path = join(root, 'independent.atlas.json');
      await writeFile(path, JSON.stringify({ format: 'atlas.catalog-document', schemaVersion: '0.4',
        subjects: [{ ...subject, id: 'synthetic-runtime', slug: 'synthetic-runtime', title: 'Synthetic runtime proof' }],
        modelPresets: [{ id: 'synthetic:preset', modelId: openBeltDriveLab.modelId,
          parameters: { 'driver-radius': quantity(40, 'mm'), 'center-distance': quantity(200, 'mm') } }],
        simulationBindings: [{ subject: 'synthetic-runtime', preset: 'synthetic:preset' }],
        labPresentations: [{ id: 'synthetic:runtime-lab', subject: 'synthetic-runtime', template: 'belt:open-classic',
          settings: { controls: [{ id: 'driver-speed', initial: 50 }], readouts: [{ id: 'speed-ratio', digits: 4 }] } }],
      }));
      const after = await discoverCatalogDocuments(root, options);
      const input = after.labPresentations[0]!;
      const resolved = await loadMechanismLab(input.definition.modelId, BELT, JSON.parse(JSON.stringify(input)) as typeof input);
      expect(resolved.definition.id).toBe('synthetic:runtime-lab');
      expect(defaultLabValues(resolved.definition)['center-distance']).toBe(200);
      expect(defaultLabValues(resolved.definition)['driver-speed']).toBe(50);
      expect(scalar(evaluated(resolved).state, 'angular-ratio')).toBeCloseTo(2 / 3, 12);
      expect(beltLabFamily.definitions.some((definition) => definition.id === input.id)).toBe(false);
      await rm(path);
      expect((await discoverCatalogDocuments(root, options)).labPresentations).toEqual(before.labPresentations);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

const changes: [string, (definition: Mutable<MechanismLabDefinition>) => void][] = [
  ['model identity', (d) => { d.modelId = 'another-model'; }],
  ['default promotion', (d) => { d.defaultForModel = true; }],
  ['renderer binding', (d) => { d.threeRendererId = 'arbitrary-renderer'; }],
  ['scene binding', (d) => { d.sceneCompilerId = 'arbitrary-scene'; }],
  ['model transform', (d) => { d.modelTransformId = 'constructor'; }],
  ['renderer settings', (d) => { d.renderer2d = {}; }],
  ['coordinate binding', (d) => patchControl(d, 'driver-angle', { coordinate: 'driven-angle' })],
  ['display units', (d) => patchControl(d, 'driver-angle', { unit: 'rad' })],
  ['query binding', (d) => patchControl(d, 'driver-angle', { queryKey: 'center' })],
  ['interaction mapping', (d) => patchControl(d, 'driver-angle', { interaction: { handle: 'input', mapping: { type: 'polar-angle', origin: [10, 10] } } })],
  ['missing control', (d) => { d.controls.splice(1, 1); }],
  ['control order', (d) => { d.controls.reverse(); }],
  ['extra control', (d) => { d.controls.push({ ...d.controls[0]!, id: 'extra' }); }],
  ['readout scaling', (d) => { d.readouts.find((r) => r.id === 'speed-ratio')!.scale = 100; }],
  ['readout binding', (d) => { d.readouts.find((r) => r.id === 'speed-ratio')!.source = { kind: 'signal', signal: 'belt-length' }; }],
  ['removed animation', (d) => { delete d.animation; }],
  ['parameter UI drift', (d) => patchControl(d, 'center-distance', { initial: 201 })],
  ['periodic narrowing', (d) => patchControl(d, 'driver-angle', { max: 180 })],
  ['unreachable maximum', (d) => patchControl(d, 'driver-speed', { min: 10, max: 100, step: 7, initial: 31 })],
  ['out-of-domain preset', (d) => { d.parameterOverrides!['driver-radius'] = quantity(-1, 'm'); }],
  ['missing physical baseline', (d) => { delete d.parameterOverrides; }],
  ['incomplete physical baseline', (d) => { delete d.parameterOverrides!['driver-radius']; }],
  ['missing configuration', (d) => { delete d.sessionConfiguration; }],
  ['unknown definition field', (d) => { Object.assign(d, { module: './untrusted.js' }); }],
];
describe('runtime presentation compatibility boundary', () => {
  it.each(changes)('rejects %s without registering a forged lab', async (_name, edit) => {
    const input = selection();
    edit(input.definition);
    expect(() => resolveMechanismLab(openBeltDriveLab.modelId, BELT, input)).toThrow();
    await expect(loadMechanismLab(openBeltDriveLab.modelId, BELT, input)).rejects.toThrow();
    expect(() => resolveMechanismLabFromFamily(beltLabFamily, openBeltDriveLab.modelId, BELT, input)).toThrow();
  });
  it.each(['missing', 'constructor', '__proto__', './untrusted.js'])('rejects unknown template %s', async (templateLabId) => {
    await expect(loadMechanismLab(openBeltDriveLab.modelId, BELT, { ...selection(), templateLabId })).rejects.toThrow('No mechanism lab');
  });
  it('does not fall back for a wrong adapter or model request', async () => {
    await expect(loadMechanismLab(openBeltDriveLab.modelId, SPATIAL, selection())).rejects.toThrow('does not support');
    await expect(loadMechanismLab(crossedBeltDriveLab.modelId, BELT, selection())).rejects.toThrow('No mechanism lab');
  });
  it('rejects getter and array-method injection without invoking it', async () => {
    for (const location of ['selection', 'definition', 'array'] as const) {
      const input = selection();
      const callback = vi.fn(() => []);
      const target = location === 'selection' ? input : location === 'definition' ? input.definition : input.definition.controls;
      Object.defineProperty(target, location === 'array' ? 'map' : 'injected', { get: callback, enumerable: true });
      await expect(loadMechanismLab(openBeltDriveLab.modelId, BELT, input)).rejects.toThrow('accessors');
      expect(callback).not.toHaveBeenCalled();
    }
  });
  it('rejects non-JSON properties, sparse arrays and cycles before loading a family', async () => {
    const bad: LabPresentationSelection[] = [];
    const symbol = selection(); Object.assign(symbol.definition, { [Symbol('x')]: 1 }); bad.push(symbol);
    const method = selection(); Object.assign(method.definition.controls, { map: () => [] }); bad.push(method);
    const sparse = selection(); delete sparse.definition.controls[0]; bad.push(sparse);
    const hidden = selection(); Object.defineProperty(hidden.definition, 'hidden', { value: 1 }); bad.push(hidden);
    const cycle = selection(); Object.assign(cycle.definition, { cycle }); bad.push(cycle);
    const inherited = selection(); Object.setPrototypeOf(inherited.definition, { value: 1 }); bad.push(inherited);
    const nonfinite = selection(); nonfinite.definition.controls[0]!.initial = Number.NaN; bad.push(nonfinite);
    const load = vi.fn(async () => beltLabFamily);
    const resolve = registry(load);
    for (const input of bad) await expect(resolve(openBeltDriveLab.modelId, BELT, input)).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });
});
