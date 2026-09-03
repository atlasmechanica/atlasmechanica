import { describe, expect, it } from 'vitest';

import {
  canonicalQuarterTurnBeltModel,
  spatialBeltAdapter,
} from '@atlasmechanica/kinematics';
import { quantity } from '@atlasmechanica/model';
import { brown003SpatialSceneCompiler } from './compilers.js';

function canonicalState(angle = 0) {
  return spatialBeltAdapter
    .compile(canonicalQuarterTurnBeltModel)
    .createSession()
    .evaluate({
      coordinates: { 'driver-angle': quantity(angle, 'rad') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
}

function primitive(scene: ReturnType<typeof brown003SpatialSceneCompiler.build>, id: string) {
  const value = scene.primitives.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error(`Missing scene primitive ${id}`);
  return value;
}

describe('Brown 003 spatial reference projection', () => {
  it('projects the solved four-pulley route without collapsing it into the planar belt compiler', () => {
    const state = canonicalState(Math.PI / 3);
    const scene = brown003SpatialSceneCompiler.build({
      model: canonicalQuarterTurnBeltModel,
      state,
    });

    expect(scene.id).toBe('brown003-spatial-projection');
    expect(scene.title).toContain('spatial reference projection');
    expect(scene.viewport.maxX).toBeGreaterThan(scene.viewport.minX);
    expect(scene.viewport.maxY).toBeGreaterThan(scene.viewport.minY);

    const belt = primitive(scene, 'brown003-belt-path');
    expect(belt.type).toBe('polyline');
    if (belt.type !== 'polyline') throw new Error('Expected projected belt polyline');
    expect(belt.points.length).toBe(257);
    expect(belt.points[0]?.x).toBeCloseTo(belt.points.at(-1)?.x ?? Number.NaN, 10);
    expect(belt.points[0]?.y).toBeCloseTo(belt.points.at(-1)?.y ?? Number.NaN, 10);

    for (const pulley of ['driver', 'guide-a', 'driven', 'guide-b']) {
      const rim = primitive(scene, `brown003-pulley-${pulley}`);
      const phase = primitive(scene, `brown003-phase-${pulley}`);
      expect(rim.type).toBe('polyline');
      expect(phase.type).toBe('segment');
    }
    expect(primitive(scene, 'brown003-material-marker').type).toBe('circle');
  });

  it('takes pulley presentation phase from adapter coordinate state', () => {
    const zero = brown003SpatialSceneCompiler.build({
      model: canonicalQuarterTurnBeltModel,
      state: canonicalState(0),
    });
    const quarter = brown003SpatialSceneCompiler.build({
      model: canonicalQuarterTurnBeltModel,
      state: canonicalState(Math.PI / 2),
    });

    const zeroPhase = primitive(zero, 'brown003-phase-driver');
    const quarterPhase = primitive(quarter, 'brown003-phase-driver');
    if (zeroPhase.type !== 'segment' || quarterPhase.type !== 'segment') {
      throw new Error('Expected driver phase segments');
    }
    expect(quarterPhase.a.x).toBeCloseTo(zeroPhase.a.x, 12);
    expect(quarterPhase.a.y).toBeCloseTo(zeroPhase.a.y, 12);
    expect(Math.hypot(
      quarterPhase.b.x - zeroPhase.b.x,
      quarterPhase.b.y - zeroPhase.b.y,
    )).toBeGreaterThan(0.01);
  });

  it('uses the same parameter overrides for adapter state and projected route geometry', () => {
    const parameters = { 'driven-radius': quantity(50, 'mm') };
    const state = spatialBeltAdapter
      .compile(canonicalQuarterTurnBeltModel)
      .createSession()
      .evaluate({
        parameters,
        coordinates: { 'driver-angle': quantity(0.5, 'rad') },
      });
    expect(state.diagnostics).toEqual([]);

    const scene = brown003SpatialSceneCompiler.build({
      model: canonicalQuarterTurnBeltModel,
      state,
      parameters,
    });
    const rim = primitive(scene, 'brown003-pulley-driven');
    const phase = primitive(scene, 'brown003-phase-driven');
    if (rim.type !== 'polyline' || phase.type !== 'segment') {
      throw new Error('Expected driven projected rim and phase');
    }
    const projectedRadius = Math.max(...rim.points.map((point) => Math.hypot(
      point.x - phase.a.x,
      point.y - phase.a.y,
    )));
    expect(projectedRadius).toBeCloseTo(0.05, 10);
  });

  it('fails closed instead of rendering an adapter state whose Brown route is invalid', () => {
    const parameters = { 'driver-radius': quantity(30, 'mm') };
    const state = spatialBeltAdapter
      .compile(canonicalQuarterTurnBeltModel)
      .createSession()
      .evaluate({
        parameters,
        coordinates: { 'driver-angle': quantity(1, 'rad') },
      });
    expect(state.diagnostics[0]?.code).toBe('invalid-geometry');

    expect(() => brown003SpatialSceneCompiler.build({
      model: canonicalQuarterTurnBeltModel,
      state,
      parameters,
    })).toThrow('requires a successful adapter state');
  });
});
