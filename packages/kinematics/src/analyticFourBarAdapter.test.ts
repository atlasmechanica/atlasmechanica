import { describe, expect, it } from 'vitest';
import {
  quantity,
  validateSimulationModel,
  type BodyState,
  type ModelState,
  type Vector2,
} from '@atlasmechanica/model';
import { analyticFourBarAdapter } from './analyticFourBarAdapter.js';
import { canonicalFourBarModel } from './fixtures/fourBar.js';
import { canonicalFourBarOpenOracle } from './fixtures/fourBarOracle.js';

function scalarSignal(state: ModelState, id: string): number {
  const signal = state.signals[id];
  if (signal?.type !== 'scalar') {
    throw new Error(`Expected scalar signal ${id}`);
  }
  return signal.value.value;
}

function vectorSignal(state: ModelState, id: string): Vector2 {
  const signal = state.signals[id];
  if (signal?.type !== 'vector2') {
    throw new Error(`Expected vector signal ${id}`);
  }
  return signal.value;
}

function textSignal(state: ModelState, id: string): string {
  const signal = state.signals[id];
  if (signal?.type !== 'text') {
    throw new Error(`Expected text signal ${id}`);
  }
  return signal.value;
}

function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function cross(a: Vector2, b: Vector2): number {
  return a.x * b.y - a.y * b.x;
}

function rotate(point: Vector2, angle: number): Vector2 {
  return {
    x: Math.cos(angle) * point.x - Math.sin(angle) * point.y,
    y: Math.sin(angle) * point.x + Math.cos(angle) * point.y,
  };
}

function add(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(value: Vector2, factor: number): Vector2 {
  return { x: value.x * factor, y: value.y * factor };
}

function angularCross(omega: number, radius: Vector2): Vector2 {
  return { x: -omega * radius.y, y: omega * radius.x };
}

function pointKinematics(
  body: BodyState,
  localPoint: Vector2,
): { position: Vector2; velocity?: Vector2; acceleration?: Vector2 } {
  const radius = rotate(localPoint, body.pose.angle);
  const result: {
    position: Vector2;
    velocity?: Vector2;
    acceleration?: Vector2;
  } = {
    position: add({ x: body.pose.x, y: body.pose.y }, radius),
  };

  if (body.linearVelocity !== undefined && body.angularVelocity !== undefined) {
    result.velocity = add(
      body.linearVelocity,
      angularCross(body.angularVelocity, radius),
    );
  }

  if (
    body.linearAcceleration !== undefined &&
    body.angularVelocity !== undefined &&
    body.angularAcceleration !== undefined
  ) {
    result.acceleration = add(
      body.linearAcceleration,
      add(
        angularCross(body.angularAcceleration, radius),
        scale(radius, -(body.angularVelocity ** 2)),
      ),
    );
  }

  return result;
}

function expectVectorClose(actual: Vector2, expected: Vector2, digits = 10): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe('canonical four-bar fixture', () => {
  it('is portable, body-centric, and accepted by the analytic adapter', () => {
    expect(validateSimulationModel(canonicalFourBarModel)).toEqual([]);
    expect(JSON.parse(JSON.stringify(canonicalFourBarModel))).toEqual(
      canonicalFourBarModel,
    );
    expect(analyticFourBarAdapter.supports(canonicalFourBarModel)).toBe(true);

    const mechanical = canonicalFourBarModel.systems.mechanical;
    expect(Object.keys(mechanical?.bodies ?? {})).toEqual([
      'ground',
      'crank',
      'coupler',
      'rocker',
    ]);
    expect(Object.keys(mechanical?.joints ?? {})).toHaveLength(4);
    expect(Object.keys(mechanical?.couplings ?? {})).toHaveLength(0);
    expect(mechanical?.bodies.coupler?.features.tracer?.type).toBe('point');
    expect(canonicalFourBarModel.configurations.open.bodyPoses?.coupler).toBeDefined();
    expect(canonicalFourBarModel.configurations.crossed.bodyPoses?.coupler).toBeDefined();
  });
});

describe('analytic four-bar oracle', () => {
  it('reproduces the independent open-branch position and derivative checkpoints', () => {
    const session = analyticFourBarAdapter
      .compile(canonicalFourBarModel)
      .createSession({ configuration: 'open' });

    for (const checkpoint of canonicalFourBarOpenOracle) {
      const state = session.evaluate({
        coordinates: {
          'driver-angle': quantity(checkpoint.driverAngleDeg, 'deg'),
        },
        rates: { 'driver-angle': quantity(1, 'rad/s') },
        accelerations: { 'driver-angle': quantity(0, 'rad/s^2') },
      });

      expect(state.diagnostics).toEqual([]);
      expectVectorClose(vectorSignal(state, 'point-b-position'), checkpoint.pointB, 11);
      expect(scalarSignal(state, 'coupler-angle')).toBeCloseTo(
        checkpoint.couplerAngle,
        11,
      );
      expect(scalarSignal(state, 'rocker-angle')).toBeCloseTo(
        checkpoint.rockerAngle,
        11,
      );
      expect(scalarSignal(state, 'coupler-angular-velocity')).toBeCloseTo(
        checkpoint.couplerAngularVelocity,
        11,
      );
      expect(scalarSignal(state, 'rocker-angular-velocity')).toBeCloseTo(
        checkpoint.rockerAngularVelocity,
        11,
      );
      expect(scalarSignal(state, 'coupler-angular-acceleration')).toBeCloseTo(
        checkpoint.couplerAngularAcceleration,
        10,
      );
      expect(scalarSignal(state, 'rocker-angular-acceleration')).toBeCloseTo(
        checkpoint.rockerAngularAcceleration,
        10,
      );
    }
  });

  it('derives the non-joint coupler point from rigid-body state', () => {
    const state = analyticFourBarAdapter
      .compile(canonicalFourBarModel)
      .createSession({ configuration: 'open' })
      .evaluate({
        coordinates: { 'driver-angle': quantity(90, 'deg') },
        rates: { 'driver-angle': quantity(1, 'rad/s') },
        accelerations: { 'driver-angle': quantity(0, 'rad/s^2') },
      });

    const coupler = state.bodies.coupler;
    if (coupler === undefined) throw new Error('Missing coupler body state');

    const expected = pointKinematics(coupler, { x: 0.04, y: 0.02 });
    expectVectorClose(
      vectorSignal(state, 'coupler-point-position'),
      expected.position,
      12,
    );
    if (expected.velocity === undefined || expected.acceleration === undefined) {
      throw new Error('Expected full coupler point kinematics');
    }
    expectVectorClose(
      vectorSignal(state, 'coupler-point-velocity'),
      expected.velocity,
      12,
    );
    expectVectorClose(
      vectorSignal(state, 'coupler-point-acceleration'),
      expected.acceleration,
      11,
    );

    const pointBFromCoupler = pointKinematics(coupler, { x: 0.08, y: 0 });
    const rocker = state.bodies.rocker;
    if (rocker === undefined) throw new Error('Missing rocker body state');
    const pointBFromRocker = pointKinematics(rocker, { x: 0.07, y: 0 });
    expectVectorClose(pointBFromCoupler.position, pointBFromRocker.position, 12);
    if (
      pointBFromCoupler.velocity === undefined ||
      pointBFromRocker.velocity === undefined ||
      pointBFromCoupler.acceleration === undefined ||
      pointBFromRocker.acceleration === undefined
    ) {
      throw new Error('Expected B joint derivative state');
    }
    expectVectorClose(pointBFromCoupler.velocity, pointBFromRocker.velocity, 11);
    expectVectorClose(
      pointBFromCoupler.acceleration,
      pointBFromRocker.acceleration,
      10,
    );
  });
});

describe('four-bar assembly branch/session behavior', () => {
  it('cold-starts distinct open and crossed assemblies at the same input', () => {
    const compiled = analyticFourBarAdapter.compile(canonicalFourBarModel);
    const open = compiled.createSession({ configuration: 'open' }).evaluate({
      coordinates: { 'driver-angle': quantity(90, 'deg') },
    });
    const crossed = compiled.createSession({ configuration: 'crossed' }).evaluate({
      coordinates: { 'driver-angle': quantity(90, 'deg') },
    });

    const openB = vectorSignal(open, 'point-b-position');
    const crossedB = vectorSignal(crossed, 'point-b-position');
    expect(textSignal(open, 'assembly-branch')).toBe('open');
    expect(textSignal(crossed, 'assembly-branch')).toBe('crossed');
    expect(openB.y).toBeGreaterThan(crossedB.y);
    expect(distance(openB, crossedB)).toBeGreaterThan(0.05);
  });

  it('keeps the open branch through two forward and reverse crank revolutions', () => {
    const session = analyticFourBarAdapter
      .compile(canonicalFourBarModel)
      .createSession({ configuration: 'open' });

    const initial = session.evaluate({
      coordinates: { 'driver-angle': quantity(0, 'deg') },
    });
    const initialB = vectorSignal(initial, 'point-b-position');
    let previousB = initialB;

    const angles: number[] = [];
    for (let angle = 5; angle <= 720; angle += 5) angles.push(angle);
    for (let angle = 715; angle >= 0; angle -= 5) angles.push(angle);

    for (const angle of angles) {
      const state = session.evaluate({
        coordinates: { 'driver-angle': quantity(angle, 'deg') },
      });
      expect(state.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
      expect(textSignal(state, 'assembly-branch')).toBe('open');

      const A = vectorSignal(state, 'point-a-position');
      const B = vectorSignal(state, 'point-b-position');
      const O4 = { x: 0.1, y: 0 };
      expect(cross(subtract(O4, A), subtract(B, A))).toBeGreaterThan(0);
      expect(distance(B, previousB)).toBeLessThan(0.015);
      previousB = B;
    }

    expectVectorClose(previousB, initialB, 11);
  });

  it('keeps concurrent open/crossed sessions independent', () => {
    const compiled = analyticFourBarAdapter.compile(canonicalFourBarModel);
    const openSession = compiled.createSession({ configuration: 'open' });
    const crossedSession = compiled.createSession({ configuration: 'crossed' });

    const open = openSession.evaluate({
      coordinates: { 'driver-angle': quantity(225, 'deg') },
    });
    const crossed = crossedSession.evaluate({
      coordinates: { 'driver-angle': quantity(225, 'deg') },
    });

    expect(open.modes.assembly).toBe('open');
    expect(crossed.modes.assembly).toBe('crossed');
    expect(openSession.snapshot().modes.branchSign).toBe(1);
    expect(crossedSession.snapshot().modes.branchSign).toBe(-1);
  });

  it('preserves branch under valid parameter changes and diagnoses impossible geometry', () => {
    const session = analyticFourBarAdapter
      .compile(canonicalFourBarModel)
      .createSession({ configuration: 'open' });

    const changed = session.evaluate({
      coordinates: { 'driver-angle': quantity(45, 'deg') },
      parameters: { 'coupler-length': quantity(85, 'mm') },
    });
    expect(changed.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    const changedA = vectorSignal(changed, 'point-a-position');
    const changedB = vectorSignal(changed, 'point-b-position');
    expect(cross(subtract({ x: 0.1, y: 0 }, changedA), subtract(changedB, changedA))).toBeGreaterThan(0);

    const invalid = session.evaluate({
      coordinates: { 'driver-angle': quantity(0, 'deg') },
      parameters: {
        'coupler-length': quantity(20, 'mm'),
        'rocker-length': quantity(20, 'mm'),
      },
    });
    expect(invalid.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(invalid.bodies.ground).toBeDefined();
    expect(invalid.bodies.crank).toBeDefined();
    expect(invalid.bodies.coupler).toBeUndefined();
    expect(invalid.bodies.rocker).toBeUndefined();
  });

  it('does not invent derivative state when rates are absent', () => {
    const state = analyticFourBarAdapter
      .compile(canonicalFourBarModel)
      .createSession({ configuration: 'open' })
      .evaluate({
        coordinates: { 'driver-angle': quantity(30, 'deg') },
      });

    expect(state.diagnostics).toEqual([]);
    expect(state.bodies.coupler?.angularVelocity).toBeUndefined();
    expect(state.bodies.coupler?.angularAcceleration).toBeUndefined();
    expect(state.signals['coupler-angular-velocity']).toBeUndefined();
    expect(state.signals['coupler-point-velocity']).toBeUndefined();
  });

  it('requires input rate before calculating acceleration', () => {
    const state = analyticFourBarAdapter
      .compile(canonicalFourBarModel)
      .createSession({ configuration: 'open' })
      .evaluate({
        coordinates: { 'driver-angle': quantity(30, 'deg') },
        accelerations: { 'driver-angle': quantity(0, 'rad/s^2') },
      });

    expect(state.diagnostics[0]?.code).toBe('invalid-input');
  });
});
