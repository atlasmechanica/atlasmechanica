import { describe, expect, it } from 'vitest';
import { resolveParameterValues, type SimulationModel } from '@atlasmechanica/model';
import {
  CatalogAuthoringError, compileCatalogDocuments,
} from '../../catalog/src/authoring.js';
import { readCatalogDocuments } from '../../catalog/src/discoverDocuments.js';
import { advancePeriodicAnimation } from '../../../apps/web/src/scripts/animationPhase.js';
import { buildLabEvaluationRequest, defaultLabValues } from './core.js';
import { resolveMechanismLabFromFamily } from './family.js';
import { beltLabFamily, openBeltDriveLab, crossedBeltDriveLab, brown003QuarterTurnLab } from './families/belt.js';
import {
  LabPresentationError, resolveLabPresentation, validateLabPresentationSettings,
  type LabPresentationSettings,
} from './presentation.js';
import type { MechanismLabDefinition } from './schema.js';

const model = beltLabFamily.models.find((item) => item.id === openBeltDriveLab.modelId)!;
const preset = {
  modelId: model.id, configuration: 'reference',
  parameters: resolveParameterValues(model.parameters, openBeltDriveLab.parameterOverrides),
};
const catalogSources = await readCatalogDocuments(new URL('../../catalog/fixtures/authoring/', import.meta.url));
const presetSources = await readCatalogDocuments(new URL('../../catalog/fixtures/presets/', import.meta.url));

function resolve(settings: unknown, template: MechanismLabDefinition = openBeltDriveLab, suppliedModel: SimulationModel = model) {
  return resolveLabPresentation('review:lab', settings as LabPresentationSettings, template, suppliedModel, preset);
}
function rejectSettings(settings: unknown, pointer: string): void {
  for (const run of [() => validateLabPresentationSettings(settings), () => resolve(settings)]) {
    let caught: unknown;
    try { run(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(LabPresentationError);
    expect((caught as LabPresentationError).pointer).toBe(pointer);
  }
}
const arrayFields = ['views', 'controls', 'readouts'] as const;
type ArrayField = typeof arrayFields[number];
function validArray(field: ArrayField): unknown[] {
  return field === 'views' ? ['2d'] : field === 'controls'
    ? [{ id: 'driver-speed', initial: 45 }] : [{ id: 'speed-ratio', digits: 4 }];
}
function compileSettings(settings: unknown, template: MechanismLabDefinition = openBeltDriveLab, subject = 'open-belt-drive') {
  const adapterId = template.modelId === brown003QuarterTurnLab.modelId ? 'atlas.spatial-belt.v0' : 'atlas.analytic-belt.v0';
  return compileCatalogDocuments([...catalogSources, ...presetSources, {
    path: 'review-presentation.json',
    text: JSON.stringify({
      format: 'atlas.catalog-document', schemaVersion: '0.4',
      labPresentations: [{ id: 'review:lab', subject, template: 'review:template', settings }],
    }),
  }], {
    models: beltLabFamily.models,
    labTemplates: [{ id: 'review:template', adapterId, definition: template }],
  }).labPresentations[0]!.definition;
}
function authoringError(run: () => unknown): CatalogAuthoringError {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(CatalogAuthoringError);
  return caught as CatalogAuthoringError;
}
function withoutAnimation(): MechanismLabDefinition {
  const { animation: _animation, ...definition } = openBeltDriveLab;
  return definition;
}

describe('presentation arrays are data, not method containers', () => {
  it.each(arrayFields)('rejects custom methods/getters on %s before invoking or cloning them', (field) => {
    for (const key of ['map', 'some', 'constructor', 'extra']) {
      for (const enumerable of [false, true]) {
        for (const accessor of [false, true]) {
          let calls = 0;
          const callback = () => { calls += 1; return []; };
          const array = validArray(field);
          Object.defineProperty(array, key, accessor ? { enumerable, get: callback } : { enumerable, value: callback });
          rejectSettings({ [field]: array }, `/${field}/${key}`);
          expect(calls).toBe(0);
        }
      }
    }
  });
  it.each(arrayFields)('rejects symbol properties on %s without evaluating them', (field) => {
    for (const key of [Symbol('extra'), Symbol.iterator]) {
      let calls = 0;
      const array = validArray(field);
      Object.defineProperty(array, key, { get() { calls += 1; return undefined; } });
      rejectSettings({ [field]: array }, `/${field}`);
      expect(calls).toBe(0);
    }
  });
  it.each(arrayFields)('rejects non-index numeric-looking keys on %s', (field) => {
    for (const key of ['01', '-1', '1.0', '4294967295']) {
      const array = validArray(field);
      Object.defineProperty(array, key, { value: 'not an array index' });
      rejectSettings({ [field]: array }, `/${field}/${key}`);
    }
  });
  it.each(arrayFields)('rejects sparse, accessor and non-enumerable %s items', (field) => {
    rejectSettings({ [field]: new Array(1) }, `/${field}/0`);
    let calls = 0;
    const accessor = validArray(field);
    Object.defineProperty(accessor, '0', { get() { calls += 1; return undefined; } });
    rejectSettings({ [field]: accessor }, `/${field}/0`);
    expect(calls).toBe(0);
    const hidden = validArray(field);
    Object.defineProperty(hidden, '0', { enumerable: false });
    rejectSettings({ [field]: hidden }, `/${field}/0`);
  });
  it.each(arrayFields)('rejects inherited executable behavior and nonstandard %s prototypes', (field) => {
    let calls = 0;
    const inherited = validArray(field);
    Object.setPrototypeOf(inherited, Object.create(Array.prototype, {
      some: { get() { calls += 1; return Array.prototype.some; } },
      map: { get() { calls += 1; return Array.prototype.map; } },
    }));
    rejectSettings({ [field]: inherited }, `/${field}`);
    expect(calls).toBe(0);
    class CustomArray extends Array<unknown> {}
    rejectSettings({ [field]: new CustomArray(...validArray(field)) }, `/${field}`);
    rejectSettings({ [field]: Object.setPrototypeOf(validArray(field), null) }, `/${field}`);
  });
  it('accepts plain frozen arrays and owns a complete JSON-round-trippable result', () => {
    const settings = {
      views: Object.freeze(['2d']),
      controls: Object.freeze([{ id: 'driver-speed', initial: 45 }]),
      readouts: Object.freeze([{ id: 'speed-ratio', digits: 4 }]),
    };
    expect(() => validateLabPresentationSettings(settings)).not.toThrow();
    const definition = resolve(settings);
    expect(definition.views).toEqual(['2d']);
    expect(definition.views).not.toBe(settings.views);
    expect(definition.controls.find((control) => control.id === 'driver-speed')!.initial).toBe(45);
    expect(definition.readouts.find((readout) => readout.id === 'speed-ratio')!.digits).toBe(4);
    expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
  });
});

describe('presentation slider endpoint alignment', () => {
  it('rejects an unreachable JSON-authored maximum even when the initial slot is aligned', () => {
    const error = authoringError(() => compileSettings({ controls: [{ id: 'driver-speed', min: 10, max: 20, step: 3, initial: 13 }] }));
    expect(error.source).toBe('review-presentation.json');
    expect(error.pointer).toBe('/labPresentations/0/settings/controls/0/max');
    expect(error.message).toContain('align');
  });
  it('rejects the exact 0..10 / step 3 / initial 3 review example independently of animation', () => {
    const error = authoringError(() => compileSettings({ controls: [{ id: 'driver-angle', min: 0, max: 10, step: 3, initial: 3 }] }, withoutAnimation()));
    expect(error.pointer).toBe('/labPresentations/0/settings/controls/0/max');
  });
  it.each([
    { min: 10, max: 19, step: 3, initial: 13 },
    { min: 10, max: 10.3, step: 0.1, initial: 10.1 },
  ])('accepts reachable offset and fractional endpoints: %j', (range) => {
    const definition = compileSettings({ controls: [{ id: 'driver-speed', ...range }] });
    expect(definition.controls.find((control) => control.id === 'driver-speed')).toMatchObject(range);
  });
  it('checks inherited template maxima before a presentation could mask them', () => {
    const template = { ...openBeltDriveLab, controls: openBeltDriveLab.controls.map((control) => control.id === 'driver-speed'
      ? { ...control, min: 10, max: 20, step: 3, initial: 13 } : control) };
    expect(() => resolve({ controls: [{ id: 'driver-speed', max: 19 }] }, template)).toThrow('Maximum value');
  });
});

describe('animated periodic coordinate ranges retain their wrapping span', () => {
  it.each([
    ['open-belt-drive', openBeltDriveLab],
    ['crossed-belt-drive', crossedBeltDriveLab],
    ['quarter-turn-belt-drive', brown003QuarterTurnLab],
  ] as const)('rejects either endpoint narrowing for %s with the JSON field location', (subject, template) => {
    for (const range of [{ max: 180, initial: 0 }, { min: 180, initial: 180 }]) {
      const error = authoringError(() => compileSettings({ controls: [{ id: 'driver-angle', ...range }] }, template, subject));
      expect(error.pointer).toBe(`/labPresentations/0/settings/controls/0/${'min' in range ? 'min' : 'max'}`);
      expect(error.message).toContain('periodic');
    }
  });
  it('preserves periodic ranges in radians as well as degrees', () => {
    const template: MechanismLabDefinition = { ...openBeltDriveLab, controls: openBeltDriveLab.controls.map((control) => control.id === 'driver-angle'
      ? { ...control, unit: 'rad', min: 0, max: 2 * Math.PI, step: Math.PI / 180, initial: 0 } : control) };
    expect(() => resolve({}, template)).not.toThrow();
    expect(() => resolve({ controls: [{ id: 'driver-angle', max: Math.PI }] }, template)).toThrow('periodic');
  });
  it('still allows narrowing nonanimated periodic or animated nonperiodic controls', () => {
    const settings = { controls: [{ id: 'driver-angle', max: 180 }] };
    expect(resolve(settings, withoutAnimation()).controls[0]!.max).toBe(180);
    const nonperiodic: SimulationModel = { ...model, coordinates: { ...model.coordinates,
      'driver-angle': { ...model.coordinates['driver-angle']!, periodic: false },
    } };
    expect(resolve(settings, openBeltDriveLab, nonperiodic).controls[0]!.max).toBe(180);
  });
  it('keeps displayed angles consistent with unwrapped simulation across 180 and 360 degrees', () => {
    const definition = compileSettings({ controls: [
      { id: 'driver-angle', min: 0, max: 360, label: 'Angle' },
      { id: 'driver-speed', min: 10, max: 100, step: 5, initial: 30 },
    ] });
    const control = definition.controls.find((item) => item.id === 'driver-angle')!;
    const resolved = resolveMechanismLabFromFamily({ ...beltLabFamily, definitions: [definition] }, definition.modelId, 'atlas.analytic-belt.v0', definition.id);
    const session = resolved.adapter.compile(resolved.model).createSession({ configuration: definition.sessionConfiguration! });
    for (const start of [179, 359]) {
      const step = advancePeriodicAnimation(start, 2, control.min, control.max);
      expect(step.evaluationValue).toBe(start + 2);
      expect(step.presentationValue).toBe(start === 179 ? 181 : 1);
      const evaluate = (angle: number) => session.evaluate(buildLabEvaluationRequest(definition, { ...defaultLabValues(definition), 'driver-angle': angle }));
      const before = evaluate(start);
      const after = evaluate(step.evaluationValue);
      expect(after.diagnostics).toEqual([]);
      expect(after.coordinates['driver-angle']!.position.value).toBeCloseTo((start + 2) * Math.PI / 180, 12);
      const previousTravel = before.signals['belt-travel'];
      const travel = after.signals['belt-travel'];
      if (previousTravel?.type !== 'scalar' || travel?.type !== 'scalar') throw new Error('Missing belt travel');
      const radius = definition.parameterOverrides!['driver-radius']!.value;
      expect(travel.value.value - previousTravel.value.value).toBeCloseTo(radius * 2 * Math.PI / 180, 12);
    }
  });
});
