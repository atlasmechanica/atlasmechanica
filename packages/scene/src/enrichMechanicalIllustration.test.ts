import { describe, expect, it } from 'vitest';
import { quantity } from '@atlasmechanica/model';
import {
  analyticBeltAdapter,
  crossedBeltDriveModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import { buildMechanismScene } from './buildMechanismScene.js';
import { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';
import type { MechanismScene, SegmentPrimitive, Vec2 } from './types.js';

function illustrated(
  model: typeof openBeltDriveModel | typeof crossedBeltDriveModel,
  angleDegrees = 30,
) {
  const state = analyticBeltAdapter
    .compile(model)
    .createSession()
    .evaluate({
      coordinates: { 'driver-angle': quantity(angleDegrees, 'deg') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
      parameters: { 'center-distance': quantity(180, 'mm') },
    });

  return enrichMechanicalIllustration(buildMechanismScene({
    model,
    state,
    parameters: { 'center-distance': quantity(180, 'mm') },
  }));
}

function segment(scene: MechanismScene, id: string): SegmentPrimitive {
  const primitive = scene.primitives.find((candidate) => candidate.id === id);
  if (primitive?.type !== 'segment') throw new TypeError(`Missing segment ${id}`);
  return primitive;
}

function midpoint(segment: SegmentPrimitive): Vec2 {
  return {
    x: (segment.a.x + segment.b.x) / 2,
    y: (segment.a.y + segment.b.y) / 2,
  };
}

describe('mechanical illustration enrichment', () => {
  it('keeps stable primary IDs while adding belt and pulley detail', () => {
    const scene = illustrated(openBeltDriveModel);
    const ids = new Set(scene.primitives.map((primitive) => primitive.id));

    expect(ids.has('belt-path')).toBe(true);
    expect(ids.has('belt-driver')).toBe(true);
    expect(ids.has('belt-driven')).toBe(true);
    expect(ids.has('belt-band-underlay')).toBe(true);
    expect(ids.has('belt-driver-hub')).toBe(true);
    expect(ids.has('belt-driven-hub')).toBe(true);
    expect([...ids].filter((id) => id.startsWith('belt-driver-spoke-'))).toHaveLength(4);
    expect([...ids].filter((id) => id.startsWith('belt-driven-spoke-'))).toHaveLength(4);
    expect(ids.has('belt-driver-mark')).toBe(false);
    expect(ids.has('belt-driven-mark')).toBe(false);
  });

  it('rotates spokes from the solver-owned pulley phase', () => {
    const scene = illustrated(crossedBeltDriveModel);
    const spoke = scene.primitives.find((primitive) => primitive.id === 'belt-driver-spoke-0');
    expect(spoke).toMatchObject({ type: 'segment' });
    if (spoke?.type !== 'segment') throw new TypeError('Missing illustrated spoke');

    const angle = Math.atan2(spoke.b.y - spoke.a.y, spoke.b.x - spoke.a.x);
    expect(angle).toBeCloseTo(Math.PI / 6, 10);
  });

  it.each([
    ['open', openBeltDriveModel],
    ['crossed', crossedBeltDriveModel],
  ] as const)('moves %s belt texture with positive driver tangential velocity', (_name, model) => {
    const atZero = illustrated(model, 0);
    const afterPositiveRotation = illustrated(model, 2);

    const driver = atZero.primitives.find((primitive) => primitive.id === 'belt-driver');
    const belt = atZero.primitives.find((primitive) => primitive.id === 'belt-path');
    if (driver?.type !== 'circle' || belt?.type !== 'polyline') {
      throw new TypeError('Missing driver or belt path');
    }

    const contact = belt.points[0];
    if (contact === undefined) throw new TypeError('Missing driver contact point');

    const before = midpoint(segment(atZero, 'belt-surface-mark-0'));
    const after = midpoint(segment(afterPositiveRotation, 'belt-surface-mark-0'));
    const displacement = { x: after.x - before.x, y: after.y - before.y };
    const radial = { x: contact.x - driver.center.x, y: contact.y - driver.center.y };
    const positiveTangentialVelocity = { x: -radial.y, y: radial.x };
    const alignment =
      displacement.x * positiveTangentialVelocity.x +
      displacement.y * positiveTangentialVelocity.y;

    expect(alignment).toBeGreaterThan(0);
  });

  it('is deterministic and does not change the physical scene identity', () => {
    const first = illustrated(openBeltDriveModel);
    const second = illustrated(openBeltDriveModel);
    expect(first).toEqual(second);
    expect(first.id).toBe('belt-same');
  });
});
