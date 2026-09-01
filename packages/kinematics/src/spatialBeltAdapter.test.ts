import { describe, expect, it } from 'vitest';

import {
  canonicalNumber,
  quantity,
  validateSimulationModel,
  type ModelState,
  type SimulationModel,
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

function fixedAxisSystem() {
  const system = canonicalQuarterTurnBeltModel.systems.fixedAxisBelt;
  if (system === undefined) throw new Error('Missing fixed-axis system');
  return system;
}

function referenceConfiguration() {
  const configuration = canonicalQuarterTurnBeltModel.configurations.reference;
  if (configuration === undefined) throw new Error('Missing reference configuration');
  return configuration;
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

    const system = fixedAxisSystem();
    const loop = system.loops['main-belt'];
    if (loop === undefined) throw new Error('Missing Brown 003 loop');
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
    const system = fixedAxisSystem();
    const driver = system.pulleys.driver;
    if (driver === undefined) throw new Error('Missing driver pulley');

    const invalid: SimulationModel = {
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

  it('rejects arbitrary one-loop layouts before routed tangent geometry exists', () => {
    const system = fixedAxisSystem();
    const driver = system.pulleys.driver;
    const driven = system.pulleys.driven;
    if (driver === undefined || driven === undefined) throw new Error('Missing power pulley');

    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          ...system,
          pulleys: {
            ...system.pulleys,
            driven: { ...driven, center: driver.center },
          },
        },
      },
    };

    expect(spatialBeltAdapter.supports(invalid)).toBe(false);
    expect(() => spatialBeltAdapter.compile(invalid)).toThrow('restricted to the validated Brown 003');
  });

  it('returns invalid geometry when a radius edit consumes the validated contact clearance', () => {
    const state = spatialBeltAdapter
      .compile(canonicalQuarterTurnBeltModel)
      .createSession({ configuration: 'reference' })
      .evaluate({
        parameters: { 'driver-radius': quantity(500, 'mm') },
        coordinates: { 'driver-angle': quantity(20, 'deg') },
      });

    expect(state.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(state.coordinates).toEqual({});
  });

  it('validates configuration coordinate units before compilation', () => {
    const reference = referenceConfiguration();
    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      configurations: {
        ...canonicalQuarterTurnBeltModel.configurations,
        reference: {
          ...reference,
          coordinates: {
            ...reference.coordinates,
            'driver-angle': quantity(10, 'mm'),
          },
        },
      },
    };

    expect(validateSimulationModel(invalid).map((item) => item.message)).toContain(
      'Configuration coordinate has the wrong quantity kind',
    );
    expect(() => spatialBeltAdapter.compile(invalid)).toThrow(
      'Configuration coordinate has the wrong quantity kind',
    );
  });

  it('rejects empty fixed-axis systems during model validation', () => {
    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      systems: {
        fixedAxisBelt: {
          dimensionality: 'spatial-fixed-axis',
          pulleys: {},
          loops: {},
        },
      },
    };

    const messages = validateSimulationModel(invalid).map((item) => item.message);
    expect(messages).toContain('Fixed-axis belt system requires at least one pulley');
    expect(messages).toContain('Fixed-axis belt system requires at least one belt loop');
  });

  it('rejects hybrid models until the adapter can compose planar body state', () => {
    const planar = createBeltDriveModel('open');
    const mechanical = planar.systems.mechanical;
    const centerDistance = planar.parameters['center-distance'];
    if (mechanical === undefined || centerDistance === undefined) {
      throw new Error('Missing planar belt fixture data');
    }

    const hybrid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      parameters: {
        ...canonicalQuarterTurnBeltModel.parameters,
        'center-distance': centerDistance,
      },
      systems: {
        ...canonicalQuarterTurnBeltModel.systems,
        mechanical,
      },
    };

    expect(validateSimulationModel(hybrid)).toEqual([]);
    expect(spatialBeltAdapter.supports(hybrid)).toBe(false);
    expect(() => spatialBeltAdapter.compile(hybrid)).toThrow('restricted to the validated Brown 003');
  });

  it('rejects non-finite radius overrides instead of emitting NaN state', () => {
    const state = spatialBeltAdapter
      .compile(canonicalQuarterTurnBeltModel)
      .createSession({ configuration: 'reference' })
      .evaluate({
        parameters: { 'driver-radius': quantity(Number.POSITIVE_INFINITY, 'm') },
        coordinates: { 'driver-angle': quantity(10, 'deg') },
      });

    expect(state.diagnostics[0]?.code).toBe('invalid-input');
    expect(state.diagnostics[0]?.message).toContain('must be finite');
    expect(state.coordinates).toEqual({});
    expect(state.signals).toEqual({});
  });

  it('requires the signal definitions emitted by the v0 adapter', () => {
    const signals = { ...canonicalQuarterTurnBeltModel.signals };
    delete signals['output-angular-ratio'];
    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      signals,
    };

    expect(spatialBeltAdapter.supports(invalid)).toBe(false);
    expect(() => spatialBeltAdapter.compile(invalid)).toThrow('restricted to the validated Brown 003');
  });
});
