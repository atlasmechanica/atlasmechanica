import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quantity, type ModelState } from '@atlasmechanica/model';
import { compileCatalogDocuments, type CatalogDocument, type ResolvedCatalogLabPresentation } from '../../catalog/src/authoring.js';
import { discoverCatalogDocuments } from '../../catalog/src/discoverDocuments.js';
import { beltLabFamily, brown003QuarterTurnLab, crossedBeltDriveLab, openBeltDriveLab } from './families/belt.js';
import { resolveMechanismLab } from './runtime.js';
import { loadMechanismLab } from './lazyRuntime.js';
import { assertValidInitialLabState, buildLabEvaluationRequest, defaultLabValues } from './core.js';
import type { ResolvedMechanismLab } from './family.js';

const text = await readFile(new URL('../../../apps/web/tests/fixtures/planar-belt-instances.atlas.json', import.meta.url), 'utf8');
const options = { models: beltLabFamily.models, labTemplates: [
  { id: 'belt:open-classic', adapterId: 'atlas.analytic-belt.v0', definition: openBeltDriveLab },
  { id: 'belt:crossed-classic', adapterId: 'atlas.analytic-belt.v0', definition: crossedBeltDriveLab },
  { id: 'belt:guided-classic', adapterId: 'atlas.spatial-belt.v0', definition: brown003QuarterTurnLab },
] };
function compile(value = text) { return compileCatalogDocuments([{ path: 'planar.atlas.json', text: value }], options); }
function run(lab: ResolvedMechanismLab, angle = 25, center?: number) {
  const values = { ...defaultLabValues(lab.definition), 'driver-angle': angle, ...(center === undefined ? {} : { 'center-distance': center }) };
  const request = buildLabEvaluationRequest(lab.definition, values);
  const session = lab.adapter.compile(lab.model).createSession({ configuration: lab.definition.sessionConfiguration! });
  const state = session.evaluate(request);
  assertValidInitialLabState(lab.definition, state);
  const scene = lab.sceneCompiler.build({ model: lab.model, state, parameters: request.parameters });
  return { state, scene, request, session };
}
function scalar(state: ModelState, id: string): number {
  const signal = state.signals[id]; if (signal?.type !== 'scalar') throw new Error(`Missing ${id}`);
  return signal.value.value;
}

describe('JSON-defined planar belt instances on the shared runtime', () => {
  it.each(compile().labPresentations)('resolves $id without registrations and preserves exact solved geometry', async (selection) => {
    const id = selection.definition.modelId;
    expect(beltLabFamily.models.some((model) => model.id === id)).toBe(false);
    expect(beltLabFamily.definitions.some((definition) => definition.id === selection.id)).toBe(false);
    const eager = resolveMechanismLab(id, 'atlas.analytic-belt.v0', selection);
    const lazy = await loadMechanismLab(id, 'atlas.analytic-belt.v0', JSON.parse(JSON.stringify(selection)));
    const template = resolveMechanismLab(selection.modelInstance!.templateModelId, 'atlas.analytic-belt.v0');
    const radius = eager.definition.parameterOverrides!['driver-radius']!;
    for (const angle of [-361, 0, 25, 179, 359, 361, 721]) {
      const a = run(eager, angle), b = run(lazy, angle);
      expect(b.scene).toEqual(a.scene);
      const baseline = template.adapter.compile(template.model).createSession().evaluate(a.request);
      expect(a.state.signals).toEqual(baseline.signals);
      expect(a.scene).toEqual(template.sceneCompiler.build({ model: template.model, state: baseline, parameters: a.request.parameters }));
      expect(scalar(a.state, 'belt-travel')).toBeCloseTo(radius.value * angle * Math.PI / 180, 12);
    }
    expect(scalar(run(eager).state, 'angular-ratio')).toBeCloseTo(selection.id.includes('crossed') ? -35 / 55 : 40 / 60, 12);
    expect(run(eager, 25, 220).scene).not.toEqual(run(eager).scene);
    const { session, request, state } = run(eager);
    session.evaluate({ ...request, coordinates: { 'driver-angle': quantity(721, 'deg') } });
    session.reset(); expect(session.evaluate(request)).toEqual(state);
  });
  it('discovers and removes both complete configurations by adding/removing one JSON file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-planar-instances-'));
    try {
      await writeFile(join(root, 'new.atlas.json'), text);
      const compiled = await discoverCatalogDocuments(root, options);
      expect(compiled.labPresentations).toHaveLength(2);
      await Promise.all(compiled.labPresentations.map(async (selection) => {
        const lab = await loadMechanismLab(selection.definition.modelId, 'atlas.analytic-belt.v0', selection);
        expect(run(lab).scene.primitives.length).toBeGreaterThan(0);
      }));
      await rm(join(root, 'new.atlas.json'));
      const removed = await discoverCatalogDocuments(root, options);
      expect(removed.labPresentations).toEqual([]); expect(removed.modelInstances).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('keeps different configurations independent within the same loaded family', async () => {
    const items = compile().labPresentations;
    const labs = await Promise.all(items.map((item) => loadMechanismLab(item.definition.modelId, 'atlas.analytic-belt.v0', item)));
    const before = run(labs[1]!).state;
    run(labs[0]!, 721, 250);
    expect(run(labs[1]!).state).toEqual(before);
    expect(labs[0]!.model).not.toBe(labs[1]!.model);
  });
  it('rejects same-ID serialized topology edits before rendering', async () => {
    const original = compile().labPresentations[0]!;
    const changed = JSON.parse(JSON.stringify(original)) as ResolvedCatalogLabPresentation;
    changed.modelInstance!.model.systems.mechanical!.joints['driver-bearing']!.parent.body = 'driven';
    expect(() => resolveMechanismLab(changed.definition.modelId, 'atlas.analytic-belt.v0', changed)).toThrow('incompatible with loaded template');
    await expect(loadMechanismLab(changed.definition.modelId, 'atlas.analytic-belt.v0', changed)).rejects.toThrow('incompatible with loaded template');
  });
  it('retains spatial identity guards until the guided structural contract is implemented', async () => {
    type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
    const doc = JSON.parse(text) as Mutable<CatalogDocument>;
    const instance = doc.modelInstances![0]!;
    instance.templateModelId = brown003QuarterTurnLab.modelId;
    doc.subjects![0]!.simulation!.adapter = 'atlas.spatial-belt.v0';
    doc.modelPresets![0]!.parameters = {};
    doc.labPresentations![0]!.template = 'belt:guided-classic';
    const selected = compile(JSON.stringify(doc)).labPresentations.find((item) => item.definition.modelId === instance.id)!;
    expect(() => resolveMechanismLab(instance.id, 'atlas.spatial-belt.v0', selected)).toThrow('does not support');
    await expect(loadMechanismLab(instance.id, 'atlas.spatial-belt.v0', selected)).rejects.toThrow('does not support');
  });
});
