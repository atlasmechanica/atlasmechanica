import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hasErrors, instantiateSimulationModel, quantity, type SimulationModel,
} from '@atlasmechanica/model';
import { Ajv } from 'ajv';
import {
  CatalogAuthoringError, compileCatalogDocuments, parseCatalogDocument,
  type CatalogCompileOptions, type CatalogDocument, type ResolvedCatalogLabPresentation,
} from '../../catalog/src/authoring.js';
import { discoverCatalogDocuments } from '../../catalog/src/discoverDocuments.js';
import { canonicalFourBarModel } from '@atlasmechanica/kinematics';
import { canonicalFourBarLab, fourBarLabFamily } from './families/fourBar.js';
import { beltLabFamily, openBeltDriveLab } from './families/belt.js';
import { createLazyMechanismLabResolver } from './familyRegistry.js';
import { resolveMechanismLab } from './runtime.js';
import { loadMechanismLab } from './lazyRuntime.js';
import type { MechanismLabFamily, ResolvedMechanismLab } from './family.js';
import { assertValidInitialLabState, buildLabEvaluationRequest, defaultLabValues } from './core.js';

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const fixtureText = await readFile(new URL('../../../apps/web/tests/fixtures/four-bar-instance.atlas.json', import.meta.url), 'utf8');
const schema = JSON.parse(await readFile(new URL('../../catalog/schema/catalog-document.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ strict: true }).compile(schema);
const MODEL = 'test:four-bar:wide-ground';
const ADAPTER = 'atlas.analytic-four-bar.v0';
const options: CatalogCompileOptions = {
  models: fourBarLabFamily.models,
  labTemplates: [{ id: 'four-bar:canonical', adapterId: ADAPTER, definition: canonicalFourBarLab }],
};
function document(): Mutable<CatalogDocument> { return JSON.parse(fixtureText); }
function source(value: unknown, path = 'instance.atlas.json') { return { path, text: JSON.stringify(value) }; }
function compile(value: unknown = document(), supplied = options) {
  return compileCatalogDocuments([source(value)], supplied);
}
function selection(): Mutable<ResolvedCatalogLabPresentation> {
  return JSON.parse(JSON.stringify(compile().labPresentations[0]!));
}
function run(resolved: ResolvedMechanismLab, values = defaultLabValues(resolved.definition)) {
  const { model, definition, adapter, sceneCompiler } = resolved;
  const session = adapter.compile(model).createSession({ configuration: definition.sessionConfiguration! });
  const request = buildLabEvaluationRequest(definition, values);
  const state = session.evaluate(request);
  assertValidInitialLabState(definition, state);
  const scene = sceneCompiler.build({ model, state, parameters: request.parameters });
  return { session, request, state, scene };
}
async function reject(input: unknown, pattern: string | RegExp = /instance|template/i, modelId = MODEL) {
  const item = input as ResolvedCatalogLabPresentation;
  expect(() => resolveMechanismLab(modelId, ADAPTER, item)).toThrow(pattern);
  await expect(loadMechanismLab(modelId, ADAPTER, item)).rejects.toThrow(pattern);
}
function authoringError(run: () => unknown) {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(CatalogAuthoringError);
    return error as CatalogAuthoringError;
  }
  throw new Error('Expected an authoring error');
}

describe('JSON model instance authoring', () => {
  it('owns an immutable copy without modifying or freezing the supplied template', () => {
    const template = structuredClone(canonicalFourBarModel);
    const before = structuredClone(template);
    const instance = instantiateSimulationModel(template, MODEL);
    expect(instance.model).toEqual({ ...before, id: MODEL });
    expect(instance.templateModelId).toBe(template.id);
    expect(instance.model).not.toBe(template);
    expect(Object.isFrozen(instance.model.systems.mechanical!.bodies)).toBe(true);
    expect(Object.isFrozen(template.systems.mechanical!.bodies)).toBe(false);
    expect(template).toEqual(before);
  });
  it.each(['', ' ', 'Unsafe ID', 'x/../y', canonicalFourBarModel.id])('rejects invalid/colliding instantiation identity %s', (id) => {
    expect(() => instantiateSimulationModel(canonicalFourBarModel, id)).toThrow();
  });
  it('treats prototype-like lowercase identities as data rather than dispatch keys', () => {
    expect(instantiateSimulationModel(canonicalFourBarModel, 'constructor.prototype').id).toBe('constructor.prototype');
  });
  it('rejects structurally broken supplied models at the authoring location', () => {
    const model = structuredClone(canonicalFourBarModel) as Mutable<SimulationModel>;
    delete model.coordinates['driver-angle'];
    const error = authoringError(() => compile(document(), { ...options, models: [model] }));
    expect(error.pointer).toBe('/modelInstances/0/templateModelId');
  });
  it('round-trips 0.5 without altering enclosed model or catalog schema versions', () => {
    const doc = parseCatalogDocument(source(document()));
    expect(doc.schemaVersion).toBe('0.5');
    expect(doc.subjects![0]!.schemaVersion).toBe('0.1');
    const compiled = compile(doc);
    expect(compiled.modelInstances[0]!.model.schemaVersion).toBe(canonicalFourBarModel.schemaVersion);
    expect(JSON.parse(JSON.stringify(compiled.labPresentations))).toEqual(compiled.labPresentations);
    expect(compiled.labPresentations[0]!.modelInstance).toEqual(compiled.modelInstances[0]);
    expect(compiled.modelPresets[0]!.parameters['ground-length']).toEqual(quantity(0.105, 'm'));
  });
  it.each(['0.1', '0.2', '0.3', '0.4'])('does not silently allow instances in version %s', (schemaVersion) => {
    const value = { format: 'atlas.catalog-document', schemaVersion, modelInstances: [] };
    expect(validate(value)).toBe(false);
    expect(authoringError(() => parseCatalogDocument(source(value))).pointer).toBe('/modelInstances');
  });
  it.each([
    { id: MODEL }, { templateModelId: canonicalFourBarModel.id },
    { id: MODEL, templateModelId: 'bad/id' },
    { id: MODEL, templateModelId: canonicalFourBarModel.id, systems: {} },
    { id: MODEL, templateModelId: canonicalFourBarModel.id, parameters: {} },
    { id: MODEL, templateModelId: canonicalFourBarModel.id, module: './code.js' },
  ])('keeps the editor and parser aligned on malformed instance %j', (instance) => {
    const value = { format: 'atlas.catalog-document', schemaVersion: '0.5', modelInstances: [instance] };
    expect(validate(value)).toBe(false);
    expect(() => parseCatalogDocument(source(value))).toThrow(CatalogAuthoringError);
  });
  it('reports unknown roots, collisions, and duplicate instance identities rather than overwriting', () => {
    for (const templateModelId of ['unknown', 'constructor', MODEL]) {
      const doc = document(); doc.modelInstances![0]!.templateModelId = templateModelId;
      expect(authoringError(() => compile(doc)).pointer).toBe('/modelInstances/0/templateModelId');
    }
    const collision = document(); collision.modelInstances![0]!.id = canonicalFourBarModel.id;
    expect(authoringError(() => compile(collision)).pointer).toBe('/modelInstances/0/id');
    const duplicate = document(); duplicate.modelInstances!.push({ ...duplicate.modelInstances![0]! });
    expect(authoringError(() => compile(duplicate)).pointer).toBe('/modelInstances/1/id');
  });
  it('rejects instance chains/cycles regardless of file order', () => {
    const docs = [source({ format: 'atlas.catalog-document', schemaVersion: '0.5', modelInstances: [{ id: 'a', templateModelId: 'b' }] }, 'a.json'),
      source({ format: 'atlas.catalog-document', schemaVersion: '0.5', modelInstances: [{ id: 'b', templateModelId: 'a' }] }, 'b.json')];
    for (const order of [docs, [...docs].reverse()]) {
      expect(authoringError(() => compileCatalogDocuments(order, options)).source).toBe('a.json');
    }
  });
  it('requires a lab template for the actual physical root, not a coincidentally compatible model', () => {
    const foreign = { ...canonicalFourBarLab, modelId: 'foreign:model' };
    const error = authoringError(() => compile(document(), { ...options,
      labTemplates: [{ id: 'four-bar:canonical', adapterId: ADAPTER, definition: foreign }] }));
    expect(error.pointer).toBe('/labPresentations/0/template');
  });
  it('discovers one new file, resolves a new physical identity, and removes it without registrations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-model-instance-'));
    try {
      await mkdir(join(root, 'nested'));
      const path = join(root, 'nested', 'independent.atlas.json');
      await writeFile(path, fixtureText);
      const found = await discoverCatalogDocuments(root, options);
      const presentation = found.labPresentations[0]!;
      expect(fourBarLabFamily.models.some((model) => model.id === MODEL)).toBe(false);
      expect(fourBarLabFamily.definitions.some((lab) => lab.id === presentation.id)).toBe(false);
      const resolved = await loadMechanismLab(MODEL, ADAPTER, presentation);
      expect(run(resolved).scene.primitives.length).toBeGreaterThan(0);
      expect(resolved.model.id).toBe(MODEL);
      await rm(path);
      const removed = await discoverCatalogDocuments(root, options);
      expect(removed.modelInstances).toEqual([]);
      expect(removed.labPresentations).toEqual([]);
      expect(() => resolveMechanismLab(MODEL, ADAPTER, presentation.id)).toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('named physical models through public eager/lazy runtime', () => {
  it('matches existing physics across complete revolutions and reset without any runtime registry addition', async () => {
    const input = selection();
    const eager = resolveMechanismLab(MODEL, ADAPTER, input);
    const lazy = await loadMechanismLab(MODEL, ADAPTER, input);
    const baseline = resolveMechanismLab(canonicalFourBarModel.id, ADAPTER);
    for (const angle of [0, 25, 90, 179, 359, 361, 721]) {
      const values = { ...defaultLabValues(eager.definition), 'driver-angle': angle };
      const a = run(eager, values), b = run(lazy, values), c = run(baseline, values);
      expect(a.state.model).toBe(MODEL);
      expect(b.state.coordinates).toEqual(a.state.coordinates);
      expect(b.state.signals).toEqual(c.state.signals);
      expect(b.state.bodies).toEqual(c.state.bodies);
      expect(b.scene).toEqual(a.scene);
      expect(b.state.bodies.ground).toBeDefined();
      b.session.reset(lazy.definition.sessionConfiguration);
      expect(hasErrors(b.session.evaluate(buildLabEvaluationRequest(lazy.definition, defaultLabValues(lazy.definition))))).toBe(false);
    }
    expect(run(eager).state.signals).not.toEqual(run(baseline).state.signals);
    expect(eager.model).not.toBe(lazy.model);
    expect(eager.model.systems).not.toBe(lazy.model.systems);
    expect(eager.modelInstance).toEqual(input.modelInstance);
    expect(eager.definition.controls.find((control) => control.id === 'ground-length')!.initial).toBe(105);
  });
  it('preserves the existing initial-feasibility boundary', () => {
    const doc = document(); doc.modelPresets![0]!.parameters!['coupler-length'] = quantity(1, 'mm');
    const item = compile(doc).labPresentations[0]!;
    const resolved = resolveMechanismLab(MODEL, ADAPTER, item);
    expect(() => run(resolved)).toThrow('invalid initial state');
  });
  it('does not weaken specialized belt identity checks before their structural replacement', () => {
    const doc = document();
    doc.modelInstances![0]!.templateModelId = openBeltDriveLab.modelId;
    doc.subjects![0]!.simulation!.adapter = 'atlas.analytic-belt.v0';
    doc.modelPresets![0]!.configuration = 'reference';
    doc.modelPresets![0]!.parameters = { 'center-distance': quantity(200, 'mm') };
    doc.labPresentations![0]!.template = 'belt:open';
    const item = compile(doc, { models: beltLabFamily.models,
      labTemplates: [{ id: 'belt:open', adapterId: 'atlas.analytic-belt.v0', definition: openBeltDriveLab }] }).labPresentations[0]!;
    expect(() => resolveMechanismLab(MODEL, 'atlas.analytic-belt.v0', item)).toThrow('Scene compiler');
  });
  it('keeps declared views bounded by the existing capability', () => {
    const doc = document(); doc.labPresentations![0]!.settings!.views = ['2d', '3d'];
    expect(() => compile(doc)).toThrow();
  });
  it('rejects a same-ID build-time model with different topology instead of silently loading another model', async () => {
    const foreign = structuredClone(canonicalFourBarModel) as Mutable<SimulationModel>;
    foreign.systems.mechanical!.bodies.ground!.referencePose.x = quantity(1, 'mm');
    const item = compile(document(), { ...options, models: [foreign] }).labPresentations[0]!;
    await reject(item, 'incompatible with loaded template');
  });
  it.each([
    (item: Mutable<ResolvedCatalogLabPresentation>) => { item.modelInstance!.id = 'wrong'; },
    (item: Mutable<ResolvedCatalogLabPresentation>) => { item.modelInstance!.model.id = 'wrong'; },
    (item: Mutable<ResolvedCatalogLabPresentation>) => { item.modelInstance!.templateModelId = 'unknown'; },
    (item: Mutable<ResolvedCatalogLabPresentation>) => { item.modelInstance!.model.subject = 'belt-drive'; },
    (item: Mutable<ResolvedCatalogLabPresentation>) => { item.modelInstance!.model.parameters['ground-length']!.default.value = 106; },
    (item: Mutable<ResolvedCatalogLabPresentation>) => { item.modelInstance!.model.coordinates['driver-angle']!.role = 'output'; },
    (item: Mutable<ResolvedCatalogLabPresentation>) => { delete item.modelInstance!.model.systems.mechanical!.bodies.crank; },
    (item: Mutable<ResolvedCatalogLabPresentation>) => { delete item.modelInstance; },
  ])('rejects identity/topology tampering %# in both public resolvers', async (mutate) => {
    const item = selection(); mutate(item); await reject(item, /instance|template|lab/i);
  });
  it.each([null, [], {}, { templateModelId: '' }, { templateModelId: 'missing', code: true }].map((modelInstance) => ({ modelInstance })))('rejects malformed model instance $modelInstance', async ({ modelInstance }) => {
    await reject({ ...selection(), modelInstance });
  });
  it('rejects model-instance replacement of a registered model', async () => {
    const item = selection();
    await reject(item, 'collides with registered', canonicalFourBarModel.id);
  });
  it('ignores object key order but not changes to model data', async () => {
    const reverse = (value: unknown): unknown => Array.isArray(value) ? value.map(reverse)
      : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value;
    const input = selection();
    const result = await loadMechanismLab(MODEL, ADAPTER, reverse(input) as typeof input);
    expect(result.modelInstance).toEqual(input.modelInstance);
  });
  it('snapshots before a deferred import and caches family code, not model instances or presets', async () => {
    let finish!: (family: MechanismLabFamily) => void;
    const pendingFamily = new Promise<MechanismLabFamily>((resolve) => { finish = resolve; });
    const load = vi.fn(() => pendingFamily);
    const resolve = createLazyMechanismLabResolver([{ id: 'four-bar', adapterIds: [ADAPTER], load }]);
    const first = selection();
    const second = selection();
    second.definition.parameterOverrides!['ground-length'] = quantity(0.110, 'm');
    second.definition.controls.find((control) => control.id === 'ground-length')!.initial = 110;
    const a = resolve(MODEL, ADAPTER, first), b = resolve(MODEL, ADAPTER, second);
    first.modelInstance!.model.id = 'mutated-after-call';
    finish(fourBarLabFamily);
    const [left, right] = await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(left.model.id).toBe(MODEL);
    expect(left.model).not.toBe(right.model);
    expect(run(left).state.signals).not.toEqual(run(right).state.signals);
    const bad = selection(); bad.modelInstance!.model.id = 'wrong';
    await expect(resolve(MODEL, ADAPTER, bad)).rejects.toThrow();
    expect((await resolve(MODEL, ADAPTER, selection())).model.id).toBe(MODEL);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('rejects model-instance accessors without invoking them or loading the family', async () => {
    const getter = vi.fn(() => canonicalFourBarModel);
    const item = selection(); Object.defineProperty(item.modelInstance!, 'model', { get: getter });
    const load = vi.fn(async () => fourBarLabFamily);
    const resolve = createLazyMechanismLabResolver([{ id: 'four-bar', adapterIds: [ADAPTER], load }]);
    await expect(resolve(MODEL, ADAPTER, item)).rejects.toThrow('accessors');
    expect(getter).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
});
