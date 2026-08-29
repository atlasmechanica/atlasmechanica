import { describe, expect, it } from 'vitest';
import { quantity } from '@atlasmechanica/model';
import {
  analyticBeltAdapter,
  crossedBeltDriveModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import { buildMechanismScene } from './buildMechanismScene.js';
import { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';
import type { CirclePrimitive, MechanismScene, PolylinePrimitive, Vec2 } from './types.js';

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function circle(scene: MechanismScene, id: string): CirclePrimitive {
  const primitive = scene.primitives.find((candidate) => candidate.id === id);
  if (primitive?.type !== 'circle') throw new TypeError(`Missing circle ${id}`);
  return primitive;
}

function belt(scene: MechanismScene): PolylinePrimitive {
  const primitive = scene.primitives.find((candidate) => candidate.id === 'belt-path');
  if (primitive?.type !== 'polyline') throw new TypeError('Missing rope path');
  return primitive;
}

function illustrated(model: typeof openBeltDriveModel | typeof crossedBeltDriveModel): MechanismScene {
  const parameters = {
    'driver-radius': quantity(45, 'mm'),
    'driven-radius': quantity(45, 'mm'),
    'center-distance': quantity(180, 'mm'),
  };
  const state = analyticBeltAdapter.compile(model).createSession().evaluate({
    coordinates: { 'driver-angle': quantity(0, 'deg') },
    parameters,
  });

  return enrichMechanicalIllustration(buildMechanismScene({ model, state, parameters }));
}

describe('rope/pulley presentation geometry', () => {
  it.each([
    ['open', openBeltDriveModel],
    ['crossed', crossedBeltDriveModel],
  ] as const)('keeps the visible %s pulley material inside the rope pitch circle', (_name, model) => {
    const scene = illustrated(model);
    const driver = circle(scene, 'belt-driver');
    const rope = belt(scene);
    const contact = rope.points[0];
    if (contact === undefined) throw new TypeError('Missing driver rope contact');

    const pitchRadius = distance(driver.center, contact);
    expect(pitchRadius).toBeCloseTo(0.045, 10);
    expect(driver.radius).toBeCloseTo(0.045 * 0.95, 10);
    expect(pitchRadius - driver.radius).toBeCloseTo(0.045 * 0.05, 10);
  });
});
