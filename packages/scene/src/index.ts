export * from './types.js';
export { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';
export type { SceneBuildOptions } from './buildMechanismScene.js';

import {
  buildMechanismScene as buildSchematicMechanismScene,
  type SceneBuildOptions,
} from './buildMechanismScene.js';
import { classicSpoke } from './classicSpokeGeometry.js';
import { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';
import type { MechanismScene, ScenePrimitive, Vec2 } from './types.js';

export { buildSchematicMechanismScene };

function normalizedPositive(angle: number): number {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function arcPoint(center: Vec2, radius: number, angle: number): Vec2 {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

function exteriorSemicircle(
  center: Vec2,
  start: Vec2,
  end: Vec2,
  awayFromOtherPulley: Vec2,
  samples = 36,
): Vec2[] {
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const ccw = normalizedPositive(endAngle - startAngle);
  const cw = ccw - Math.PI * 2;

  const midpointScore = (delta: number): number => {
    const midpoint = arcPoint(center, radius, startAngle + delta / 2);
    return (
      (midpoint.x - center.x) * awayFromOtherPulley.x +
      (midpoint.y - center.y) * awayFromOtherPulley.y
    );
  };
  const delta = midpointScore(ccw) >= midpointScore(cw) ? ccw : cw;

  return Array.from({ length: samples + 1 }, (_, index) => {
    return arcPoint(center, radius, startAngle + delta * (index / samples));
  });
}

function correctOpenEqualPulleyWrap(scene: MechanismScene): MechanismScene {
  if (scene.id !== 'belt-same') return scene;

  const driver = scene.primitives.find((primitive) => primitive.id === 'belt-driver');
  const driven = scene.primitives.find((primitive) => primitive.id === 'belt-driven');
  const belt = scene.primitives.find((primitive) => primitive.id === 'belt-path');
  if (driver?.type !== 'circle' || driven?.type !== 'circle' || belt?.type !== 'polyline') {
    return scene;
  }

  const tolerance = Math.max(driver.radius, driven.radius) * 1e-9;
  if (Math.abs(driver.radius - driven.radius) > tolerance) return scene;

  const dx = driven.center.x - driver.center.x;
  const dy = driven.center.y - driver.center.y;
  const centerDistance = Math.hypot(dx, dy);
  if (!(centerDistance > 0)) return scene;

  const ex = dx / centerDistance;
  const ey = dy / centerDistance;
  const nx = -ey;
  const ny = ex;
  const radius = driver.radius;

  const driverA = {
    x: driver.center.x + nx * radius,
    y: driver.center.y + ny * radius,
  };
  const drivenA = {
    x: driven.center.x + nx * radius,
    y: driven.center.y + ny * radius,
  };
  const driverB = {
    x: driver.center.x - nx * radius,
    y: driver.center.y - ny * radius,
  };
  const drivenB = {
    x: driven.center.x - nx * radius,
    y: driven.center.y - ny * radius,
  };

  const drivenArc = exteriorSemicircle(
    driven.center,
    drivenA,
    drivenB,
    { x: dx, y: dy },
  );
  const driverArc = exteriorSemicircle(
    driver.center,
    driverB,
    driverA,
    { x: -dx, y: -dy },
  );
  const points = [
    driverA,
    drivenA,
    ...drivenArc.slice(1),
    driverB,
    ...driverArc.slice(1),
  ];

  return {
    ...scene,
    primitives: scene.primitives.map((primitive) => {
      return primitive.id === belt.id && primitive.type === 'polyline'
        ? { ...primitive, points }
        : primitive;
    }),
  };
}

function frameBrownBeltPlate(scene: MechanismScene): MechanismScene {
  if (!scene.id.startsWith('belt-')) return scene;
  const driver = scene.primitives.find((primitive) => primitive.id === 'belt-driver');
  const driven = scene.primitives.find((primitive) => primitive.id === 'belt-driven');
  if (driver?.type !== 'circle' || driven?.type !== 'circle') return scene;

  const dx = Math.abs(driven.center.x - driver.center.x);
  const dy = Math.abs(driven.center.y - driver.center.y);
  if (dy <= dx) return scene;

  // Brown/507 movements 001 and 002 use a vertical two-pulley composition.
  // The native renderer's configured viewBox is 640×400, so keep this world
  // viewport at the same 1.6 aspect ratio. That preserves isotropic world scale:
  // a physical circle remains a circle instead of being stretched into an ellipse.
  // The generous horizontal field is intentional letterboxing around the narrow
  // historical plate and also leaves enough fixed Y range for parameter dragging.
  return {
    ...scene,
    viewport: {
      minX: -0.32,
      maxX: 0.32,
      minY: -0.07,
      maxY: 0.33,
    },
  };
}

function isSpokePrimitive(primitive: ScenePrimitive, prefix: string): boolean {
  return (
    primitive.id.startsWith(`${prefix}-spoke-`) ||
    primitive.id.startsWith(`${prefix}-spoke-root-`)
  );
}

function replacePulleySpokes(
  primitives: ScenePrimitive[],
  prefix: 'belt-driver' | 'belt-driven',
): ScenePrimitive[] {
  const pulley = primitives.find((primitive) => primitive.id === prefix);
  const hub = primitives.find((primitive) => primitive.id === `${prefix}-hub`);
  const innerRim = primitives.find((primitive) => primitive.id === `${prefix}-rim-inner`);
  const phaseSpoke = primitives.find((primitive) => primitive.id === `${prefix}-spoke-0`);
  if (
    pulley?.type !== 'circle' ||
    hub?.type !== 'circle' ||
    innerRim?.type !== 'circle' ||
    phaseSpoke?.type !== 'segment'
  ) {
    return primitives;
  }

  const baseAngle = Math.atan2(
    phaseSpoke.b.y - phaseSpoke.a.y,
    phaseSpoke.b.x - phaseSpoke.a.x,
  );
  const rootRadius = hub.radius + pulley.radius * 0.012;
  const tipRadius = innerRim.radius - pulley.radius * 0.035;
  if (!(tipRadius > rootRadius)) return primitives;

  // Make the historical cast-spoke taper unmistakable rather than simulating it
  // with two constant-width strokes. The root is a little over 3× the tip width
  // on Brown 001/002, while both ends remain clear of the hub and inner rim.
  const rootHalfWidth = Math.min(pulley.radius * 0.16, hub.radius * 0.55);
  const tipHalfWidth = pulley.radius * 0.052;
  const spokes = Array.from({ length: 4 }, (_, index) => classicSpoke({
    center: pulley.center,
    angle: baseAngle + index * Math.PI / 2,
    rootRadius,
    tipRadius,
    rootHalfWidth,
    tipHalfWidth,
    id: `${prefix}-spoke-${index}`,
    ariaLabel: `${pulley.ariaLabel ?? prefix} tapered cast spoke`,
  }));

  const firstSpokeIndex = primitives.findIndex((primitive) => isSpokePrimitive(primitive, prefix));
  if (firstSpokeIndex < 0) return primitives;
  const withoutOldSpokes = primitives.filter((primitive) => !isSpokePrimitive(primitive, prefix));
  const insertionIndex = Math.min(firstSpokeIndex, withoutOldSpokes.length);
  return [
    ...withoutOldSpokes.slice(0, insertionIndex),
    ...spokes,
    ...withoutOldSpokes.slice(insertionIndex),
  ];
}

function replaceWithClassicCastSpokes(scene: MechanismScene): MechanismScene {
  if (!scene.id.startsWith('belt-')) return scene;
  const driverReplaced = replacePulleySpokes(scene.primitives, 'belt-driver');
  const bothReplaced = replacePulleySpokes(driverReplaced, 'belt-driven');
  return { ...scene, primitives: bothReplaced };
}

function isRopePaint(primitive: ScenePrimitive): boolean {
  return (
    primitive.id === 'belt-band-underlay' ||
    primitive.id === 'belt-path' ||
    primitive.id.startsWith('belt-surface-mark-') ||
    primitive.id.startsWith('belt-crossing-')
  );
}

function paintBrownRopeOverPulley(scene: MechanismScene): MechanismScene {
  if (!scene.id.startsWith('belt-')) return scene;

  const rope = scene.primitives.filter(isRopePaint);
  if (rope.length === 0) return scene;

  // The canonical belt path lies on the pulley contact circumference. In the
  // Brown/507 illustration the rope is the material wrapped around that rim, so
  // it must be painted after the cast wheel. Painting the wheel last visually
  // hides the rope at contact and makes it look like it runs in an inner groove.
  const beneath = scene.primitives.filter((primitive) => !isRopePaint(primitive));
  return {
    ...scene,
    primitives: [...beneath, ...rope],
  };
}

/**
 * Production scene builder. Canonical mechanical geometry is compiled first,
 * then a presentation-only illustration pass adds Atlas's visual language.
 */
export function buildMechanismScene(options: SceneBuildOptions) {
  const schematic = correctOpenEqualPulleyWrap(buildSchematicMechanismScene(options));
  const illustrated = replaceWithClassicCastSpokes(
    enrichMechanicalIllustration(schematic),
  );
  return frameBrownBeltPlate(
    paintBrownRopeOverPulley(illustrated),
  );
}
