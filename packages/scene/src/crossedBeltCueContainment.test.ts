import { describe, expect, it } from 'vitest';
import { analyticBeltAdapter, crossedBeltDriveModel } from '@atlasmechanica/kinematics';
import { quantity } from '@atlasmechanica/model';
import { buildMechanismScene } from './buildMechanismScene.js';
import { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';
import type { PolylinePrimitive, SegmentPrimitive, Vec2 } from './types.js';

interface Span {
  a: Vec2;
  b: Vec2;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(segment: SegmentPrimitive): Vec2 {
  return {
    x: (segment.a.x + segment.b.x) / 2,
    y: (segment.a.y + segment.b.y) / 2,
  };
}

function projectionParameter(point: Vec2, span: Span): number {
  const dx = span.b.x - span.a.x;
  const dy = span.b.y - span.a.y;
  const denominator = dx * dx + dy * dy;
  if (!(denominator > 0)) throw new TypeError('Degenerate tangent span');
  return ((point.x - span.a.x) * dx + (point.y - span.a.y) * dy) / denominator;
}

function lineDistance(point: Vec2, span: Span): number {
  const dx = span.b.x - span.a.x;
  const dy = span.b.y - span.a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return Number.POSITIVE_INFINITY;
  return Math.abs((point.x - span.a.x) * dy - (point.y - span.a.y) * dx) / length;
}

function tangentContainingCue(belt: PolylinePrimitive, cue: SegmentPrimitive): Span {
  for (let index = 0; index < belt.points.length - 1; index += 1) {
    const a = belt.points[index];
    const b = belt.points[index + 1];
    if (a === undefined || b === undefined || distance(a, b) <= 1e-12) continue;
    const span = { a, b };
    if (lineDistance(cue.a, span) > 1e-9 || lineDistance(cue.b, span) > 1e-9) continue;
    const ta = projectionParameter(cue.a, span);
    const tb = projectionParameter(cue.b, span);
    if (ta > -1e-9 && ta < 1 + 1e-9 && tb > -1e-9 && tb < 1 + 1e-9) return span;
  }
  throw new TypeError(`Could not find rope tangent containing ${cue.id}`);
}

function nearLimitCrossedScene() {
  const parameters = {
    'driver-radius': quantity(30, 'mm'),
    'driven-radius': quantity(60, 'mm'),
    'center-distance': quantity(90.5, 'mm'),
  };
  const state = analyticBeltAdapter
    .compile(crossedBeltDriveModel)
    .createSession()
    .evaluate({
      coordinates: { 'driver-angle': quantity(30, 'deg') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
      parameters,
    });
  return enrichMechanicalIllustration(buildMechanismScene({
    model: crossedBeltDriveModel,
    state,
    parameters,
  }));
}

function requiredSegment(scene: ReturnType<typeof nearLimitCrossedScene>, id: string): SegmentPrimitive {
  const primitive = scene.primitives.find((candidate) => candidate.id === id);
  if (primitive?.type !== 'segment') throw new TypeError(`Missing ${id}`);
  return primitive;
}

describe('crossed rope cue containment', () => {
  it('clamps near-limit cues to the nearest pulley contact, not just total tangent length', () => {
    const scene = nearLimitCrossedScene();
    const belt = scene.primitives.find(
      (primitive): primitive is PolylinePrimitive =>
        primitive.id === 'belt-path' && primitive.type === 'polyline',
    );
    if (belt === undefined) throw new TypeError('Missing crossed rope path');

    const gap = requiredSegment(scene, 'belt-crossing-gap');
    const bridgeOutline = requiredSegment(scene, 'belt-crossing-bridge-outline');
    const bridge = requiredSegment(scene, 'belt-crossing-bridge');

    for (const cue of [gap, bridgeOutline, bridge]) {
      const tangent = tangentContainingCue(belt, cue);
      const crossing = midpoint(cue);
      const nearestContact = Math.min(
        distance(crossing, tangent.a),
        distance(crossing, tangent.b),
      );
      const halfLength = distance(crossing, cue.a);

      expect(halfLength).toBeLessThanOrEqual(nearestContact * 0.400001);
      for (const endpoint of [cue.a, cue.b]) {
        const t = projectionParameter(endpoint, tangent);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThan(1);
      }
    }
  });
});
