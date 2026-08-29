import type {
  CirclePrimitive,
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

function pulleyIllustration(
  pulley: CirclePrimitive,
  phaseMark: SegmentPrimitive,
  prefix: string,
): ScenePrimitive[] {
  const angle = Math.atan2(
    phaseMark.b.y - pulley.center.y,
    phaseMark.b.x - pulley.center.x,
  );
  const spokeRadius = pulley.radius * 0.77;

  const spokes: SegmentPrimitive[] = Array.from({ length: 4 }, (_, index) => ({
    type: 'segment',
    id: `${prefix}-spoke-${index}`,
    layer: 'mechanism',
    styles: ['body'],
    a: pulley.center,
    b: spokeEndpoint(pulley.center, spokeRadius, angle + index * Math.PI / 2),
    width: 4.8,
    ariaLabel: `${pulley.ariaLabel ?? prefix} spoke`,
  }));

  return [
    {
      ...pulley,
      width: 7.5,
    },
    {
      type: 'circle',
      id: `${prefix}-rim-inner`,
      layer: 'mechanism',
      styles: ['body'],
      center: pulley.center,
      radius: pulley.radius * 0.79,
      width: 2.5,
      ariaLabel: `${pulley.ariaLabel ?? prefix} inner rim`,
    },
    ...spokes,
    {
      type: 'circle',
      id: `${prefix}-hub`,
      layer: 'mechanism',
      styles: ['joint'],
      center: pulley.center,
      radius: Math.max(0.0075, pulley.radius * 0.255),
      width: 4,
      selectId: pulley.selectId,
      ariaLabel: `${pulley.ariaLabel ?? prefix} hub`,
    },
    {
      type: 'circle',
      id: `${prefix}-axle`,
      layer: 'mechanism',
      styles: ['body'],
      center: pulley.center,
      radius: Math.max(0.0025, pulley.radius * 0.07),
      width: 2.6,
      ariaLabel: `${pulley.ariaLabel ?? prefix} axle`,
    },
  ];
}

interface PathSample {
  point: Vec2;
  tangent: Vec2;
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

  const count = 34;
  const spacing = pathLength / count;
  const phaseDirection = beltPathPhaseSign(belt, driver);
  const phase = (((phaseDirection * angle * driver.radius) % spacing) + spacing) % spacing;
  const halfMark = 0.0031;
  const diagonalAlongPath = 0.52;
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
      styles: ['cutout'],
      a: {
        x: sample.point.x - slash.x * halfMark,
        y: sample.point.y - slash.y * halfMark,
      },
      b: {
        x: sample.point.x + slash.x * halfMark,
        y: sample.point.y + slash.y * halfMark,
      },
      width: 1.25,
      ariaLabel: 'Moving cord surface mark',
    };
  }).filter((mark): mark is SegmentPrimitive => mark !== undefined);
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

  const staticPrimitives = scene.primitives.filter((primitive) => !replaced.has(primitive.id));
  const mechanismIndex = staticPrimitives.findIndex((primitive) => primitive.layer === 'mechanism');
  const insertAt = mechanismIndex < 0 ? staticPrimitives.length : mechanismIndex;

  const illustrated: ScenePrimitive[] = [
    {
      ...belt,
      id: 'belt-band-underlay',
      styles: ['ground'],
      width: 8.2,
      selectId: undefined,
      ariaLabel: 'Cord outer edge',
    },
    {
      ...belt,
      width: 5.7,
      ariaLabel: 'Flexible cord path',
    },
    ...beltSurfaceMarks(belt, driver, driverMark),
    ...pulleyIllustration(driver, driverMark, 'belt-driver'),
    ...pulleyIllustration(driven, drivenMark, 'belt-driven'),
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
