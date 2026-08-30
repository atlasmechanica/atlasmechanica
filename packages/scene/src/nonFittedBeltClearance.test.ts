import { describe, expect, it } from 'vitest';
import { analyticBeltAdapter, openBeltDriveModel } from '@atlasmechanica/kinematics';
import { quantity } from '@atlasmechanica/model';
import { buildMechanismScene } from './index.js';

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('non-fitted belt presentation clearance', () => {
  it('keeps the weighted rim tangent to the rope on the native 640px surface', () => {
    const parameters = {
      'driver-radius': quantity(45, 'mm'),
      'driven-radius': quantity(45, 'mm'),
      'center-distance': quantity(180, 'mm'),
    };
    const state = analyticBeltAdapter.compile(openBeltDriveModel).createSession().evaluate({
      coordinates: { 'driver-angle': quantity(0, 'deg') },
      parameters,
    });
    const scene = buildMechanismScene({
      model: openBeltDriveModel,
      state,
      parameters,
    });

    const rope = scene.primitives.find((primitive) => primitive.id === 'belt-band-underlay');
    const driver = scene.primitives.find((primitive) => primitive.id === 'belt-driver');
    if (
      rope?.type !== 'polyline' ||
      driver?.type !== 'circle' ||
      rope.width === undefined ||
      driver.width === undefined
    ) {
      throw new TypeError('Missing horizontal rope/rim geometry');
    }

    const contact = rope.points[0];
    if (contact === undefined) throw new TypeError('Missing horizontal rope contact');

    const pitchRadius = distance(driver.center, contact);
    const worldWidth = scene.viewport.maxX - scene.viewport.minX;
    const worldUnitsPerPixel = worldWidth / 640;
    const ropeInnerRadius = pitchRadius - rope.width * worldUnitsPerPixel / 2;
    const rimOuterRadius = driver.radius + driver.width * worldUnitsPerPixel / 2;

    expect(Math.abs(scene.viewport.maxY - scene.viewport.minY)).not.toBeCloseTo(
      worldWidth / 1.6,
      12,
    );
    expect(pitchRadius).toBeCloseTo(0.045, 10);
    expect(ropeInnerRadius - rimOuterRadius).toBeCloseTo(0, 10);
  });
});
