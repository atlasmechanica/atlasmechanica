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
  const spokeRadius = pulley.radius * 0.72;

  const spokes: SegmentPrimitive[] = Array.from({ length: 4 }, (_, index) => ({
    type: 'segment',
    id: `${prefix}-spoke-${index}`,
    layer: 'mechanism',
    styles: ['body'],
    a: pulley.center,
    b: spokeEndpoint(pulley.center, spokeRadius, angle + index * Math.PI / 2),
    width: 2.6,
    ariaLabel: `${pulley.ariaLabel ?? prefix} spoke`,
  }));

  return [
    {
      ...pulley,
      width: 5.5,
    },
    {
      type: 'circle',
      id: `${prefix}-rim-inner`,
      layer: 'mechanism',
      styles: ['ground'],
      center: pulley.center,
      radius: pulley.radius * 0.82,
      width: 1.8,
      ariaLabel: `${pulley.ariaLabel ?? prefix} inner rim`,
    },
    ...spokes,
    {
      type: 'circle',
      id: `${prefix}-hub`,
      layer: 'mechanism',
      styles: ['joint'],
      center: pulley.center,
      radius: Math.max(0.006, pulley.radius * 0.19),
      width: 3,
      selectId: pulley.selectId,
      ariaLabel: `${pulley.ariaLabel ?? prefix} hub`,
    },
    {
      type: 'circle',
      id: `${prefix}-axle`,
      layer: 'mechanism',
      styles: ['body'],
      center: pulley.center,
      radius: Math.max(0.0022, pulley.radius * 0.055),
      width: 2.2,
      ariaLabel: `${pulley.ariaLabel ?? prefix} axle`,
    },
  ];
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
      width: 10,
      selectId: undefined,
      ariaLabel: 'Belt edge',
    },
    {
      ...belt,
      width: 5.5,
    },
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
