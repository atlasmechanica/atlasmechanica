import { describe, expect, it } from 'vitest';

import {
  canonicalNumber,
  quantity,
  validateSimulationModel,
  type ModelState,
} from '@atlasmechanica/model';
import { createBeltDriveModel } from './fixtures/beltDrive.js';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';
import { spatialBeltAdapter } from './spatialBeltAdapter.js';

function coordinate(state: ModelState, id: string) {
  const value = state.coordinates[id];
  if (value === undefined) throw new Error(`Missing coordinate ${id}`);
  return value;
}

function scalarSignal(state: ModelState, id: string): number {
  const value = state.signals[id];
  if (value?.type !== 'scalar') throw new Error(`Missing scalar signal ${id}`);
  return value.value.value;
}

describe('fixed-axis spatial belt model', () => {
  it('validates without requiring planar rigid bodies', () => {
    expect(validateSimulationModel(canonicalQuarterTurnBeltModel)).toEqual([]);
    expect(canonicalQuarterTurnBeltModel.systems.mechanical).toBeUndefined();
    expect(canonicalQuarterTurnBeltModel.systems.fixedAxisBelt?.dimensionality).toBe(
      'spatial-fixed-axis',
    );
    expect(spatialBeltAdapter.supports(canonicalQuarterTurnBeltModel)).toBe(true);
    expect(spatialBeltAdapter.supports(createBeltDriveModel('open'))).toBe(false);
  });

  it('preserves one signed belt speed across both power pulleys and both guides', () => {
    const state = spatialBeltAdapter
      .compile(canonicalQuarterTurnBeltModel)
      .createSession({ configuration: 'reference' })
      .evaluate({
        coordinates: { 'driver-angle': quantity(90, 'deg') },
        rates: { 'driver-angle': quantity(180, 'deg/s') },
        accelerations: { 'driver-angle': quantity(90, 'deg/s^2') },
      });

    expect(state.diagnostics).toEqual([]);
    const driver = coordinate(state, 'driver-angle');
    const driven = coordinate(state, 'driven-angle');
    const guideA = coordinate(state, 'guide-a-angle');
    const guideB = coordinate(state, 'guide-b-angle');

    expect(driver.position.value).toBeCloseTo(Math.PI / 2, 12);
    expect(driven.position.value).toBeCloseTo(3 * Math.PI / 8, 12);
    expect(guideA.position.value).toBeCloseTo(9 * Math.PI / 8, 12);
    expect(guideB.position.value).toBeCloseTo(-9 * Math.PI / 8, 12);

    expect(driver.velocity?.value).toBeCloseTo(Math.PI, 12);
    expect(driven.velocity?.value).toBeCloseTo(0.75 * Math.PI, 12);
    expect(guideA.velocity?.value).toBeCloseTo(2.25 * Math.PI, 12);
    expect(guideB.velocity?.value).toBeCloseTo(-2.25 * Math.PI, 12);

    expect(driver.acceleration?.value).toBeCloseTo(Math.PI / 2, 12);
    expect(driven.acceleration?.value).toBeCloseTo(0.75 * Math.PI / 2, 12);
    expect(guideA.acceleration?.value).toBeCloseTo(2.25 * Math.PI / 2, 12);
    expect(guideB.acceleration?.value).toBeCloseTo(-2.25 * Math.PI / 2, 12);

    expect(scalarSignal(state, 'output-angular-ratio')).toBeCloseTo(0.75, 12);
    expect(scalarSignal(state, 'belt-linear-speed')).toBeCloseTo(0.045 * Math.PI, 12);
    expect(scalarSignal(state, 'belt-travel')).toBeCloseTo(0.045 * Math.PI / 2, 12);

    const system = canonicalQuarterTurnBeltModel.systems.fixedAxisBelt;
    const loop = system?.loops['main-belt'];
    if (system === undefined || loop === undefined) throw new Error('Missing Brown 003 loop');
    const expectedBeltSpeed = scalarSignal(state, 'belt-linear-speed');
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
      const omega = coordinate(state, pulley.coordinate).velocity?.value;
      if (omega === undefined) throw new Error(`Missing rate for ${pulley.coordinate}`);
      expect(contact.sense * radius * omega).toBeCloseTo(expectedBeltSpeed, 12);
    }
  });

  it('derives ratios from parameter overrides rather than authored presentation values', () => {
    const state = spatialBeltAdapter
      .compile(canonicalQuarterTurnBeltModel)
      .createSession({ configuration: 'reference' })
      .evaluate({
        parameters: { 'driver-radius': quantity(30, 'mm') },
        coordinates: { 'driver-angle': quantity(120, 'deg') },
        rates: { 'driver-angle': quantity(1, 'rad/s') },
      });

    expect(state.diagnostics).toEqual([]);
    expect(scalarSignal(state, 'output-angular-ratio')).toBeCloseTo(0.5, 12);
    expect(coordinate(state, 'driven-angle').velocity?.value).toBeCloseTo(0.5, 12);
    expect(coordinate(state, 'guide-a-angle').velocity?.value).toBeCloseTo(1.5, 12);
    expect(coordinate(state, 'guide-b-angle').velocity?.value).toBeCloseTo(-1.5, 12);
    expect(scalarSignal(state, 'belt-linear-speed')).toBeCloseTo(0.03, 12);
  });

  it('rejects dependent pulley coordinates as prescribed inputs', () => {
    const state = spatialBeltAdapter
      .compile(canonicalQuarterTurnBeltModel)
      .createSession({ configuration: 'reference' })
      .evaluate({
        coordinates: {
          'driver-angle': quantity(0, 'rad'),
          'driven-angle': quantity(0, 'rad'),
        },
      });

    expect(state.diagnostics[0]?.code).toBe('invalid-input');
    expect(state.diagnostics[0]?.message).toContain('only driver coordinate');
  });

  it('rejects degenerate fixed axes during model validation', () => {
    const system = canonicalQuarterTurnBeltModel.systems.fixedAxisBelt;
    if (system === undefined) throw new Error('Missing fixed-axis system');
    const driver = system.pulleys.driver;
    if (driver === undefined) throw new Error('Missing driver pulley');

    const invalid = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          ...system,
          pulleys: {
            ...system.pulleys,
            driver: { ...driver, axis: [0, 0, 0] as const },
          },
        },
      },
    };

    expect(validateSimulationModel(invalid).map((item) => item.message)).toContain(
      'Fixed-axis pulley axis must be finite and non-zero',
    );
  });
});
