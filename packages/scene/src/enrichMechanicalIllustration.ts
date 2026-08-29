import type {
  CirclePrimitive,
  HandlePrimitive,
  MechanismScene,
  PolylinePrimitive,
  ScenePrimitive,
  SegmentPrimitive,
  Vec2,
} from './types.js';

function circle(scene: MechanismScene, id: string): CirclePrimitive | undefined {
  const primitive = scene.primitives.find((candidate) => candidate.id === id);
  return primitive?.type === 'circle' ? primitive : undefined;
}

function segment(scene: MechanismScene, id: string): SegmentPrimitive | undefined {
  const primitive = scene.primitives.find((candidate) => candidate.id === id);
  return primitive?.type === 'segment' ? primitive : undefined;
}

function polyline(scene: MechanismScene, id: string): PolylinePrimitive | undefined {
  const primitive = scene.primitives.find((candidate) => candidate.id === id);
  return primitive?.type === 'polyline' ? primitive : undefined;
}

function spokeEndpoint(center: Vec2, radius: number, angle: number): Vec2 {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

interface SharedPulleyDetails {
  hubRadius: number;
}

function sharedPulleyDetails(driver: CirclePrimitive, driven: CirclePrimitive): SharedPulleyDetails {
  const smallerPulleyRadius = Math.min(driver.radius, driven.radius);
  return {
    // Brown 001/002 use the same classic hub size on both pulleys. Keep that
    // absolute visual relationship while still capping it safely for supported
    // small-radius model overrides.
    hubRadius: Math.min(0.014, smallerPulleyRadius * 0.32),
  };
}

function pulleyIllustration(
  pulley: CirclePrimitive,
  phaseMark: SegmentPrimitive,
  prefix: string,
  details: SharedPulleyDetails,
): ScenePrimitive[] {
  const angle = Math.atan2(
    phaseMark.b.y - pulley.center.y,
    phaseMark.b.x - pulley.center.x,
  );
  const spokeRadius = pulley.radius * 0.79;

  const spokes = Array.from({ length: 4 }, (_, index): ScenePrimitive[] => {
    const endpoint = spokeEndpoint(pulley.center, spokeRadius, angle + index * Math.PI / 2);
    return [
      {
        type: 'segment',
        id: `${prefix}-spoke-${index}`,
        layer: 'mechanism',
        styles: ['pulley'],
        a: pulley.center,
        b: endpoint,
        width: 6.4,
        ariaLabel: `${pulley.ariaLabel ?? prefix} spoke outline`,
      },
      {
        type: 'segment',
        id: `${prefix}-spoke-core-${index}`,
        layer: 'mechanism',
        styles: ['cutout'],
        a: pulley.center,
        b: endpoint,
        width: 3.0,
        ariaLabel: `${pulley.ariaLabel ?? prefix} spoke interior`,
      },
    ];
  }).flat();

  return [
    {
      ...pulley,
      styles: ['pulley'],
      // Brown's wheel is line-drawn rather than a solid heavy ring: two dark
      // contours with clear white material between them.
      width: 4.4,
    },
    ...spokes,
    {
      type: 'circle',
      id: `${prefix}-rim-inner`,
      layer: 'mechanism',
      styles: ['pulley'],
      center: pulley.center,
      radius: pulley.radius * 0.79,
      width: 3.0,
      ariaLabel: `${pulley.ariaLabel ?? prefix} inner rim`,
    },
    {
      type: 'circle',
      id: `${prefix}-hub`,
      layer: 'mechanism',
      styles: ['pulley'],
      center: pulley.center,
      radius: details.hubRadius,
      width: 3.4,
      selectId: pulley.selectId,
      ariaLabel: `${pulley.ariaLabel ?? prefix} hub`,
    },
  ];
}

interface PathSample {
  point: Vec2;
  tangent: Vec2;
}

interface StraightSpan {
  a: Vec2;
  b: Vec2;
  length: number;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function sampleClosedPolyline(points: Vec2[], targetDistance: number): PathSample | undefined {
  if (points.length < 2) return undefined;

  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined || b === undefined) continue;
    const length = distance(a, b);
    lengths.push(length);
    total += length;
  }
  if (!(total > 0)) return undefined;

  let remaining = ((targetDistance % total) + total) % total;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    if (remaining <= length || index === lengths.length - 1) {
      const a = points[index];
      const b = points[index + 1];
      if (a === undefined || b === undefined || !(length > 0)) return undefined;
      const t = Math.min(1, remaining / length);
      return {
        point: {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        },
        tangent: {
          x: (b.x - a.x) / length,
          y: (b.y - a.y) / length,
        },
      };
    }
    remaining -= length;
  }
  return undefined;
}

function beltPathPhaseSign(
  belt: PolylinePrimitive,
  driver: CirclePrimitive,
): 1 | -1 {
  const contact = belt.points[0];
  const next = belt.points[1];
  if (contact === undefined || next === undefined) return 1;

  const segmentLength = distance(contact, next);
  if (!(segmentLength > 0)) return 1;

  const pathTangent = {
    x: (next.x - contact.x) / segmentLength,
    y: (next.y - contact.y) / segmentLength,
  };
  const radial = {
    x: contact.x - driver.center.x,
    y: contact.y - driver.center.y,
  };

  const positiveRotationVelocity = { x: -radial.y, y: radial.x };
  const alignment =
    positiveRotationVelocity.x * pathTangent.x +
    positiveRotationVelocity.y * pathTangent.y;

  return alignment >= 0 ? 1 : -1;
}

function beltSurfaceMarks(
  belt: PolylinePrimitive,
  driver: CirclePrimitive,
  driverMark: SegmentPrimitive,
): SegmentPrimitive[] {
  const angle = Math.atan2(
    driverMark.b.y - driver.center.y,
    driverMark.b.x - driver.center.x,
  );
  const pathLength = belt.points.slice(0, -1).reduce((sum, point, index) => {
    const next = belt.points[index + 1];
    return next === undefined ? sum : sum + distance(point, next);
  }, 0);
  if (!(pathLength > 0)) return [];

  // Brown's cord is read as rope because closely spaced diagonal lay marks sit
  // inside a light cord body bounded by dark edges. The marks advance from the
  // same solver-owned pulley phase used by the spokes.
  const count = 42;
  const spacing = pathLength / count;
  const phaseDirection = beltPathPhaseSign(belt, driver);
  const phase = phaseDirection * angle * driver.radius;
  const halfMark = 0.0016;
  const diagonalAlongPath = 0.48;
  const diagonalAcrossPath = Math.sqrt(1 - diagonalAlongPath * diagonalAlongPath);

  return Array.from({ length: count }, (_, index): SegmentPrimitive | undefined => {
    const sample = sampleClosedPolyline(belt.points, phase + index * spacing);
    if (sample === undefined) return undefined;
    const normal = { x: -sample.tangent.y, y: sample.tangent.x };
    const slash = {
      x: sample.tangent.x * diagonalAlongPath + normal.x * diagonalAcrossPath,
      y: sample.tangent.y * diagonalAlongPath + normal.y * diagonalAcrossPath,
    };
    return {
      type: 'segment',
      id: `belt-surface-mark-${index}`,
      layer: 'mechanism',
      styles: ['belt'],
      a: {
        x: sample.point.x - slash.x * halfMark,
        y: sample.point.y - slash.y * halfMark,
      },
      b: {
        x: sample.point.x + slash.x * halfMark,
        y: sample.point.y + slash.y * halfMark,
      },
      width: 1.1,
      ariaLabel: 'Moving rope lay mark',
    };
  }).filter((mark): mark is SegmentPrimitive => mark !== undefined);
}

function liesOnPulley(point: Vec2, pulley: CirclePrimitive): boolean {
  const tolerance = Math.max(1e-7, pulley.radius * 1e-5);
  return Math.abs(distance(point, pulley.center) - pulley.radius) <= tolerance;
}

function tangentSpans(
  belt: PolylinePrimitive,
  driver: CirclePrimitive,
  driven: CirclePrimitive,
): StraightSpan[] {
  return belt.points.slice(0, -1)
    .map((a, index): StraightSpan | undefined => {
      const b = belt.points[index + 1];
      if (b === undefined) return undefined;
      const joinsDifferentPulleys =
        (liesOnPulley(a, driver) && liesOnPulley(b, driven)) ||
        (liesOnPulley(a, driven) && liesOnPulley(b, driver));
      if (!joinsDifferentPulleys) return undefined;
      return { a, b, length: distance(a, b) };
    })
    .filter((span): span is StraightSpan => span !== undefined);
}

function segmentIntersection(first: StraightSpan, second: StraightSpan): Vec2 | undefined {
  const rx = first.b.x - first.a.x;
  const ry = first.b.y - first.a.y;
  const sx = second.b.x - second.a.x;
  const sy = second.b.y - second.a.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return undefined;

  const qpx = second.a.x - first.a.x;
  const qpy = second.a.y - first.a.y;
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;
  if (!(t > 0.05 && t < 0.95 && u > 0.05 && u < 0.95)) return undefined;

  return { x: first.a.x + t * rx, y: first.a.y + t * ry };
}

function centeredSpan(span: StraightSpan, center: Vec2, halfLength: number): { a: Vec2; b: Vec2 } {
  const tangent = {
    x: (span.b.x - span.a.x) / span.length,
    y: (span.b.y - span.a.y) / span.length,
  };
  return {
    a: { x: center.x - tangent.x * halfLength, y: center.y - tangent.y * halfLength },
    b: { x: center.x + tangent.x * halfLength, y: center.y + tangent.y * halfLength },
  };
}

function crossedBeltOverUnder(
  belt: PolylinePrimitive,
  driver: CirclePrimitive,
  driven: CirclePrimitive,
): SegmentPrimitive[] {
  const spans = tangentSpans(belt, driver, driven);
  const top = spans[0];
  const under = spans[1];
  if (top === undefined || under === undefined) return [];
  const crossing = segmentIntersection(top, under);
  if (crossing === undefined) return [];

  // Never let the drafting convention extend to the pulley contact points.
  // On near-limit valid crossed belts the tangent spans become very short, so
  // scale the gap/bridge down with the available physical span instead of using
  // a fixed decoration that could draw across the pulley faces.
  const underHalfLength = Math.min(0.009, under.length * 0.30);
  const topHalfLength = Math.min(0.012, top.length * 0.35);
  if (!(underHalfLength > 0) || !(topHalfLength > 0)) return [];

  const underGap = centeredSpan(under, crossing, underHalfLength);
  const topBridge = centeredSpan(top, crossing, topHalfLength);
  return [
    {
      type: 'segment',
      id: 'belt-crossing-gap',
      layer: 'mechanism',
      styles: ['cutout'],
      a: underGap.a,
      b: underGap.b,
      width: 9.0,
      ariaLabel: 'Crossed rope underpass gap',
    },
    {
      type: 'segment',
      id: 'belt-crossing-bridge-outline',
      layer: 'mechanism',
      styles: ['belt'],
      a: topBridge.a,
      b: topBridge.b,
      width: 7.0,
      ariaLabel: 'Crossed rope overpass outline',
    },
    {
      type: 'segment',
      id: 'belt-crossing-bridge',
      layer: 'mechanism',
      styles: ['cutout'],
      a: topBridge.a,
      b: topBridge.b,
      width: 4.0,
      ariaLabel: 'Crossed rope overpass interior',
    },
  ];
}

function hideAtRest(primitive: ScenePrimitive): ScenePrimitive {
  if (primitive.type !== 'handle') return primitive;
  if (primitive.id !== 'belt-input-handle' && primitive.id !== 'belt-distance-handle') return primitive;
  return {
    ...primitive,
    styles: ['cutout'],
  } satisfies HandlePrimitive;
}

/**
 * Presentation-only enrichment for Atlas's illustrated mechanism language.
 *
 * This function consumes an already-valid renderer-neutral MechanismScene and
 * expands selected schematic primitives into richer mechanical illustration.
 * It never changes SimulationModel/ModelState semantics or recomputes motion.
 */
export function enrichMechanicalIllustration(scene: MechanismScene): MechanismScene {
  if (!scene.id.startsWith('belt-')) return scene;

  const belt = polyline(scene, 'belt-path');
  const driver = circle(scene, 'belt-driver');
  const driven = circle(scene, 'belt-driven');
  const driverMark = segment(scene, 'belt-driver-mark');
  const drivenMark = segment(scene, 'belt-driven-mark');

  if (
    belt === undefined ||
    driver === undefined ||
    driven === undefined ||
    driverMark === undefined ||
    drivenMark === undefined
  ) {
    return scene;
  }

  const replaced = new Set([
    belt.id,
    driver.id,
    driven.id,
    driverMark.id,
    drivenMark.id,
  ]);

  // The surrounding web lab already exposes ratio and center-distance readouts.
  // Keep Brown's actual mechanism plate visually uncluttered, and leave the
  // interaction controls invisible until focus while retaining their hit areas.
  const staticPrimitives = scene.primitives
    .filter((primitive) => !replaced.has(primitive.id))
    .filter((primitive) => primitive.id !== 'belt-distance' && primitive.id !== 'belt-ratio-label')
    .map(hideAtRest);
  const mechanismIndex = staticPrimitives.findIndex((primitive) => primitive.layer === 'mechanism');
  const insertAt = mechanismIndex < 0 ? staticPrimitives.length : mechanismIndex;
  const details = sharedPulleyDetails(driver, driven);
  const crossing = scene.id === 'belt-reversed'
    ? crossedBeltOverUnder(belt, driver, driven)
    : [];

  const illustrated: ScenePrimitive[] = [
    {
      ...belt,
      id: 'belt-band-underlay',
      styles: ['belt'],
      width: 7.0,
      selectId: undefined,
      ariaLabel: 'Rope outer edge',
    },
    {
      ...belt,
      styles: ['cutout'],
      width: 4.0,
      ariaLabel: 'Rope light interior',
    },
    ...beltSurfaceMarks(belt, driver, driverMark),
    ...crossing,
    ...pulleyIllustration(driver, driverMark, 'belt-driver', details),
    ...pulleyIllustration(driven, drivenMark, 'belt-driven', details),
  ];

  return {
    ...scene,
    primitives: [
      ...staticPrimitives.slice(0, insertAt),
      ...illustrated,
      ...staticPrimitives.slice(insertAt),
    ],
  };
}
