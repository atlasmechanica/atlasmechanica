export * from './types.js';
export { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';
export type { SceneBuildOptions } from './buildMechanismScene.js';

import {
  buildMechanismScene as buildSchematicMechanismScene,
  type SceneBuildOptions,
} from './buildMechanismScene.js';
import { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';
import type { MechanismScene, ScenePrimitive } from './types.js';

export { buildSchematicMechanismScene };

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
  return frameBrownBeltPlate(
    paintBrownRopeOverPulley(
      enrichMechanicalIllustration(buildSchematicMechanismScene(options)),
    ),
  );
}
