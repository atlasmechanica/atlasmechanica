export * from './types.js';
export { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';
export type { SceneBuildOptions } from './buildMechanismScene.js';

import {
  buildMechanismScene as buildSchematicMechanismScene,
  type SceneBuildOptions,
} from './buildMechanismScene.js';
import { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';
import type { MechanismScene } from './types.js';

export { buildSchematicMechanismScene };

function frameBrownBeltPlate(scene: MechanismScene): MechanismScene {
  if (!scene.id.startsWith('belt-')) return scene;
  const driver = scene.primitives.find((primitive) => primitive.id === 'belt-driver');
  const driven = scene.primitives.find((primitive) => primitive.id === 'belt-driven');
  if (driver?.type !== 'circle' || driven?.type !== 'circle') return scene;

  const dx = Math.abs(driven.center.x - driver.center.x);
  const dy = Math.abs(driven.center.y - driver.center.y);
  if (dy <= dx) return scene;

  // Brown/507 movements 001 and 002 use a portrait plate with the two pulley
  // centers vertically aligned. Keep enough fixed room for direct center-distance
  // manipulation without reframing on every pointer move.
  return {
    ...scene,
    viewport: {
      minX: -0.13,
      maxX: 0.13,
      minY: -0.07,
      maxY: 0.33,
    },
  };
}

/**
 * Production scene builder. Canonical mechanical geometry is compiled first,
 * then a presentation-only illustration pass adds Atlas's visual language.
 */
export function buildMechanismScene(options: SceneBuildOptions) {
  return frameBrownBeltPlate(
    enrichMechanicalIllustration(buildSchematicMechanismScene(options)),
  );
}
