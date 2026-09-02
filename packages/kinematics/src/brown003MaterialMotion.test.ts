import { describe, expect, it } from 'vitest';

import { canonicalNumber, quantity } from '@atlasmechanica/model';
import {
  buildBrown003MaterialPath,
  resolveBrown003MaterialPhase,
  sampleBrown003MaterialMotion,
  sampleBrown003MaterialPath,
  type Brown003MaterialPath,
  type Brown003MaterialPathSegment,
} from './brown003MaterialMotion.js';
import { solveBrown003Route } from './brown003Route.js';
import { evaluateFixedAxisBeltContinuity } from './fixedAxisBeltContinuity.js';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';

type Vec3 = readonly [number, number, number];

function canonicalPath(): Brown003MaterialPath {
  const route = solveBrown003Route(canonicalQuarterTurnBeltModel);
  expect(route.diagnostics).toEqual([]);
  const result = buildBrown003MaterialPath(route);
  expect(result.diagnostics).toEqual([]);
  if (result.path === undefined) throw new Error('Missing Brown 003 material path');
  return result.path;
}

function magnitude(vector: readonly number[]): number {
  return Math.hypot(...vector);
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0)
    + (a[1] ?? 0) * (b[1] ?? 0)
    + (a[2] ?? 0) * (b[2] ?? 0);
}

function scale(vector: Vec3, scalar: number): Vec3 {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function expectVectorClose(actual: readonly number[], expected: readonly number[], digits = 9) {
  expect(actual).toHaveLength(3);
  expect(expected).toHaveLength(3);
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index] ?? Number.NaN, digits);
  }
}

function segmentEnd(segment: Brown003MaterialPathSegment): Vec3 {
  return segment.kind === 'span' ? segment.span.end : segment.track.departure;
}

describe('Brown 003 prescribed material motion', () => {
  it('builds one closed eight-segment route with a finite positive loop length', () => {
    const path = canonicalPath();
    expect(path.loop).toBe('main-belt');
    expect(path.totalLength).toBeGreaterThan(0);
    expect(Number.isFinite(path.totalLength)).toBe(true);
    expect(path.segments.map((segment) => segment.id)).toEqual([
      'track:driver',
      'driver-guide-a',
      'track:guide-a',
      'guide-a-driven',
      'track:driven',
      'driven-guide-b',
      'track:guide-b',
      'guide-b-driver',
    ]);
    expect(path.segments.every(
      (segment) => Number.isFinite(segment.length) && segment.length > 0,
    )).toBe(true);
  });

  it('preserves position and tangent continuity at every routed segment boundary', () => {
    const path = canonicalPath();

    for (let index = 0; index < path.segments.length; index += 1) {
      const current = path.segments[index];
      const previous = path.segments[(index - 1 + path.segments.length) % path.segments.length];
      if (current === undefined || previous === undefined) throw new Error('Missing material segment');

      const boundary = current.startArclength;
      const atBoundary = sampleBrown003MaterialPath(path, boundary);
      expectVectorClose(atBoundary.position, segmentEnd(previous), 8);

      const epsilon = Math.min(current.length, previous.length) * 1e-7;
      const beforeBoundary = sampleBrown003MaterialPath(path, boundary - epsilon);
      expect(dot(beforeBoundary.tangent, atBoundary.tangent)).toBeGreaterThan(0.99999);
    }
  });

  it('wraps signed arclength deterministically and rejects non-finite samples', () => {
    const path = canonicalPath();
    const offset = Math.min(0.01, path.totalLength / 20);

    expectVectorClose(
      sampleBrown003MaterialPath(path, -offset).position,
      sampleBrown003MaterialPath(path, path.totalLength - offset).position,
    );
    expectVectorClose(
      sampleBrown003MaterialPath(path, path.totalLength + offset).position,
      sampleBrown003MaterialPath(path, offset).position,
    );

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => sampleBrown003MaterialPath(path, value)).toThrow(
        'Brown 003 material arclength must be finite',
      );
    }
  });

  it('advances material phase from lumped belt travel and remains periodic by loop length', () => {
    const path = canonicalPath();
    const driverParameter = canonicalQuarterTurnBeltModel.parameters['driver-radius'];
    if (driverParameter === undefined) throw new Error('Missing driver radius');
    const driverRadius = canonicalNumber(driverParameter.default, 'length');
    const baseAngle = 0.75;

    const base = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      coordinates: { 'driver-angle': quantity(baseAngle, 'rad') },
    });
    const oneLoopLater = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      coordinates: {
        'driver-angle': quantity(baseAngle + path.totalLength / driverRadius, 'rad'),
      },
    });
    expect(base.diagnostics).toEqual([]);
    expect(oneLoopLater.diagnostics).toEqual([]);

    expect(resolveBrown003MaterialPhase(path, oneLoopLater)).toBeCloseTo(
      resolveBrown003MaterialPhase(path, base),
      9,
    );
    expect(resolveBrown003MaterialPhase(path, base, path.totalLength * 2 + 0.02)).toBeCloseTo(
      resolveBrown003MaterialPhase(path, base, 0.02),
      9,
    );
    expect(() => resolveBrown003MaterialPhase(path, base, Number.NaN)).toThrow(
      'Brown 003 material arclength must be finite',
    );
  });

  it('rejects continuity results resolved from pitch radii incompatible with the routed path', () => {
    const path = canonicalPath();
    const continuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      parameters: { 'driver-radius': quantity(30, 'mm') },
      coordinates: { 'driver-angle': quantity(0.5, 'rad') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
    expect(continuity.diagnostics).toEqual([]);

    expect(() => resolveBrown003MaterialPhase(path, continuity)).toThrow(
      'Brown 003 material path and continuity result use incompatible resolved pitch radii',
    );
    expect(() => sampleBrown003MaterialMotion(
      canonicalQuarterTurnBeltModel,
      path,
      continuity,
      0,
    )).toThrow(
      'Brown 003 material path and continuity result use incompatible resolved pitch radii',
    );
  });

  it('rejects uniformly scaled continuity radii even when every angular ratio is unchanged', () => {
    const path = canonicalPath();
    const continuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      parameters: {
        'driver-radius': quantity(22.5, 'mm'),
        'driven-radius': quantity(30, 'mm'),
        'guide-radius': quantity(10, 'mm'),
      },
      coordinates: { 'driver-angle': quantity(0.5, 'rad') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
    const baseline = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      coordinates: { 'driver-angle': quantity(0.5, 'rad') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
    expect(continuity.diagnostics).toEqual([]);
    expect(continuity.angularRatios).toEqual(baseline.angularRatios);
    expect(continuity.resolvedPitchRadii.driver).toBeCloseTo(0.0225, 12);
    expect(continuity.beltLinearSpeed).toBeCloseTo((baseline.beltLinearSpeed ?? Number.NaN) / 2, 12);

    expect(() => resolveBrown003MaterialPhase(path, continuity)).toThrow(
      'Brown 003 material path and continuity result use incompatible resolved pitch radii',
    );
    expect(() => sampleBrown003MaterialMotion(
      canonicalQuarterTurnBeltModel,
      path,
      continuity,
      0,
    )).toThrow(
      'Brown 003 material path and continuity result use incompatible resolved pitch radii',
    );
  });

  it('rejects continuity results carrying different loop provenance', () => {
    const path = canonicalPath();
    const continuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      coordinates: { 'driver-angle': quantity(0.5, 'rad') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
    expect(continuity.diagnostics).toEqual([]);
    const wrongLoop = { ...continuity, loop: 'other-loop' };

    expect(() => resolveBrown003MaterialPhase(path, wrongLoop)).toThrow(
      'Brown 003 material path and continuity result use different loops',
    );
    expect(() => sampleBrown003MaterialMotion(
      canonicalQuarterTurnBeltModel,
      path,
      wrongLoop,
      0,
    )).toThrow(
      'Brown 003 material path and continuity result use different loops',
    );
  });

  it('computes a finite relative slip vector wherever routed material and pulley surface velocities differ', () => {
    const path = canonicalPath();
    const continuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      rates: { 'driver-angle': quantity(2, 'rad/s') },
    });
    expect(continuity.diagnostics).toEqual([]);
    expect(continuity.beltLinearSpeed).toBeDefined();

    for (const segment of path.segments) {
      if (segment.kind !== 'pulley-track') continue;
      const sample = sampleBrown003MaterialMotion(
        canonicalQuarterTurnBeltModel,
        path,
        continuity,
        segment.startArclength + segment.length / 2,
      );
      expect(sample.pulleySurfaceVelocity).toBeDefined();
      expect(sample.relativeSlipVelocity).toBeDefined();
      expect(sample.relativeSlipSpeed).toBeDefined();
      expect(sample.materialVelocity.every(Number.isFinite)).toBe(true);
      expect(sample.pulleySurfaceVelocity?.every(Number.isFinite)).toBe(true);
      expect(sample.relativeSlipVelocity?.every(Number.isFinite)).toBe(true);
      expect(magnitude(sample.materialVelocity)).toBeCloseTo(
        Math.abs(continuity.beltLinearSpeed ?? Number.NaN),
        9,
      );
      if (segment.track.lateralSlipDistance > 0) {
        expect(sample.relativeSlipSpeed ?? 0).toBeGreaterThan(0);
      }
    }

    const driver = path.segments.find(
      (segment) => segment.kind === 'pulley-track' && segment.track.pulley === 'driver',
    );
    if (driver === undefined || driver.kind !== 'pulley-track') throw new Error('Missing driver track');
    const driverSample = sampleBrown003MaterialMotion(
      canonicalQuarterTurnBeltModel,
      path,
      continuity,
      driver.startArclength + driver.length / 2,
    );
    if (driverSample.relativeSlipVelocity === undefined) throw new Error('Missing driver slip');
    expect(Math.abs(dot(driverSample.relativeSlipVelocity, driver.track.axis))).toBeGreaterThan(1e-6);
  });

  it('keeps straight-span motion free of pulley contact claims', () => {
    const path = canonicalPath();
    const continuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
    const span = path.segments.find((segment) => segment.kind === 'span');
    if (span === undefined || span.kind !== 'span') throw new Error('Missing Brown 003 span');

    const sample = sampleBrown003MaterialMotion(
      canonicalQuarterTurnBeltModel,
      path,
      continuity,
      span.startArclength + span.length / 2,
    );
    expect(magnitude(sample.materialVelocity)).toBeGreaterThan(0);
    expect(sample.pulley).toBeUndefined();
    expect(sample.pulleySurfaceVelocity).toBeUndefined();
    expect(sample.relativeSlipVelocity).toBeUndefined();
    expect(sample.relativeSlipSpeed).toBeUndefined();
  });

  it('returns zero motion at zero rate and algebraically reverses the prescribed slip field', () => {
    const path = canonicalPath();
    const driver = path.segments.find(
      (segment) => segment.kind === 'pulley-track' && segment.track.pulley === 'driver',
    );
    if (driver === undefined || driver.kind !== 'pulley-track') throw new Error('Missing driver track');
    const arclength = driver.startArclength + driver.length / 2;

    const positive = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      rates: { 'driver-angle': quantity(2, 'rad/s') },
    });
    const zero = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      rates: { 'driver-angle': quantity(0, 'rad/s') },
    });
    const negative = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      rates: { 'driver-angle': quantity(-2, 'rad/s') },
    });

    const positiveSample = sampleBrown003MaterialMotion(
      canonicalQuarterTurnBeltModel,
      path,
      positive,
      arclength,
    );
    const zeroSample = sampleBrown003MaterialMotion(
      canonicalQuarterTurnBeltModel,
      path,
      zero,
      arclength,
    );
    const negativeSample = sampleBrown003MaterialMotion(
      canonicalQuarterTurnBeltModel,
      path,
      negative,
      arclength,
    );

    expect(magnitude(zeroSample.materialVelocity)).toBeCloseTo(0, 12);
    expect(magnitude(zeroSample.pulleySurfaceVelocity ?? [Number.NaN])).toBeCloseTo(0, 12);
    expect(magnitude(zeroSample.relativeSlipVelocity ?? [Number.NaN])).toBeCloseTo(0, 12);

    expectVectorClose(negativeSample.materialVelocity, scale(positiveSample.materialVelocity, -1));
    if (
      positiveSample.pulleySurfaceVelocity === undefined
      || positiveSample.relativeSlipVelocity === undefined
      || negativeSample.pulleySurfaceVelocity === undefined
      || negativeSample.relativeSlipVelocity === undefined
    ) {
      throw new Error('Missing pulley motion sample');
    }
    expectVectorClose(
      negativeSample.pulleySurfaceVelocity,
      scale(positiveSample.pulleySurfaceVelocity, -1),
    );
    expectVectorClose(
      negativeSample.relativeSlipVelocity,
      scale(positiveSample.relativeSlipVelocity, -1),
    );
  });
});
