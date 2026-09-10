import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quantity, type ModelState, type SimulationModel } from '@atlasmechanica/model';
import { CatalogAuthoringError, compileCatalogDocuments, parseCatalogDocument, type CatalogDocumentSource } from '../../catalog/src/authoring.js';
import { discoverCatalogDocuments, readCatalogDocuments } from '../../catalog/src/discoverDocuments.js';
import { collections, subjects, occurrences } from '../../catalog/src/catalog.js';
import { openBeltDriveModel, crossedBeltDriveModel } from './fixtures/beltDrive.js';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';
import { analyticBeltAdapter } from './analyticBeltAdapter.js';
import { spatialBeltAdapter } from './spatialBeltAdapter.js';

const models = [openBeltDriveModel, crossedBeltDriveModel, canonicalQuarterTurnBeltModel];
const catalogSources = await readCatalogDocuments(new URL('../../catalog/fixtures/authoring/', import.meta.url));
const presetSources = await readCatalogDocuments(new URL('../../catalog/fixtures/presets/', import.meta.url));
const sources = [...catalogSources, ...presetSources];
const basePreset = { id: 'example:preset', modelId: openBeltDriveModel.id };
function source(body: Record<string, unknown>, path = 'preset.json'): CatalogDocumentSource {
  return { path, text: JSON.stringify({ format: 'atlas.catalog-document', schemaVersion: '0.2', ...body }) };
}
function compile(body: Record<string, unknown>, available: readonly SimulationModel[] = models) {
  return compileCatalogDocuments([...catalogSources, source(body)], { models: available });
}
function errorFrom(run: () => unknown): CatalogAuthoringError {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(CatalogAuthoringError);
    return error as CatalogAuthoringError;
  }
  throw new Error('Expected authoring error');
}
function scalar(state: ModelState, id: string): number {
  const signal = state.signals[id];
  if (signal?.type !== 'scalar') throw new Error(`Missing ${id}`);
  return signal.value.value;
}

describe('JSON model presets composed with existing adapters', () => {
  it('keeps old documents valid and separates envelope version from record versions', () => {
    expect(compileCatalogDocuments(catalogSources).modelPresets).toEqual([]);
    expect(() => parseCatalogDocument(source({ schemaVersion: '0.1', modelPresets: [basePreset] }))).toThrow('requires catalog-document version 0.2');
    const parsed = parseCatalogDocument(presetSources[0]!);
    expect(parseCatalogDocument({ path: 'roundtrip.json', text: JSON.stringify(parsed) })).toEqual(parsed);
    expect(() => parseCatalogDocument(source({ subjects: [{ ...subjects[0], schemaVersion: '0.2' }] }))).toThrow('/subjects/0/schemaVersion');
  });

  it('resolves forward references deterministically without changing catalog statuses', () => {
    const normal = compileCatalogDocuments(sources, { models });
    const reverse = compileCatalogDocuments([...sources].reverse(), { models: [...models].reverse() });
    expect(reverse.modelPresets).toEqual(normal.modelPresets);
    expect(reverse.simulationBindings).toEqual(normal.simulationBindings);
    expect(normal.manifests).toEqual(compileCatalogDocuments(catalogSources).manifests);
    expect(normal.catalog.occurrences.get('brown:003')?.status).toBe('mapped');
    expect(JSON.parse(JSON.stringify(normal.modelPresets))).toEqual(normal.modelPresets);
    expect(Object.isFrozen(normal.modelPresets[0]?.parameters)).toBe(true);
  });

  it.each([
    ['example:open-ratio', openBeltDriveModel, analyticBeltAdapter, 'angular-ratio', 0.75],
    ['example:crossed-ratio', crossedBeltDriveModel, analyticBeltAdapter, 'angular-ratio', -0.375],
    ['example:guided-ratio', canonicalQuarterTurnBeltModel, spatialBeltAdapter, 'output-angular-ratio', 45 / 55],
  ] as const)('evaluates %s from discovered JSON through the real adapter', (id, model, adapter, signal, ratio) => {
    const compiled = compileCatalogDocuments(sources, { models });
    const preset = compiled.modelPresets.find((item) => item.id === id)!;
    const before = JSON.stringify(model);
    const session = adapter.compile(model).createSession({ configuration: preset.configuration, parameters: preset.parameters });
    const state = session.evaluate({ coordinates: { 'driver-angle': quantity(361, 'deg') }, rates: { 'driver-angle': quantity(1, 'rad/s') } });
    expect(state.diagnostics).toEqual([]);
    expect(scalar(state, signal)).toBeCloseTo(ratio, 12);
    expect(state.coordinates['driven-angle']?.position.value).toBeCloseTo(ratio * 361 * Math.PI / 180, 12);
    expect(JSON.stringify(model)).toBe(before);
  });

  it('leaves coupled geometric validity with the adapter rather than certifying it from scalar ranges', () => {
    const result = compile({ modelPresets: [{ ...basePreset, modelId: canonicalQuarterTurnBeltModel.id, parameters: { 'driver-radius': quantity(30, 'mm') } }] });
    const preset = result.modelPresets[0]!;
    const state = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel).createSession({ parameters: preset.parameters }).evaluate({ coordinates: { 'driver-angle': quantity(1, 'rad') } });
    expect(state.diagnostics[0]?.code).toBe('invalid-geometry');
  });

  it('allows normal session/request override precedence on top of an authored preset', () => {
    const preset = compileCatalogDocuments(sources, { models }).modelPresets.find((item) => item.id === 'example:guided-ratio')!;
    const session = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel).createSession({ parameters: preset.parameters });
    expect(scalar(session.evaluate({ coordinates: { 'driver-angle': quantity(1, 'rad') } }), 'output-angular-ratio')).toBeCloseTo(45 / 55, 12);
    expect(scalar(session.evaluate({ parameters: { 'driven-radius': quantity(50, 'mm') }, coordinates: { 'driver-angle': quantity(1, 'rad') } }), 'output-angular-ratio')).toBeCloseTo(0.9, 12);
    expect(preset.parameters['driven-radius']).toEqual(quantity(0.055, 'm'));
  });

  it.each([
    [{ modelPresets: [{ ...basePreset, parameters: { 'driver-radius': quantity(1, 'deg') } }] }, '/modelPresets/0/parameters/driver-radius/unit'],
    [{ modelPresets: [{ ...basePreset, parameters: { 'driver-radius': quantity(0, 'mm') } }] }, '/modelPresets/0/parameters/driver-radius'],
    [{ modelPresets: [{ ...basePreset, parameters: { unknown: quantity(1, 'mm') } }] }, '/modelPresets/0/parameters/unknown'],
    [{ modelPresets: [{ ...basePreset, parameters: { 'driver-radius': { value: 1, unit: 'rpm' } } }] }, '/modelPresets/0/parameters/driver-radius/unit'],
    [{ modelPresets: [{ ...basePreset, parameters: { 'driver-radius': { value: 1, unit: 'mm', script: 'x' } } }] }, '/modelPresets/0/parameters/driver-radius/script'],
    [{ modelPresets: [{ ...basePreset, modelId: 'missing' }] }, '/modelPresets/0/modelId'],
    [{ modelPresets: [{ ...basePreset, configuration: 'missing' }] }, '/modelPresets/0/configuration'],
    [{ modelPresets: [{ ...basePreset, family: 'arbitrary' }] }, '/modelPresets/0/family'],
    [{ modelPresets: [basePreset, basePreset] }, '/modelPresets/1/id'],
    [{ simulationBindings: [{ subject: 'open-belt-drive', preset: 'missing' }] }, '/simulationBindings/0/preset'],
    [{ modelPresets: [basePreset], simulationBindings: [{ subject: 'missing', preset: basePreset.id }] }, '/simulationBindings/0/subject'],
    [{ modelPresets: [basePreset], simulationBindings: [{ subject: 'crossed-belt-drive', preset: basePreset.id }] }, '/simulationBindings/0/preset'],
    [{ simulationBindings: [{ subject: 'open-belt-drive', preset: basePreset.id }, { subject: 'open-belt-drive', preset: basePreset.id }] }, '/simulationBindings/1/subject'],
  ] as const)('rejects malformed preset/binding at %s', (body, pointer) => {
    const error = errorFrom(() => compile(body));
    expect(error.source).toBe('preset.json');
    expect(error.pointer).toBe(pointer);
  });

  it('requires an explicit supplied model set and rejects duplicate model identities', () => {
    expect(() => compileCatalogDocuments(sources)).toThrow('Unknown supplied model');
    expect(() => compile({ modelPresets: [basePreset] }, [...models, openBeltDriveModel])).toThrow('Duplicate supplied model');
  });

  it('requires explicit selection for multi-configuration models', () => {
    const multi = structuredClone(openBeltDriveModel);
    multi.configurations.alternate = { ...multi.configurations.reference!, id: 'alternate' };
    expect(() => compile({ modelPresets: [basePreset] }, [multi])).toThrow('/configuration');
    expect(compile({ modelPresets: [{ ...basePreset, configuration: 'alternate' }] }, [multi]).modelPresets[0]?.configuration).toBe('alternate');
  });

  it('rejects invalid model defaults even if the preset supplies a valid replacement', () => {
    const model = structuredClone(openBeltDriveModel);
    model.parameters['driver-radius']!.default = quantity(0, 'mm');
    const error = errorFrom(() => compile({ modelPresets: [{ ...basePreset, parameters: { 'driver-radius': quantity(40, 'mm') } }] }, [model]));
    expect(error.pointer).toBe('/modelPresets/0/modelId');
  });

  it('discovers added and removed preset files without registration changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-presets-'));
    try {
      await writeFile(join(root, 'catalog.json'), source({ collections, subjects, occurrences }).text);
      expect((await discoverCatalogDocuments(root, { models })).modelPresets).toHaveLength(0);
      await writeFile(join(root, 'new-preset.json'), source({ modelPresets: [{ ...basePreset, parameters: { 'driver-radius': quantity(40, 'mm') } }] }).text);
      const result = await discoverCatalogDocuments(root, { models });
      expect(result.modelPresets[0]?.parameters['driver-radius']).toEqual(quantity(0.04, 'm'));
      await rm(join(root, 'new-preset.json'));
      expect((await discoverCatalogDocuments(root, { models })).modelPresets).toHaveLength(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
