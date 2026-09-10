import { describe, expect, it } from 'vitest';

import {
  canonicalQuarterTurnBeltModel,
  spatialBeltAdapter,
} from '@atlasmechanica/kinematics';
import {
  hasErrors,
  quantity,
  type ParameterId,
  type QuantityValue,
} from '@atlasmechanica/model';

import {
  resolveBrown003SpatialRenderData,
  type Brown003SpatialRendererRuntimeContext,
} from './brown003Spatial.js';

function runtime(
  angleDeg: number,
  parameters: Partial<Record<ParameterId, QuantityValue>> = {},
): Brown003SpatialRendererRuntimeContext {
  const session = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel).createSession();
  const state = session.evaluate({
    parameters,
    coordinates: { 'driver-angle': quantity(angleDeg, 'deg') },
    rates: { 'driver-angle': quantity(30, 'rpm') },
  });
  if (hasErrors(state)) {
    throw new Error(state.diagnostics.map((item) => item.message).join('; '));
  }
  return {
    model: canonicalQuarterTurnBeltModel,
    state,
    parameters,
  };
}

function pulley(
  data: ReturnType<typeof resolveBrown003SpatialRenderData>,
  id: string,
) {
  const value = data.pulleys.find((candidate) => candidate.pulley === id);
  if (value === undefined) throw new Error(`Missing pulley ${id}`);
  return value;
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0)
    + (a[1] ?? 0) * (b[1] ?? 0)
    + (a[2] ?? 0) * (b[2] ?? 0);
}

describe('Brown 003 spatial Three.js render data', () => {
  it('preserves true XYZ route depth and all four finite pulley faces', () => {
    const data = resolveBrown003SpatialRenderData(runtime(0));

    expect(data.model).toBe(canonicalQuarterTurnBeltModel.id);
    expect(data.beltPoints).toHaveLength(385);
    expect(data.pulleys.map((item) => item.pulley)).toEqual([
      'driver',
      'guide-a',
      'driven',
      'guide-b',
    ]);
    expect(data.bounds.max[2] - data.bounds.min[2]).toBeGreaterThan(0.05);
    expect(data.pulleys.every((item) => item.faceWidth > 0)).toBe(true);
    expect(data.pulleys.every((item) => item.pitchRadius > 0)).toBe(true);
    expect(dot(pulley(data, 'driver').axis, pulley(data, 'driven').axis)).toBeCloseTo(0, 12);
  });

  it('updates pulley and belt-material phase without changing static route geometry', () => {
    const start = resolveBrown003SpatialRenderData(runtime(0));
    const quarterTurn = resolveBrown003SpatialRenderData(runtime(90));

    expect(quarterTurn.geometryKey).toBe(start.geometryKey);
    expect(pulley(quarterTurn, 'driver').phaseAngle - pulley(start, 'driver').phaseAngle)
      .toBeCloseTo(Math.PI / 2, 12);
    expect(pulley(quarterTurn, 'driven').phaseAngle - pulley(start, 'driven').phaseAngle)
      .toBeCloseTo(3 * Math.PI / 8, 12);
    expect(quarterTurn.materialArclength).not.toBeCloseTo(start.materialArclength, 8);
    expect(quarterTurn.materialPoint).not.toEqual(start.materialPoint);
  });

  it('uses the same resolved parameters for adapter state and spatial route', () => {
    const canonical = runtime(45);
    expect(() => resolveBrown003SpatialRenderData({
      ...canonical,
      parameters: { 'driven-radius': quantity(55, 'mm') },
    })).toThrow('Brown 003 spatial renderer runtime mismatch');

    const overridden = resolveBrown003SpatialRenderData(runtime(45, {
      'driven-radius': quantity(55, 'mm'),
    }));
    const baseline = resolveBrown003SpatialRenderData(canonical);
    expect(pulley(overridden, 'driven').pitchRadius).toBeCloseTo(0.055, 12);
    expect(overridden.geometryKey).not.toBe(baseline.geometryKey);
  });

  it('fails closed when the adapter state itself rejects the spatial route', () => {
    const state = spatialBeltAdapter
      .compile(canonicalQuarterTurnBeltModel)
      .createSession()
      .evaluate({
        parameters: { 'driver-radius': quantity(30, 'mm') },
        coordinates: { 'driver-angle': quantity(20, 'deg') },
      });

    expect(hasErrors(state)).toBe(true);
    expect(() => resolveBrown003SpatialRenderData({
      model: canonicalQuarterTurnBeltModel,
      state,
      parameters: { 'driver-radius': quantity(30, 'mm') },
    })).toThrow('requires a successful adapter state');
  });
});
