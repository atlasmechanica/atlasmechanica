import { describe, expect, it } from 'vitest';

import {
  canonicalNumber,
  quantity,
  validateSimulationModel,
  type FixedAxisPulleyDefinition,
  type SimulationModel,
} from '@atlasmechanica/model';
import { solveBrown003Route, sampleBrown003PulleyTrack } from './brown003Route.js';
import { evaluateFixedAxisBeltContinuity } from './fixedAxisBeltContinuity.js';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';

function system() {
  const value = canonicalQuarterTurnBeltModel.systems.fixedAxisBelt;
  if (value === undefined) throw new Error('Missing Brown 003 fixed-axis system');
  return value;
}

function pulley(id: 'driver' | 'guide-a' | 'driven' | 'guide-b') {
  const value = system().pulleys[id];
  if (value === undefined) throw new Error(`Missing ${id}`);
  return value;
}

function expectPointClose(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(3);
  expect(expected).toHaveLength(3);
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index] ?? Number.NaN, 10);
  }
}

function dot(a: readonly number[], b: readonly number[]) {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

function subtract(a: readonly number[], b: readonly number[]) {
  return [
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  ] as const;
}

function withPulley(
  id: 'driver' | 'guide-a' | 'driven' | 'guide-b',
  replacement: FixedAxisPulleyDefinition,
): SimulationModel {
  const fixedAxisBelt = system();
  return {
    ...canonicalQuarterTurnBeltModel,
    systems: {
      fixedAxisBelt: {
        ...fixedAxisBelt,
        pulleys: { ...fixedAxisBelt.pulleys, [id]: replacement },
      },
    },
  };
}

describe('Brown 003 routed geometry', () => {
  it('constructs four delivery-plane tangent spans with finite face margins', () => {
    const route = solveBrown003Route(canonicalQuarterTurnBeltModel);
    expect(route.diagnostics).toEqual([]);
    expect(route.spans.map((span) => span.id)).toEqual([
      'driver-guide-a',
      'guide-a-driven',
      'driven-guide-b',
      'guide-b-driver',
    ]);
    expect(route.tracks.map((track) => track.pulley)).toEqual([
      'driver',
      'guide-a',
      'driven',
      'guide-b',
    ]);
    expect(route.beltWidth).toBeCloseTo(0.01, 12);

    const tracks = new Map(route.tracks.map((track) => [track.pulley, track]));
    for (const span of route.spans) {
      const target = tracks.get(span.to);
      if (target === undefined) throw new Error(`Missing target track ${span.to}`);
      expect(dot(subtract(span.start, target.center), target.axis)).toBeCloseTo(0, 10);
      expect(dot(subtract(span.end, target.center), target.axis)).toBeCloseTo(0, 10);
      expect(span.length).toBeGreaterThan(0);
    }

    expect(tracks.get('driver')?.faceMargin).toBeCloseTo(0.005, 10);
    expect(tracks.get('guide-a')?.faceMargin).toBeCloseTo(0.005, 10);
    expect(tracks.get('driven')?.faceMargin).toBeCloseTo(0.005, 10);
    expect(tracks.get('guide-b')?.faceMargin).toBeCloseTo(0.01, 10);
    for (const track of route.tracks) {
      expect(track.signedWrapAngle).toBeGreaterThan(0);
    }
  });

  it('samples a continuous cylindrical face track from arrival to departure', () => {
    const route = solveBrown003Route(canonicalQuarterTurnBeltModel);
    expect(route.diagnostics).toEqual([]);

    for (const track of route.tracks) {
      expectPointClose(sampleBrown003PulleyTrack(track, 0), track.arrival);
      expectPointClose(sampleBrown003PulleyTrack(track, 1), track.departure);

      for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const point = sampleBrown003PulleyTrack(track, t);
        const relative = subtract(point, track.center);
        const axial = dot(relative, track.axis);
        const radial = subtract(relative, track.axis.map((value) => value * axial));
        expect(Math.hypot(...radial)).toBeCloseTo(track.radius, 10);
      }
    }
  });

  it('derives the guide-b travel sense from the realizable tangent branch', () => {
    const route = solveBrown003Route(canonicalQuarterTurnBeltModel);
    expect(route.diagnostics).toEqual([]);

    const continuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
    expect(continuity.diagnostics).toEqual([]);
    expect(continuity.angularRatios['guide-b']).toBeCloseTo(2.25, 12);
  });

  it('rejects the earlier illustrative guide depth because it does not satisfy delivery geometry', () => {
    const fixedAxisBelt = system();
    const guideA = pulley('guide-a');
    const guideB = pulley('guide-b');
    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          ...fixedAxisBelt,
          pulleys: {
            ...fixedAxisBelt.pulleys,
            'guide-a': {
              ...guideA,
              center: { ...guideA.center, z: quantity(-12, 'mm') },
            },
            'guide-b': {
              ...guideB,
              center: { ...guideB.center, z: quantity(12, 'mm') },
            },
          },
        },
      },
    };

    const route = solveBrown003Route(invalid);
    expect(route.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(route.diagnostics[0]?.message).toContain('straddle the driver center plane');
    expect(route.spans).toEqual([]);
  });

  it('rejects arbitrary guide separation instead of extrapolating an exact route', () => {
    const fixedAxisBelt = system();
    const guideA = pulley('guide-a');
    const guideB = pulley('guide-b');
    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          ...fixedAxisBelt,
          pulleys: {
            ...fixedAxisBelt.pulleys,
            'guide-a': {
              ...guideA,
              center: { ...guideA.center, z: quantity(-1, 'm') },
            },
            'guide-b': {
              ...guideB,
              center: { ...guideB.center, z: quantity(1, 'm') },
            },
          },
        },
      },
    };

    expect(solveBrown003Route(invalid).diagnostics[0]?.code).toBe('invalid-geometry');
  });

  it('rejects a pulley face that cannot contain the full belt track', () => {
    const driver = pulley('driver');
    const invalid = withPulley('driver', {
      ...driver,
      faceWidth: quantity(80, 'mm'),
    });
    const route = solveBrown003Route(invalid);
    expect(route.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(route.diagnostics[0]?.message).toContain('face is too narrow');
  });

  it('rejects overlapping side-by-side guide faces', () => {
    const guideB = pulley('guide-b');
    const invalid = withPulley('guide-b', {
      ...guideB,
      faceWidth: quantity(80, 'mm'),
    });
    const route = solveBrown003Route(invalid);
    expect(route.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(route.diagnostics[0]?.message).toContain('guide pulley faces overlap');
  });

  it('keeps continuity and route feasibility as independent contracts', () => {
    const continuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      parameters: { 'driver-radius': quantity(30, 'mm') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
    expect(continuity.diagnostics).toEqual([]);
    expect(continuity.angularRatios.driven).toBeCloseTo(0.5, 12);

    const route = solveBrown003Route(canonicalQuarterTurnBeltModel, {
      parameters: { 'driver-radius': quantity(30, 'mm') },
    });
    expect(route.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(route.diagnostics[0]?.message).toContain('straddle the driver center plane');
  });

  it('rejects invalid pulley face widths at shared model validation', () => {
    const driver = pulley('driver');
    const invalid = withPulley('driver', {
      ...driver,
      faceWidth: quantity(1, 'rad'),
    });
    const messages = validateSimulationModel(invalid).map((item) => item.message);
    expect(messages).toContain('Fixed-axis pulley face width must be a positive length');
    expect(() => solveBrown003Route(invalid)).not.toThrow();
    const route = solveBrown003Route(invalid);
    expect(route.diagnostics[0]?.code).toBe('invalid-model');
    expect(route.spans).toEqual([]);
  });

  it('rejects nonpositive belt width at shared model validation', () => {
    const fixedAxisBelt = system();
    const loop = fixedAxisBelt.loops['main-belt'];
    if (loop === undefined) throw new Error('Missing main belt loop');
    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          ...fixedAxisBelt,
          loops: {
            ...fixedAxisBelt.loops,
            'main-belt': { ...loop, beltWidth: quantity(0, 'mm') },
          },
        },
      },
    };
    const messages = validateSimulationModel(invalid).map((item) => item.message);
    expect(messages).toContain('Fixed-axis belt width must be a positive length');
    expect(solveBrown003Route(invalid).diagnostics[0]?.code).toBe('invalid-model');
  });

  it('normalizes every nonzero axis magnitude accepted by model validation', () => {
    const fixedAxisBelt = system();
    const driver = pulley('driver');
    const guideA = pulley('guide-a');
    const driven = pulley('driven');
    const guideB = pulley('guide-b');
    const scaled: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          ...fixedAxisBelt,
          pulleys: {
            driver: { ...driver, axis: [1e-10, 0, 0] as const },
            'guide-a': { ...guideA, axis: [0, 0, 1e-10] as const },
            driven: { ...driven, axis: [0, 0, 1e-10] as const },
            'guide-b': { ...guideB, axis: [0, 0, 1e-10] as const },
          },
        },
      },
    };

    expect(solveBrown003Route(scaled).diagnostics).toEqual([]);
  });

  it('keeps the reference face dimensions explicitly editorial rather than inferred from Brown', () => {
    expect(canonicalNumber(pulley('driver').faceWidth, 'length')).toBeCloseTo(0.1, 12);
    expect(canonicalNumber(pulley('guide-a').faceWidth, 'length')).toBeCloseTo(0.11, 12);
    expect(canonicalNumber(pulley('driven').faceWidth, 'length')).toBeCloseTo(0.11, 12);
    expect(canonicalNumber(pulley('guide-b').faceWidth, 'length')).toBeCloseTo(0.03, 12);
  });
});
