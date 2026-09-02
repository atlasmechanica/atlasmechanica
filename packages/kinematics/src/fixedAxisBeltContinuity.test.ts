import { describe, expect, it } from 'vitest';

import {
  canonicalNumber,
  quantity,
  validateSimulationModel,
  type SimulationModel,
} from '@atlasmechanica/model';
import * as kinematics from './index.js';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';
import {
  evaluateFixedAxisBeltContinuity,
  type FixedAxisBeltContinuityResult,
} from './fixedAxisBeltContinuity.js';

function coordinate(result: FixedAxisBeltContinuityResult, id: string) {
  const value = result.coordinates[id];
  if (value === undefined) throw new Error(`Missing coordinate ${id}`);
  return value;
}

function fixedAxisSystem() {
  const system = canonicalQuarterTurnBeltModel.systems.fixedAxisBelt;
  if (system === undefined) throw new Error('Missing fixed-axis system');
  return system;
}

describe('fixed-axis belt continuity oracle', () => {
  it('does not export a spatial SimulationAdapter before route geometry exists', () => {
    expect('spatialBeltAdapter' in kinematics).toBe(false);
    expect('evaluateFixedAxisBeltContinuity' in kinematics).toBe(true);
  });

  it('preserves one signed no-slip belt speed across all four Brown 003 contacts', () => {
    const result = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      configuration: 'reference',
      coordinates: { 'driver-angle': quantity(90, 'deg') },
      rates: { 'driver-angle': quantity(180, 'deg/s') },
      accelerations: { 'driver-angle': quantity(90, 'deg/s^2') },
    });

    expect(result.diagnostics).toEqual([]);
    expect(coordinate(result, 'driver-angle').position.value).toBeCloseTo(Math.PI / 2, 12);
    expect(coordinate(result, 'driven-angle').position.value).toBeCloseTo(3 * Math.PI / 8, 12);
    expect(coordinate(result, 'guide-a-angle').position.value).toBeCloseTo(9 * Math.PI / 8, 12);
    expect(coordinate(result, 'guide-b-angle').position.value).toBeCloseTo(-9 * Math.PI / 8, 12);
    expect(result.angularRatios.driven).toBeCloseTo(0.75, 12);
    expect(result.beltLinearSpeed).toBeCloseTo(0.045 * Math.PI, 12);
    expect(result.beltTravel).toBeCloseTo(0.045 * Math.PI / 2, 12);

    const system = fixedAxisSystem();
    const loop = system.loops['main-belt'];
    if (loop === undefined) throw new Error('Missing Brown 003 loop');
    const expected = result.beltLinearSpeed;
    if (expected === undefined) throw new Error('Missing belt speed');

    for (const contact of loop.contacts) {
      const pulley = system.pulleys[contact.pulley];
      if (pulley === undefined) throw new Error(`Missing pulley ${contact.pulley}`);
      const radius = canonicalNumber(
        'parameter' in pulley.pitchRadius
          ? canonicalQuarterTurnBeltModel.parameters[pulley.pitchRadius.parameter]?.default
            ?? quantity(Number.NaN, 'm')
          : pulley.pitchRadius,
        'length',
      );
      const omega = coordinate(result, pulley.coordinate).velocity?.value;
      if (omega === undefined) throw new Error(`Missing rate ${pulley.coordinate}`);
      expect(contact.sense * radius * omega).toBeCloseTo(expected, 12);
    }
  });

  it('derives continuity ratios from parameter overrides', () => {
    const result = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      parameters: { 'driver-radius': quantity(30, 'mm') },
      coordinates: { 'driver-angle': quantity(120, 'deg') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.angularRatios.driven).toBeCloseTo(0.5, 12);
    expect(coordinate(result, 'driven-angle').velocity?.value).toBeCloseTo(0.5, 12);
    expect(coordinate(result, 'guide-a-angle').velocity?.value).toBeCloseTo(1.5, 12);
    expect(coordinate(result, 'guide-b-angle').velocity?.value).toBeCloseTo(-1.5, 12);
    expect(result.beltLinearSpeed).toBeCloseTo(0.03, 12);
  });

  it('rejects dependent coordinates as prescribed continuity inputs', () => {
    const result = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      coordinates: {
        'driver-angle': quantity(0, 'rad'),
        'driven-angle': quantity(0, 'rad'),
      },
    });

    expect(result.diagnostics[0]?.code).toBe('invalid-input');
    expect(result.diagnostics[0]?.message).toContain('only driver coordinate');
    expect(result.coordinates).toEqual({});
  });

  it('does not certify route geometry', () => {
    const system = fixedAxisSystem();
    const guideA = system.pulleys['guide-a'];
    const guideB = system.pulleys['guide-b'];
    if (guideA === undefined || guideB === undefined) throw new Error('Missing guides');

    const geometricallyUnproven: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          ...system,
          pulleys: {
            ...system.pulleys,
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

    expect(validateSimulationModel(geometricallyUnproven)).toEqual([]);
    const result = evaluateFixedAxisBeltContinuity(geometricallyUnproven, {
      coordinates: { 'driver-angle': quantity(90, 'deg') },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.angularRatios.driven).toBeCloseTo(0.75, 12);
  });

  it('returns diagnostics rather than throwing for invalid center units', () => {
    const system = fixedAxisSystem();
    const guideA = system.pulleys['guide-a'];
    if (guideA === undefined) throw new Error('Missing guide A');

    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          ...system,
          pulleys: {
            ...system.pulleys,
            'guide-a': {
              ...guideA,
              center: { ...guideA.center, x: quantity(0, 'rad') },
            },
          },
        },
      },
    };

    expect(() => evaluateFixedAxisBeltContinuity(invalid)).not.toThrow();
    const result = evaluateFixedAxisBeltContinuity(invalid);
    expect(result.diagnostics.some((item) => item.code === 'invalid-model')).toBe(true);
    expect(result.coordinates).toEqual({});
  });

  it('accepts every axis magnitude accepted by shared model validation', () => {
    const system = fixedAxisSystem();
    const driver = system.pulleys.driver;
    const guideA = system.pulleys['guide-a'];
    const driven = system.pulleys.driven;
    const guideB = system.pulleys['guide-b'];
    if (
      driver === undefined
      || guideA === undefined
      || driven === undefined
      || guideB === undefined
    ) {
      throw new Error('Missing Brown 003 pulley');
    }

    const scaled: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          ...system,
          pulleys: {
            driver: { ...driver, axis: [1e-10, 0, 0] as const },
            'guide-a': { ...guideA, axis: [0, 0, 1e-10] as const },
            driven: { ...driven, axis: [0, 0, 1e-10] as const },
            'guide-b': { ...guideB, axis: [0, 0, 1e-10] as const },
          },
        },
      },
    };

    expect(validateSimulationModel(scaled)).toEqual([]);
    expect(evaluateFixedAxisBeltContinuity(scaled).diagnostics).toEqual([]);
  });

  it('rejects configuration-less models through shared validation', () => {
    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      configurations: {},
    };
    const result = evaluateFixedAxisBeltContinuity(invalid);
    expect(result.diagnostics.map((item) => item.message)).toContain(
      'SimulationModel requires at least one reference configuration',
    );
  });

  it('rejects non-finite requests and derived overflow', () => {
    const nonFinite = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      coordinates: { 'driver-angle': quantity(Number.POSITIVE_INFINITY, 'rad') },
    });
    expect(nonFinite.diagnostics[0]?.code).toBe('invalid-input');
    expect(nonFinite.coordinates).toEqual({});

    const overflow = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      coordinates: { 'driver-angle': quantity(Number.MAX_VALUE, 'rad') },
    });
    expect(overflow.diagnostics[0]?.code).toBe('invalid-input');
    expect(overflow.coordinates).toEqual({});
  });
});
