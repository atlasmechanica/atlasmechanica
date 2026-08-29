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

interface IllustrationOptions {
  angleDegrees?: number;
  driverRadiusMm?: number;
  drivenRadiusMm?: number;
  centerMm?: number;
}

function illustrated(
  model: typeof openBeltDriveModel | typeof crossedBeltDriveModel,
  options: IllustrationOptions = {},
) {
  const angleDegrees = options.angleDegrees ?? 30;
  const driverRadiusMm = options.driverRadiusMm ?? 30;
  const drivenRadiusMm = options.drivenRadiusMm ?? 60;
  const centerMm = options.centerMm ?? 180;
  const parameters = {
    'driver-radius': quantity(driverRadiusMm, 'mm'),
    'driven-radius': quantity(drivenRadiusMm, 'mm'),
    'center-distance': quantity(centerMm, 'mm'),
  };

  const state = analyticBeltAdapter
    .compile(model)
    .createSession()
    .evaluate({
      coordinates: { 'driver-angle': quantity(angleDegrees, 'deg') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
      parameters,
    });

  return enrichMechanicalIllustration(buildMechanismScene({
    model,
    state,
    parameters,
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

function pointDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function surfaceMarkMidpoints(scene: MechanismScene): Vec2[] {
  return scene.primitives
    .filter(
      (primitive): primitive is SegmentPrimitive =>
        primitive.type === 'segment' && primitive.id.startsWith('belt-surface-mark-'),
    )
    .map(midpoint);
}

function nearest(points: Vec2[], target: Vec2): Vec2 {
  const result = points.reduce<{ point: Vec2; distance: number } | undefined>((best, point) => {
    const distance = pointDistance(point, target);
    if (best === undefined || distance < best.distance) return { point, distance };
    return best;
  }, undefined);
  if (result === undefined) throw new TypeError('Missing belt surface marks');
  return result.point;
}

describe('mechanical illustration enrichment', () => {
  it('keeps stable primary IDs while adding Brown-style rope and pulley detail', () => {
    const scene = illustrated(openBeltDriveModel);
    const ids = new Set(scene.primitives.map((primitive) => primitive.id));

    expect(ids.has('belt-path')).toBe(true);
    expect(ids.has('belt-driver')).toBe(true);
    expect(ids.has('belt-driven')).toBe(true);
    expect(ids.has('belt-band-underlay')).toBe(true);
    expect(ids.has('belt-driver-hub')).toBe(true);
    expect(ids.has('belt-driven-hub')).toBe(true);
    expect([...ids].filter((id) => /^belt-driver-spoke-\d+$/.test(id))).toHaveLength(4);
    expect([...ids].filter((id) => /^belt-driver-spoke-core-\d+$/.test(id))).toHaveLength(4);
    expect([...ids].filter((id) => /^belt-driven-spoke-\d+$/.test(id))).toHaveLength(4);
    expect([...ids].filter((id) => /^belt-driven-spoke-core-\d+$/.test(id))).toHaveLength(4);
    expect([...ids].filter((id) => id.startsWith('belt-surface-mark-'))).toHaveLength(42);
    expect(ids.has('belt-driver-mark')).toBe(false);
    expect(ids.has('belt-driven-mark')).toBe(false);
  });

  it('matches the equal-pulley Brown 001 reference with identical hub/spoke grammar', () => {
    const scene = illustrated(openBeltDriveModel, {
      driverRadiusMm: 45,
      drivenRadiusMm: 45,
    });
    const driver = scene.primitives.find((primitive) => primitive.id === 'belt-driver');
    const driven = scene.primitives.find((primitive) => primitive.id === 'belt-driven');
    const inner = scene.primitives.find((primitive) => primitive.id === 'belt-driver-rim-inner');
    const driverHub = scene.primitives.find((primitive) => primitive.id === 'belt-driver-hub');
    const drivenHub = scene.primitives.find((primitive) => primitive.id === 'belt-driven-hub');
    const spoke = scene.primitives.find((primitive) => primitive.id === 'belt-driver-spoke-0');
    const spokeCore = scene.primitives.find((primitive) => primitive.id === 'belt-driver-spoke-core-0');

    if (
      driver?.type !== 'circle' ||
      driven?.type !== 'circle' ||
      inner?.type !== 'circle' ||
      driverHub?.type !== 'circle' ||
      drivenHub?.type !== 'circle' ||
      spoke?.type !== 'segment' ||
      spokeCore?.type !== 'segment'
    ) {
      throw new TypeError('Missing illustrated pulley primitives');
    }

    expect(driver.radius).toBeCloseTo(driven.radius, 12);
    expect(driver.width).toBe(4.4);
    expect(driver.styles).toEqual(['pulley']);
    expect(inner.radius / driver.radius).toBeCloseTo(0.79, 10);
    expect(inner.styles).toEqual(['pulley']);
    expect(driverHub.radius).toBeCloseTo(drivenHub.radius, 12);
    expect(driverHub.radius / driver.radius).toBeCloseTo(0.014 / 0.045, 10);
    expect(driverHub.styles).toEqual(['pulley']);
    expect(spoke.width).toBe(6.4);
    expect(spoke.styles).toEqual(['pulley']);
    expect(spokeCore.width).toBe(3.0);
    expect(spokeCore.styles).toEqual(['cutout']);
  });

  it('caps the shared hub inside very small supported pulleys', () => {
    const scene = illustrated(openBeltDriveModel, {
      driverRadiusMm: 7,
      drivenRadiusMm: 7,
      centerMm: 30,
    });
    const pulley = scene.primitives.find((primitive) => primitive.id === 'belt-driver');
    const hub = scene.primitives.find((primitive) => primitive.id === 'belt-driver-hub');
    if (pulley?.type !== 'circle' || hub?.type !== 'circle') {
      throw new TypeError('Missing small pulley illustration');
    }

    expect(hub.radius).toBeLessThan(pulley.radius);
  });

  it('renders rope as dark edges, a light core, and moving dark lay marks', () => {
    const scene = illustrated(openBeltDriveModel, {
      driverRadiusMm: 45,
      drivenRadiusMm: 45,
    });
    const edge = scene.primitives.find((primitive) => primitive.id === 'belt-band-underlay');
    const core = scene.primitives.find((primitive) => primitive.id === 'belt-path');
    const mark = scene.primitives.find((primitive) => primitive.id === 'belt-surface-mark-0');
    if (edge?.type !== 'polyline' || core?.type !== 'polyline' || mark?.type !== 'segment') {
      throw new TypeError('Missing rope illustration primitives');
    }

    expect(edge.styles).toEqual(['belt']);
    expect(edge.width).toBe(7.0);
    expect(core.styles).toEqual(['cutout']);
    expect(core.width).toBe(4.0);
    expect(mark.styles).toEqual(['belt']);
  });

  it('keeps interaction affordances invisible at rest and removes duplicate in-plate readouts', () => {
    const scene = illustrated(openBeltDriveModel, {
      driverRadiusMm: 45,
      drivenRadiusMm: 45,
    });
    const inputHandle = scene.primitives.find((primitive) => primitive.id === 'belt-input-handle');
    const distanceHandle = scene.primitives.find((primitive) => primitive.id === 'belt-distance-handle');
    const ids = new Set(scene.primitives.map((primitive) => primitive.id));

    expect(inputHandle?.styles).toEqual(['cutout']);
    expect(distanceHandle?.styles).toEqual(['cutout']);
    expect(ids.has('belt-distance')).toBe(false);
    expect(ids.has('belt-ratio-label')).toBe(false);
  });

  it('rotates spokes from the solver-owned pulley phase', () => {
    const scene = illustrated(crossedBeltDriveModel);
    const spoke = scene.primitives.find((primitive) => primitive.id === 'belt-driver-spoke-0');
    expect(spoke).toMatchObject({ type: 'segment' });
    if (spoke?.type !== 'segment') throw new TypeError('Missing illustrated spoke');

    const angle = Math.atan2(spoke.b.y - spoke.a.y, spoke.b.x - spoke.a.x);
    expect(angle).toBeCloseTo(Math.PI / 6, 10);
  });

  it('uses an explicit over-under convention only for crossed routing', () => {
    const open = illustrated(openBeltDriveModel);
    const crossed = illustrated(crossedBeltDriveModel);
    const openIds = new Set(open.primitives.map((primitive) => primitive.id));
    const crossedIds = new Set(crossed.primitives.map((primitive) => primitive.id));

    expect(openIds.has('belt-crossing-gap')).toBe(false);
    expect(openIds.has('belt-crossing-bridge')).toBe(false);
    expect(crossedIds.has('belt-crossing-gap')).toBe(true);
    expect(crossedIds.has('belt-crossing-bridge-outline')).toBe(true);
    expect(crossedIds.has('belt-crossing-bridge')).toBe(true);
  });

  it('keeps the crossed over-under cue inside near-limit tangent spans', () => {
    const crossed = illustrated(crossedBeltDriveModel, { centerMm: 90.5 });
    const gap = segment(crossed, 'belt-crossing-gap');
    const bridgeOutline = segment(crossed, 'belt-crossing-bridge-outline');
    const bridge = segment(crossed, 'belt-crossing-bridge');

    expect(pointDistance(gap.a, gap.b)).toBeLessThan(0.0095);
    expect(pointDistance(bridgeOutline.a, bridgeOutline.b)).toBeLessThan(0.0095);
    expect(pointDistance(bridge.a, bridge.b)).toBeLessThan(0.0095);
  });

  it('keeps a surface-mark identity continuous through the zero-angle boundary', () => {
    const before = midpoint(segment(illustrated(openBeltDriveModel, { angleDegrees: -1 }), 'belt-surface-mark-0'));
    const after = midpoint(segment(illustrated(openBeltDriveModel, { angleDegrees: 1 }), 'belt-surface-mark-0'));
    expect(pointDistance(before, after)).toBeLessThan(0.003);
  });

  it.each([
    ['open', openBeltDriveModel],
    ['crossed', crossedBeltDriveModel],
  ] as const)('moves %s rope texture with positive driver tangential velocity', (_name, model) => {
    const atZero = illustrated(model, { angleDegrees: 0 });
    const afterPositiveRotation = illustrated(model, { angleDegrees: 2 });

    const driver = atZero.primitives.find((primitive) => primitive.id === 'belt-driver');
    const belt = atZero.primitives.find((primitive) => primitive.id === 'belt-path');
    if (driver?.type !== 'circle' || belt?.type !== 'polyline') {
      throw new TypeError('Missing driver or belt path');
    }

    const contact = belt.points[0];
    if (contact === undefined) throw new TypeError('Missing driver contact point');

    const before = nearest(surfaceMarkMidpoints(atZero), contact);
    const after = nearest(surfaceMarkMidpoints(afterPositiveRotation), contact);
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
