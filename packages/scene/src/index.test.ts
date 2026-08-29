import { describe, expect, it } from 'vitest';
import { quantity, type SimulationModel } from '@atlasmechanica/model';
import { analyticBeltAdapter, openBeltDriveModel } from '@atlasmechanica/kinematics';
import { buildMechanismScene } from './index.js';
import type { PolylinePrimitive, Vec2 } from './types.js';

function verticalReference(model: SimulationModel): SimulationModel {
  const mechanical = model.systems.mechanical;
  const ground = mechanical?.bodies.ground;
  const driven = mechanical?.bodies.driven;
  const drivenAxis = ground?.features['driven-axis'];
  if (mechanical === undefined || ground === undefined || driven === undefined || drivenAxis?.type !== 'axis') {
    throw new TypeError('Belt model is missing expected shaft-center geometry');
  }

  return {
    ...model,
    systems: {
      ...model.systems,
      mechanical: {
        ...mechanical,
        bodies: {
          ...mechanical.bodies,
          ground: {
            ...ground,
            features: {
              ...ground.features,
              'driven-axis': {
                ...drivenAxis,
                origin: {
                  x: quantity(0, 'mm'),
                  y: { parameter: 'center-distance' },
                },
              },
            },
          },
          driven: {
            ...driven,
            referencePose: {
              ...driven.referencePose,
              x: quantity(0, 'mm'),
              y: { parameter: 'center-distance' },
            },
          },
        },
      },
    },
  };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('production Brown belt scene', () => {
  it('wraps an equal-pulley open rope around the exterior semicircles', () => {
    const model = verticalReference(openBeltDriveModel);
    const parameters = {
      'driver-radius': quantity(45, 'mm'),
      'driven-radius': quantity(45, 'mm'),
      'center-distance': quantity(180, 'mm'),
    };
    const state = analyticBeltAdapter.compile(model).createSession().evaluate({
      coordinates: { 'driver-angle': quantity(0, 'deg') },
      parameters,
    });
    const scene = buildMechanismScene({ model, state, parameters });
    const rope = scene.primitives.find(
      (primitive): primitive is PolylinePrimitive =>
        primitive.id === 'belt-path' && primitive.type === 'polyline',
    );
    if (rope === undefined) throw new TypeError('Missing production rope path');

    const drivenExterior = { x: 0, y: 0.225 };
    const drivenInterior = { x: 0, y: 0.135 };
    const driverExterior = { x: 0, y: -0.045 };
    const driverInterior = { x: 0, y: 0.045 };
    const nearest = (target: Vec2) => Math.min(...rope.points.map((point) => distance(point, target)));

    expect(nearest(drivenExterior)).toBeLessThan(1e-9);
    expect(nearest(driverExterior)).toBeLessThan(1e-9);
    expect(nearest(drivenInterior)).toBeGreaterThan(0.04);
    expect(nearest(driverInterior)).toBeGreaterThan(0.04);
  });
});
