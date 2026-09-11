import { describe, expect, it } from 'vitest';
import { openBeltDriveLab, beltLabFamily } from '../../../../packages/lab/src/families/belt.js';
import { resolveLabPresentation } from '@atlasmechanica/lab/presentation';
import { loadElementMechanismLab } from './labHydration.js';
import { displayControlValue } from './labControlDisplay.js';

const model = beltLabFamily.models.find((item) => item.id === openBeltDriveLab.modelId)!;
const definition = resolveLabPresentation('test:web-hydration', {}, openBeltDriveLab, model, {
  modelId: model.id, configuration: 'reference',
  parameters: { 'driver-radius': { value: 40, unit: 'mm' }, 'driven-radius': { value: 60, unit: 'mm' }, 'center-distance': { value: 200, unit: 'mm' } },
});
const selection = { templateLabId: openBeltDriveLab.id, definition };
const attributes: Record<string, string> = {
  'data-model-id': model.id,
  'data-adapter-id': 'atlas.analytic-belt.v0',
  'data-lab-id': definition.id,
  'data-lab-presentation': JSON.stringify(selection),
};
function element(values: Record<string, string>) {
  return { getAttribute: (name: string) => Object.hasOwn(values, name) ? values[name]! : null };
}

describe('component-scoped lab hydration', () => {
  it('restores the physical preset and never registers its presentation id as a default', async () => {
    const configured = await loadElementMechanismLab(element(attributes));
    expect(configured.definition).toEqual(definition);
    expect(configured.definition.parameterOverrides!['driver-radius']).toEqual({ value: 0.04, unit: 'm' });
    const legacy = { ...attributes, 'data-lab-id': openBeltDriveLab.id };
    delete legacy['data-lab-presentation'];
    expect((await loadElementMechanismLab(element(legacy))).definition).toEqual(openBeltDriveLab);
  });
  it.each(['', '{', 'null', '[]', '"registered-lab"', '{}'])('rejects present invalid payload %j instead of falling back', async (payload) => {
    await expect(loadElementMechanismLab(element({ ...attributes, 'data-lab-presentation': payload }))).rejects.toThrow();
  });
  it.each(['data-model-id', 'data-adapter-id', 'data-lab-id'])('isolates missing %s as a rejected initialization', async (key) => {
    const missing = { ...attributes };
    delete missing[key];
    await expect(loadElementMechanismLab(element(missing))).rejects.toThrow(`requires ${key}`);
    await expect(loadElementMechanismLab(element({ ...attributes, [key]: ' ' }))).rejects.toThrow(`requires ${key}`);
    expect((await loadElementMechanismLab(element(attributes))).definition.id).toBe(definition.id);
  });
  it('rejects a valid selection whose identity disagrees with its rendered controls', async () => {
    await expect(loadElementMechanismLab(element({ ...attributes, 'data-lab-id': openBeltDriveLab.id })))
      .rejects.toThrow('does not match this component lab id');
  });
  it.each(['sceneCompilerId', 'threeRendererId', 'modelTransformId'])('retains runtime validation of %s', async (key) => {
    const bad = { ...selection, definition: { ...definition, [key]: './untrusted-module.js' } };
    await expect(loadElementMechanismLab(element({ ...attributes, 'data-lab-presentation': JSON.stringify(bad) })))
      .rejects.toThrow();
  });
  it('never falls back to another family for a contradictory capability', async () => {
    await expect(loadElementMechanismLab(element({ ...attributes, 'data-adapter-id': 'atlas.spatial-belt.v0' })))
      .rejects.toThrow('does not support');
  });
});

describe('shared server/browser control display', () => {
  it.each([
    [1, 30, 'rpm', '30 rpm'],
    [0.5, 37.5, 'rpm', '37.5 rpm'],
    [0.5, 12.5, 'deg', '12.5°'],
    [0.25, 12.5, 'mm', '12.50 mm'],
    [1.5, 4.5, 'mm', '4.5 mm'],
    [1e-7, 1e-7, 'm', '0.0000001 m'],
    [1e-150, 1e-150, 'm', '1e-150 m'],
    [1e2, 300, 'mm', '300 mm'],
  ] as const)('formats step %s value %s consistently', (step, value, unit, expected) => {
    expect(displayControlValue({ step, unit }, value)).toBe(expected);
  });
});
