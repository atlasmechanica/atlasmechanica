import { describe, expect, it } from 'vitest';

import {
  hasErrors,
  quantity,
  type ModelState,
  type QuantityValue,
} from '@atlasmechanica/model';

import * as kinematics from './index.js';
import { openBeltDriveModel } from './fixtures/beltDrive.js';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';
import { spatialBeltAdapter } from './spatialBeltAdapter.js';

function scalarSignal(state: ModelState, id: string): number {
  const signal = state.signals[id];
  if (signal?.type !== 'scalar') throw new Error(`Missing scalar signal ${id}`);
  return signal.value.value;
}

function coordinate(state: ModelState, id: string) {
  const value = state.coordinates[id];
  if (value === undefined) throw new Error(`Missing coordinate ${id}`);
  return value;
}

describe('Brown 003 spatial belt SimulationAdapter', () => {
  it('exports the planned adapter id and keeps v0 deliberately Brown-003-specific', () => {
    expect(kinematics.spatialBeltAdapter).toBe(spatialBeltAdapter);
    expect(spatialBeltAdapter.id).toBe('atlas.spatial-belt.v0');
    expect(spatialBeltAdapter.supports(canonicalQuarterTurnBeltModel)).toBe(true);
    expect(spatialBeltAdapter.supports(openBeltDriveModel)).toBe(false);
    expect(() => spatialBeltAdapter.compile(openBeltDriveModel)).toThrow(
      'Model is not supported by the Brown 003 spatial belt adapter',
    );
  });

  it('evaluates the canonical four-pulley transmission through the Atlas runtime contract', () => {
    const compiled = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel);
    expect(compiled.capabilities).toEqual({
      position: 'exact',
      velocity: 'analytic',
      acceleration: 'analytic',
      force: 'unavailable',
      dynamics: 'unavailable',
      events: 'unavailable',
    });

    const session = compiled.createSession();
    const state = session.evaluate({
      coordinates: { 'driver-angle': quantity(Math.PI / 2, 'rad') },
      rates: { 'driver-angle': quantity(Math.PI, 'rad/s') },
      accelerations: { 'driver-angle': quantity(2, 'rad/s^2') },
    });

    expect(state.diagnostics).toEqual([]);
    expect(hasErrors(state)).toBe(false);
    expect(state.model).toBe(canonicalQuarterTurnBeltModel.id);
    expect(state.configuration).toBe('reference');
    expect(state.bodies).toEqual({});

    expect(coordinate(state, 'driver-angle').position.value).toBeCloseTo(Math.PI / 2, 12);
    expect(coordinate(state, 'driven-angle').position.value).toBeCloseTo(3 * Math.PI / 8, 12);
    expect(coordinate(state, 'guide-a-angle').position.value).toBeCloseTo(9 * Math.PI / 8, 12);
    expect(coordinate(state, 'guide-b-angle').position.value).toBeCloseTo(9 * Math.PI / 8, 12);

    expect(coordinate(state, 'driver-angle').velocity?.value).toBeCloseTo(Math.PI, 12);
    expect(coordinate(state, 'driven-angle').velocity?.value).toBeCloseTo(0.75 * Math.PI, 12);
    expect(coordinate(state, 'guide-a-angle').velocity?.value).toBeCloseTo(2.25 * Math.PI, 12);
    expect(coordinate(state, 'guide-b-angle').velocity?.value).toBeCloseTo(2.25 * Math.PI, 12);

    expect(coordinate(state, 'driver-angle').acceleration?.value).toBeCloseTo(2, 12);
    expect(coordinate(state, 'driven-angle').acceleration?.value).toBeCloseTo(1.5, 12);
    expect(coordinate(state, 'guide-a-angle').acceleration?.value).toBeCloseTo(4.5, 12);
    expect(coordinate(state, 'guide-b-angle').acceleration?.value).toBeCloseTo(4.5, 12);

    expect(scalarSignal(state, 'output-angular-ratio')).toBeCloseTo(0.75, 12);
    expect(scalarSignal(state, 'belt-travel')).toBeCloseTo(0.045 * Math.PI / 2, 12);
    expect(scalarSignal(state, 'belt-linear-speed')).toBeCloseTo(0.045 * Math.PI, 12);
  });

  it('fails the adapter state when continuity is valid but the same parameters break the Brown route', () => {
    const session = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel).createSession();
    const state = session.evaluate({
      parameters: { 'driver-radius': quantity(30, 'mm') },
      coordinates: { 'driver-angle': quantity(1, 'rad') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });

    expect(hasErrors(state)).toBe(true);
    expect(state.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(state.diagnostics[0]?.message).toContain('straddle the driver center plane');
    expect(coordinate(state, 'driven-angle').position.value).toBeCloseTo(0.5, 12);
    expect(scalarSignal(state, 'output-angular-ratio')).toBeCloseTo(0.5, 12);
  });

  it('composes session and evaluation parameter overrides before continuity and route evaluation', () => {
    const session = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel).createSession({
      parameters: { 'driven-radius': quantity(55, 'mm') },
    });

    expect(session.snapshot().parameters['driven-radius']).toEqual(quantity(55, 'mm'));

    const sessionState = session.evaluate({
      coordinates: { 'driver-angle': quantity(1, 'rad') },
    });
    expect(sessionState.diagnostics).toEqual([]);
    expect(scalarSignal(sessionState, 'output-angular-ratio')).toBeCloseTo(45 / 55, 12);

    const requestState = session.evaluate({
      parameters: { 'driven-radius': quantity(50, 'mm') },
      coordinates: { 'driver-angle': quantity(1, 'rad') },
    });
    expect(requestState.diagnostics).toEqual([]);
    expect(scalarSignal(requestState, 'output-angular-ratio')).toBeCloseTo(0.9, 12);
  });

  it('preserves fail-closed parameter override semantics through session merging', () => {
    const session = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel).createSession();
    const nonEnumerableCollision: Record<string, QuantityValue> = {};
    Object.defineProperty(nonEnumerableCollision, 'toString', {
      value: quantity(30, 'mm'),
      enumerable: false,
    });

    const state = session.evaluate({
      parameters: nonEnumerableCollision,
    });
    expect(hasErrors(state)).toBe(true);
    expect(state.diagnostics[0]?.code).toBe('invalid-input');
    expect(state.diagnostics[0]?.message).toContain('Unknown parameter override toString');
  });

  it('keeps dependent and non-finite inputs fail-closed through the adapter', () => {
    const session = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel).createSession();

    const dependent = session.evaluate({
      coordinates: {
        'driver-angle': quantity(0, 'rad'),
        'driven-angle': quantity(0, 'rad'),
      },
    });
    expect(dependent.diagnostics[0]?.code).toBe('invalid-input');
    expect(dependent.diagnostics[0]?.message).toContain('only driver coordinate');
    expect(dependent.coordinates).toEqual({});

    const nonFinite = session.evaluate({
      rates: { 'driver-angle': quantity(Number.NaN, 'rad/s') },
    });
    expect(nonFinite.diagnostics[0]?.code).toBe('invalid-input');
    expect(nonFinite.diagnostics[0]?.message).toContain('must be finite');
  });

  it('implements reset and snapshot without mutating authored session overrides', () => {
    const session = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel).createSession({
      configuration: 'reference',
      parameters: { 'driven-radius': quantity(55, 'mm') },
    });

    expect(session.snapshot()).toEqual({
      configuration: 'reference',
      parameters: { 'driven-radius': quantity(55, 'mm') },
      modes: {},
    });

    session.reset();
    expect(session.snapshot().configuration).toBe('reference');
    expect(() => session.reset('missing')).toThrow('Unknown configuration missing');
  });
});
