import { describe, expect, it } from 'vitest';
import {
  quantity,
  validateSimulationModel,
  type ModelState,
  type Vector2,
} from '@atlasmechanica/model';
import { analyticBeltAdapter } from './analyticBeltAdapter.js';
import {
  crossedBeltDriveModel,
  openBeltDriveModel,
} from './fixtures/beltDrive.js';

function scalarSignal(state: ModelState, id: string): number {
  const signal = state.signals[id];
  if (signal?.type !== 'scalar') {
    throw new Error(`Expected scalar signal ${id}`);
  }
  return signal.value.value;
}

function textSignal(state: ModelState, id: string): string {
  const signal = state.signals[id];
  if (signal?.type !== 'text') {
    throw new Error(`Expected text signal ${id}`);
  }
  return signal.value;
}

function vectorSignal(state: ModelState, id: string): Vector2 {
  const signal = state.signals[id];
  if (signal?.type !== 'vector2') {
    throw new Error(`Expected vector signal ${id}`);
  }
  return signal.value;
}

function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dot(a: Vector2, b: Vector2): number {
  return a.x * b.x + a.y * b.y;
}

function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

describe('canonical belt fixtures', () => {
  it('remain portable JSON and pass common model validation', () => {
    for (const model of [openBeltDriveModel, crossedBeltDriveModel]) {
      expect(validateSimulationModel(model)).toEqual([]);
      expect(JSON.parse(JSON.stringify(model))).toEqual(model);
      expect(analyticBeltAdapter.supports(model)).toBe(true);
    }
  });
});

describe('analytic belt adapter', () => {
  it('solves the open belt exactly with analytic derivatives', () => {
    const compiled = analyticBeltAdapter.compile(openBeltDriveModel);
    expect(compiled.capabilities).toEqual({
      position: 'exact',
      velocity: 'analytic',
      acceleration: 'analytic',
      force: 'unavailable',
      dynamics: 'unavailable',
      events: 'unavailable',
    });

    const state = compiled.createSession().evaluate({
      coordinates: { 'driver-angle': quantity(2, 'rad') },
      rates: { 'driver-angle': quantity(4, 'rad/s') },
      accelerations: { 'driver-angle': quantity(1, 'rad/s^2') },
    });

    expect(state.diagnostics).toEqual([]);
    expect(state.coordinates['driver-angle']?.position.value).toBeCloseTo(2, 12);
    expect(state.coordinates['driven-angle']?.position.value).toBeCloseTo(1, 12);
    expect(state.coordinates['driven-angle']?.velocity?.value).toBeCloseTo(2, 12);
    expect(state.coordinates['driven-angle']?.acceleration?.value).toBeCloseTo(
      0.5,
      12,
    );
    expect(state.bodies.driver?.angularVelocity).toBeCloseTo(4, 12);
    expect(state.bodies.driven?.angularVelocity).toBeCloseTo(2, 12);

    expect(scalarSignal(state, 'angular-ratio')).toBeCloseTo(0.5, 12);
    expect(textSignal(state, 'output-direction')).toBe('same');
    expect(scalarSignal(state, 'belt-linear-speed')).toBeCloseTo(0.12, 12);
    expect(scalarSignal(state, 'belt-travel')).toBeCloseTo(0.06, 12);

    const radiusDifference = 0.06 - 0.03;
    const expectedSpan = Math.sqrt(0.18 ** 2 - radiusDifference ** 2);
    const alpha = Math.asin(radiusDifference / 0.18);
    const expectedDriverWrap = Math.PI - 2 * alpha;
    const expectedDrivenWrap = Math.PI + 2 * alpha;
    const expectedLength =
      2 * expectedSpan +
      0.03 * expectedDriverWrap +
      0.06 * expectedDrivenWrap;

    expect(scalarSignal(state, 'straight-span-length')).toBeCloseTo(
      expectedSpan,
      12,
    );
    expect(scalarSignal(state, 'driver-wrap-angle')).toBeCloseTo(
      expectedDriverWrap,
      12,
    );
    expect(scalarSignal(state, 'driven-wrap-angle')).toBeCloseTo(
      expectedDrivenWrap,
      12,
    );
    expect(scalarSignal(state, 'belt-length')).toBeCloseTo(expectedLength, 12);
    expect(scalarSignal(state, 'validity-margin')).toBeCloseTo(0.15, 12);

    const driverContact = vectorSignal(state, 'driver-contact-a');
    const drivenContact = vectorSignal(state, 'driven-contact-a');
    const driverCenter = { x: 0, y: 0 };
    const drivenCenter = { x: 0.18, y: 0 };
    const span = subtract(drivenContact, driverContact);

    expect(distance(driverContact, driverCenter)).toBeCloseTo(0.03, 12);
    expect(distance(drivenContact, drivenCenter)).toBeCloseTo(0.06, 12);
    expect(dot(subtract(driverContact, driverCenter), span)).toBeCloseTo(0, 12);
    expect(dot(subtract(drivenContact, drivenCenter), span)).toBeCloseTo(0, 12);
  });

  it('reverses the driven pulley and uses internal tangents for a crossed belt', () => {
    const state = analyticBeltAdapter.compile(crossedBeltDriveModel).createSession().evaluate({
      coordinates: { 'driver-angle': quantity(2, 'rad') },
      rates: { 'driver-angle': quantity(4, 'rad/s') },
      accelerations: { 'driver-angle': quantity(1, 'rad/s^2') },
    });

    expect(state.diagnostics).toEqual([]);
    expect(state.coordinates['driven-angle']?.position.value).toBeCloseTo(-1, 12);
    expect(state.coordinates['driven-angle']?.velocity?.value).toBeCloseTo(-2, 12);
    expect(state.coordinates['driven-angle']?.acceleration?.value).toBeCloseTo(
      -0.5,
      12,
    );
    expect(scalarSignal(state, 'angular-ratio')).toBeCloseTo(-0.5, 12);
    expect(textSignal(state, 'output-direction')).toBe('reversed');

    const radiusSum = 0.03 + 0.06;
    const expectedSpan = Math.sqrt(0.18 ** 2 - radiusSum ** 2);
    const alpha = Math.asin(radiusSum / 0.18);
    const expectedWrap = Math.PI + 2 * alpha;
    const expectedLength = 2 * expectedSpan + radiusSum * expectedWrap;

    expect(scalarSignal(state, 'straight-span-length')).toBeCloseTo(
      expectedSpan,
      12,
    );
    expect(scalarSignal(state, 'driver-wrap-angle')).toBeCloseTo(expectedWrap, 12);
    expect(scalarSignal(state, 'driven-wrap-angle')).toBeCloseTo(expectedWrap, 12);
    expect(scalarSignal(state, 'belt-length')).toBeCloseTo(expectedLength, 12);
    expect(scalarSignal(state, 'validity-margin')).toBeCloseTo(0.09, 12);
  });

  it('normalizes authored degrees to runtime radians', () => {
    const state = analyticBeltAdapter.compile(openBeltDriveModel).createSession().evaluate({
      coordinates: { 'driver-angle': quantity(180, 'deg') },
      rates: { 'driver-angle': quantity(60, 'deg/s') },
    });

    expect(state.coordinates['driver-angle']?.position.value).toBeCloseTo(
      Math.PI,
      12,
    );
    expect(state.coordinates['driven-angle']?.position.value).toBeCloseTo(
      Math.PI / 2,
      12,
    );
    expect(state.coordinates['driven-angle']?.velocity?.value).toBeCloseTo(
      Math.PI / 6,
      12,
    );
  });

  it('reports invalid geometry instead of returning NaNs', () => {
    const state = analyticBeltAdapter
      .compile(crossedBeltDriveModel)
      .createSession()
      .evaluate({
        coordinates: { 'driver-angle': quantity(1, 'rad') },
        parameters: { 'center-distance': quantity(80, 'mm') },
      });

    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(state.coordinates['driver-angle']?.position.value).toBeCloseTo(1, 12);
    expect(state.coordinates['driven-angle']).toBeUndefined();
    expect(state.bodies.driven).toBeUndefined();
    expect(scalarSignal(state, 'validity-margin')).toBeCloseTo(-0.01, 12);
  });

  it('keeps concurrent sessions independent', () => {
    const compiled = analyticBeltAdapter.compile(openBeltDriveModel);
    const defaultSession = compiled.createSession();
    const oneToOneSession = compiled.createSession({
      parameters: { 'driven-radius': quantity(30, 'mm') },
    });

    const defaultState = defaultSession.evaluate({
      coordinates: { 'driver-angle': quantity(2, 'rad') },
    });
    const oneToOneState = oneToOneSession.evaluate({
      coordinates: { 'driver-angle': quantity(2, 'rad') },
    });

    expect(defaultState.coordinates['driven-angle']?.position.value).toBeCloseTo(
      1,
      12,
    );
    expect(oneToOneState.coordinates['driven-angle']?.position.value).toBeCloseTo(
      2,
      12,
    );
    expect(defaultSession.snapshot().parameters).toEqual({});
    expect(oneToOneSession.snapshot().parameters['driven-radius']).toEqual(
      quantity(30, 'mm'),
    );
  });

  it('distinguishes invalid input units from invalid physical geometry', () => {
    const state = analyticBeltAdapter.compile(openBeltDriveModel).createSession().evaluate({
      coordinates: { 'driver-angle': quantity(1, 'm') },
    });

    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]?.code).toBe('invalid-input');
    expect(state.coordinates).toEqual({});
  });
});
