import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { quantity, type ModelState } from '@atlasmechanica/model';
import {
  CatalogAuthoringError, compileCatalogDocuments, parseCatalogDocument,
  type CatalogCompileOptions, type CatalogDocument, type CatalogLabTemplate,
} from '../../catalog/src/authoring.js';
import { discoverCatalogDocuments, readCatalogDocuments } from '../../catalog/src/discoverDocuments.js';
import { assertValidInitialLabState, buildLabEvaluationRequest, defaultLabValues, formatLabReadout } from './core.js';
import { resolveMechanismLabFromFamily } from './family.js';
import { beltLabFamily, openBeltDriveLab, crossedBeltDriveLab, brown003QuarterTurnLab } from './families/belt.js';
import { LabPresentationError, validateLabPresentationSettings } from './presentation.js';
import type { MechanismLabDefinition } from './schema.js';

const catalogSources = await readCatalogDocuments(new URL('../../catalog/fixtures/authoring/', import.meta.url));
const presetSources = await readCatalogDocuments(new URL('../../catalog/fixtures/presets/', import.meta.url));
const labSources = await readCatalogDocuments(new URL('../../catalog/fixtures/presentations/', import.meta.url));
const templates: readonly CatalogLabTemplate[] = [
  { id: 'belt:open-classic', adapterId: 'atlas.analytic-belt.v0', definition: openBeltDriveLab },
  { id: 'belt:crossed-classic', adapterId: 'atlas.analytic-belt.v0', definition: crossedBeltDriveLab },
  { id: 'belt:guided-classic', adapterId: 'atlas.spatial-belt.v0', definition: brown003QuarterTurnLab },
];
const options = { models: beltLabFamily.models, labTemplates: templates };
const baseSources = [...catalogSources, ...presetSources];
const baseline = { id: 'example:lab', subject: 'open-belt-drive', template: 'belt:open-classic' };
function source(body: Record<string, unknown>, path = 'lab.json') {
  return { path, text: JSON.stringify({ format: 'atlas.catalog-document', schemaVersion: '0.4', ...body }) };
}
function compile(presentation: Record<string, unknown> = {}, supplied: CatalogCompileOptions = options) {
  return compileCatalogDocuments([...baseSources, source({ labPresentations: [{ ...baseline, ...presentation }] })], supplied);
}
function errorFrom(run: () => unknown): CatalogAuthoringError {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(CatalogAuthoringError);
    return error as CatalogAuthoringError;
  }
  throw new Error('Expected authoring error');
}
function scalar(state: ModelState, id: string) {
  const signal = state.signals[id];
  if (signal?.type !== 'scalar') throw new Error(`Missing scalar ${id}`);
  return signal.value.value;
}
function suppliedTemplate(definition: MechanismLabDefinition): CatalogCompileOptions {
  return { ...options, labTemplates: [{ ...templates[0]!, definition }] };
}
function withPreset(id: string, parameters: Record<string, ReturnType<typeof quantity>>) {
  const document = parseCatalogDocument(presetSources[0]!);
  return [...catalogSources, source({
    ...document,
    modelPresets: document.modelPresets!.map((preset) => preset.id === id
      ? { ...preset, parameters: { ...preset.parameters, ...parameters } } : preset),
  }, 'presets.json')];
}
function evaluate(definition: MechanismLabDefinition, adapterId: string, input = 361) {
  const resolved = resolveMechanismLabFromFamily({ ...beltLabFamily, definitions: [definition] }, definition.modelId, adapterId, definition.id);
  const request = buildLabEvaluationRequest(definition, { ...defaultLabValues(definition), 'driver-angle': input });
  const session = resolved.adapter.compile(resolved.model).createSession({ configuration: definition.sessionConfiguration! });
  const state = session.evaluate(request);
  return { resolved, request, session, state };
}

describe('discovered JSON lab presentations', () => {
  it.each(['0.1', '0.2', '0.3'])('keeps %s from silently accepting new lab fields', (schemaVersion) => {
    expect(errorFrom(() => parseCatalogDocument(source({ schemaVersion, labPresentations: [baseline] }))).pointer)
      .toBe('/labPresentations');
  });
  it('round-trips the new file while retaining legacy catalog/preset semantics', () => {
    const parsed = parseCatalogDocument(labSources[0]!);
    expect(parseCatalogDocument(source({ ...parsed }))).toEqual(parsed);
    const compiled = compileCatalogDocuments([...baseSources, ...labSources], options);
    expect(compiled.manifests).toEqual(compileCatalogDocuments(catalogSources).manifests);
    expect(compiled.catalog.occurrences.get('brown:003')?.status).toBe('mapped');
    expect(compiled.catalog.subjects.get('quarter-turn-belt-drive')?.simulation?.status).toBe('planned');
    expect(compileCatalogDocuments(catalogSources).labPresentations).toEqual([]);
    expect(compiled.labPresentations).toHaveLength(3);
  });
  it('accepts source/content records in the new envelope and preserves all mixed-version data', async () => {
    const editorialSources = (await readCatalogDocuments(new URL('../../catalog/fixtures/editorial/', import.meta.url)))
      .map((item) => ({ path: `editorial/${item.path}`, text: item.text.replace('"schemaVersion": "0.3"', '"schemaVersion": "0.4"') }));
    const compiled = compileCatalogDocuments([...baseSources, ...editorialSources, ...labSources], options);
    expect(compiled.subjectContent).toHaveLength(3);
    expect(compiled.labPresentations).toHaveLength(3);
  });
  it('normalizes deterministically without mutating/freeze-leaking into supplied definitions', () => {
    const before = JSON.stringify(options);
    const frozen = Object.isFrozen(openBeltDriveLab.controls);
    const sources = [...baseSources, ...labSources];
    const result = compileCatalogDocuments(sources, options);
    const reversed = compileCatalogDocuments([...sources].reverse(), { models: [...options.models].reverse(), labTemplates: [...templates].reverse() });
    expect(reversed.labPresentations).toEqual(result.labPresentations);
    expect(JSON.parse(JSON.stringify(result.labPresentations))).toEqual(result.labPresentations);
    expect(Object.isFrozen(result.labPresentations[0]!.definition.controls[0])).toBe(true);
    expect(JSON.stringify(options)).toBe(before);
    expect(Object.isFrozen(openBeltDriveLab.controls)).toBe(frozen);
  });
  it.each([
    ['example:open-lab', 'atlas.analytic-belt.v0', 'angular-ratio', 0.75],
    ['example:crossed-lab', 'atlas.analytic-belt.v0', 'angular-ratio', -0.375],
    ['example:guided-lab', 'atlas.spatial-belt.v0', 'output-angular-ratio', 45 / 55],
  ] as const)('builds real state and scene for %s without a new lab registration', (id, adapterId, signal, ratio) => {
    const compiled = compileCatalogDocuments([...baseSources, ...labSources], options);
    const definition = compiled.labPresentations.find((item) => item.id === id)!.definition;
    const { resolved, request, session, state } = evaluate(definition, adapterId);
    assertValidInitialLabState(definition, state);
    expect(scalar(state, signal)).toBeCloseTo(ratio, 12);
    expect(state.coordinates['driven-angle']!.position.value).toBeCloseTo(ratio * 361 * Math.PI / 180, 12);
    const scene = resolved.sceneCompiler.build({ model: resolved.model, state, parameters: request.parameters });
    expect(scene.primitives.length).toBeGreaterThan(0);
    const earlier = session.evaluate(buildLabEvaluationRequest(definition, { ...defaultLabValues(definition), 'driver-angle': 359 }));
    const radius = definition.parameterOverrides!['driver-radius']!.value;
    expect(scalar(state, 'belt-travel') - scalar(earlier, 'belt-travel')).toBeCloseTo(radius * 2 * Math.PI / 180, 12);
    session.reset(definition.sessionConfiguration);
    const reset = session.evaluate(buildLabEvaluationRequest(definition, defaultLabValues(definition)));
    expect(scalar(reset, 'belt-travel')).toBeCloseTo(0, 12);
    const speedRatio = definition.readouts.find((readout) => readout.id === 'speed-ratio')!;
    expect(formatLabReadout(speedRatio, state)).toBe(Math.abs(ratio).toFixed(speedRatio.digits));
  });
  it('takes physical parameters from the preset, not legacy template display overrides', () => {
    const definition = compile().labPresentations[0]!.definition;
    expect(openBeltDriveLab.parameterOverrides['driven-radius']).toEqual(quantity(45, 'mm'));
    expect(definition.parameterOverrides!['driven-radius']).toEqual(quantity(0.06, 'm'));
    expect(definition.defaultForModel).toBe(false);
    expect(definition.sceneCompilerId).toBe(openBeltDriveLab.sceneCompilerId);
    expect(definition.threeRendererId).toBe(openBeltDriveLab.threeRendererId);
    expect(definition.animation).toEqual(openBeltDriveLab.animation);
  });
  it('derives parameter-slider initial values from canonical preset quantities', () => {
    const compiled = compileCatalogDocuments([...withPreset('example:open-ratio', { 'center-distance': quantity(0.2, 'm') }), source({ labPresentations: [baseline] })], options);
    const definition = compiled.labPresentations[0]!.definition;
    expect(definition.controls.find((control) => control.id === 'center-distance')!.initial).toBe(200);
    expect(evaluate(definition, 'atlas.analytic-belt.v0').state.diagnostics).toEqual([]);
  });
  it('applies sparse overrides by id without changing template ordering or bindings', () => {
    const definition = compile({ settings: {
      views: ['2d'], controls: [{ id: 'driver-speed', initial: 45 }, { id: 'driver-angle', label: 'Angle' }],
      readouts: [{ id: 'belt-speed', digits: 4 }, { id: 'speed-ratio', label: 'Ratio' }],
    } }).labPresentations[0]!.definition;
    expect(definition.controls.map((control) => control.id)).toEqual(openBeltDriveLab.controls.map((control) => control.id));
    expect(definition.readouts.map((readout) => readout.id)).toEqual(openBeltDriveLab.readouts.map((readout) => readout.id));
    expect(definition.controls[0]!.interaction).toEqual(openBeltDriveLab.controls[0]!.interaction);
    expect(definition.controls[0]!.unit).toBe('deg');
    expect(definition.controls[0]!.queryKey).toBe('angle');
    expect(definition.views).toEqual(['2d']);
  });
  it.each([
    [{ subject: 'unknown' }, '/subject'],
    [{ template: 'missing' }, '/template'],
    [{ template: 'constructor' }, '/template'],
    [{ template: 'belt:crossed-classic' }, '/template'],
    [{ template: 'belt:guided-classic' }, '/template'],
  ] as const)('rejects incompatible selector %j', (presentation, pointer) => {
    expect(errorFrom(() => compile(presentation)).pointer).toBe(`/labPresentations/0${pointer}`);
  });
  it('requires an explicit subject simulation binding', () => {
    const error = errorFrom(() => compileCatalogDocuments([...catalogSources, source({ labPresentations: [baseline] })], options));
    expect(error.pointer).toBe('/labPresentations/0/subject');
  });
  it('rejects missing/duplicate supplied templates and adapter mismatches', () => {
    expect(() => compile({}, { models: options.models })).toThrow('Unknown supplied lab template');
    expect(() => compile({}, { ...options, labTemplates: [templates[0]!, templates[0]!] })).toThrow('Duplicate supplied lab template');
    expect(() => compile({}, { ...options, labTemplates: [{ ...templates[0]!, adapterId: 'wrong' }] })).toThrow('Template adapter must match');
  });
  it.each([
    [{ ...baseline }, '/id'],
    [{ ...baseline, id: 'example:other' }, '/subject'],
  ])('rejects conflicting presentation declarations', (other, pointer) => {
    expect(errorFrom(() => compileCatalogDocuments([...baseSources, source({ labPresentations: [baseline, other] })], options)).pointer)
      .toBe(`/labPresentations/1${pointer}`);
  });
  it.each([
    [{ controls: [{ id: 'unknown' }] }, '/controls/0/id'],
    [{ readouts: [{ id: 'unknown' }] }, '/readouts/0/id'],
    [{ controls: [{ id: 'driver-speed' }, { id: 'driver-speed' }] }, '/controls/1/id'],
    [{ readouts: [{ id: 'speed-ratio' }, { id: 'speed-ratio' }] }, '/readouts/1/id'],
    [{ controls: [{ id: 'driver-angle', coordinate: 'driven-angle' }] }, '/controls/0/coordinate'],
    [{ controls: [{ id: 'driver-angle', kind: 'rate' }] }, '/controls/0/kind'],
    [{ controls: [{ id: 'driver-angle', unit: 'rad' }] }, '/controls/0/unit'],
    [{ controls: [{ id: 'driver-angle', queryKey: 'view' }] }, '/controls/0/queryKey'],
    [{ controls: [{ id: 'driver-angle', interaction: {} }] }, '/controls/0/interaction'],
    [{ controls: [{ id: 'center-distance', initial: 180 }] }, '/controls/0/initial'],
    [{ controls: [{ id: 'center-distance', min: 90 }] }, '/controls/0/min'],
    [{ controls: [{ id: 'center-distance', max: 300 }] }, '/controls/0/max'],
    [{ controls: [{ id: 'driver-angle', step: 0 }] }, '/controls/0/step'],
    [{ controls: [{ id: 'driver-speed', initial: 200 }] }, '/controls/0'],
    [{ controls: [{ id: 'driver-angle', step: 2, initial: 1 }] }, '/controls/0'],
    [{ controls: [{ id: 'driver-angle', min: 360, max: 360 }] }, '/controls/0'],
    [{ readouts: [{ id: 'speed-ratio', scale: 0 }] }, '/readouts/0/scale'],
    [{ readouts: [{ id: 'speed-ratio', source: { kind: 'signal', signal: 'fake' } }] }, '/readouts/0/source'],
    [{ readouts: [{ id: 'speed-ratio', digits: 1.5 }] }, '/readouts/0/digits'],
    [{ readouts: [{ id: 'speed-ratio', digits: 13 }] }, '/readouts/0/digits'],
    [{ readouts: [{ id: 'output-direction', digits: 3 }] }, '/readouts/0/digits'],
    [{ views: ['3d'] }, '/views'],
    [{ views: ['2d', '2d'] }, '/views/1'],
    [{ views: ['2d', '4d'] }, '/views/1'],
    [{ threeRendererId: 'custom' }, '/threeRendererId'],
    [{ sceneCompilerId: 'custom' }, '/sceneCompilerId'],
    [{ module: './arbitrary.js' }, '/module'],
    [{ animation: false }, '/animation'],
    [{ subtitle: null }, '/subtitle'],
  ] as const)('fails invalid settings at %s', (settings, pointer) => {
    const error = errorFrom(() => compile({ settings }));
    expect(error.source).toBe('lab.json');
    expect(error.pointer).toBe(`/labPresentations/0/settings${pointer}`);
  });
  it('rejects non-finite JSON numeric overflow with the field location', () => {
    const input = source({ labPresentations: [{ ...baseline, settings: { controls: [{ id: 'driver-speed', initial: 42 }] } }] });
    input.text = input.text.replace('"initial":42', '"initial":1e999');
    expect(errorFrom(() => parseCatalogDocument(input)).pointer).toBe('/labPresentations/0/settings/controls/0/initial');
  });
  it('rejects presets that would be clamped or snapped by the inherited parameter slider', () => {
    for (const value of [90, 180.5, 300]) {
      expect(() => compileCatalogDocuments([...withPreset('example:open-ratio', { 'center-distance': quantity(value, 'mm') }), source({ labPresentations: [baseline] })], options)).toThrow(/outside|align/);
    }
  });
  it('does not enable an absent 3D template capability', () => {
    const template = { ...openBeltDriveLab, views: ['2d'] as const };
    expect(() => compile({ settings: { views: ['2d', '3d'] } }, suppliedTemplate(template))).toThrow('unsupported template view');
  });
  it.each(['coordinate', 'rate'] as const)('rejects a template %s control on a dependent coordinate', (kind) => {
    const controls = openBeltDriveLab.controls.map((control) => control.kind === kind ? { ...control, coordinate: 'driven-angle' } : control);
    const template = { ...openBeltDriveLab, controls, animation: undefined } as unknown as MechanismLabDefinition;
    expect(() => compile({}, suppliedTemplate(template))).toThrow('independent input coordinate');
  });
  it('validates template physical defaults before a preset could mask them', () => {
    const template = { ...openBeltDriveLab, parameterOverrides: { 'driver-radius': quantity(0, 'mm') } };
    expect(() => compile({}, suppliedTemplate(template))).toThrow('Invalid lab template');
  });
  it('leaves coupled geometry rejection to the existing spatial solver', () => {
    const compiled = compileCatalogDocuments([...withPreset('example:guided-ratio', { 'driver-radius': quantity(30, 'mm') }), ...labSources], options);
    const definition = compiled.labPresentations.find((item) => item.subject === 'quarter-turn-belt-drive')!.definition;
    const { state } = evaluate(definition, 'atlas.spatial-belt.v0', 0);
    expect(state.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(() => assertValidInitialLabState(definition, state)).toThrow('invalid initial state');
  });
  it('discovers and removes a single synthetic subject/preset/lab file without registering a lab or model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-lab-presentation-'));
    try {
      for (const item of baseSources) {
        await mkdir(dirname(join(root, item.path)), { recursive: true });
        await writeFile(join(root, item.path), item.text);
      }
      const before = await discoverCatalogDocuments(root, options);
      const canonical = before.catalog.subjects.get('open-belt-drive')!;
      const added = source({
        subjects: [{ ...canonical, id: 'synthetic-open', slug: 'synthetic-open', title: 'Synthetic shared-lab test' }],
        modelPresets: [{ id: 'synthetic:preset', modelId: openBeltDriveLab.modelId, parameters: { 'driver-radius': quantity(40, 'mm'), 'center-distance': quantity(200, 'mm') } }],
        simulationBindings: [{ subject: 'synthetic-open', preset: 'synthetic:preset' }],
        labPresentations: [{ id: 'synthetic:lab', subject: 'synthetic-open', template: 'belt:open-classic' }],
      });
      const filename = join(root, 'new-entry.json');
      await writeFile(filename, added.text);
      const after = await discoverCatalogDocuments(root, options);
      expect(after.catalog.subjects.size).toBe(before.catalog.subjects.size + 1);
      const definition = after.labPresentations[0]!.definition;
      expect(definition.id).toBe('synthetic:lab');
      expect(definition.modelId).toBe(openBeltDriveLab.modelId);
      const { resolved, request, state } = evaluate(definition, 'atlas.analytic-belt.v0');
      expect(state.diagnostics).toEqual([]);
      expect(scalar(state, 'angular-ratio')).toBeCloseTo(2 / 3, 12);
      expect(resolved.sceneCompiler.build({ model: resolved.model, state, parameters: request.parameters }).primitives.length).toBeGreaterThan(0);
      await rm(filename);
      const removed = await discoverCatalogDocuments(root, options);
      expect(removed.labPresentations).toEqual(before.labPresentations);
      expect(removed.manifests).toEqual(before.manifests);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('pure presentation decoder boundary', () => {
  it('does not invoke accessor fields', () => {
    let calls = 0;
    const settings = Object.defineProperty({}, 'controls', { get() { calls += 1; return []; } });
    expect(() => validateLabPresentationSettings(settings)).toThrow(LabPresentationError);
    expect(calls).toBe(0);
  });
  it.each([null, [], { controls: null }, { controls: [null] }, { controls: [{}] }, { controls: [{ id: 'x', initial: undefined }] }, { views: [] }])('rejects malformed non-JSON API input %j', (value) => {
    expect(() => validateLabPresentationSettings(value)).toThrow(LabPresentationError);
  });
  it('rejects inherited settings and checks non-enumerable own fields and symbols', () => {
    expect(() => validateLabPresentationSettings(Object.create({ controls: [] }))).toThrow('plain data');
    expect(() => validateLabPresentationSettings(Object.defineProperty({}, 'module', { value: 'x' }))).toThrow('Unknown presentation field');
    expect(() => validateLabPresentationSettings({ [Symbol('x')]: 'x' })).toThrow('Symbol keys');
  });
});
