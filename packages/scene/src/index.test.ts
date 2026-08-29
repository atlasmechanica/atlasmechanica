import { describe, expect, it } from 'vitest';
import { quantity, type SimulationModel } from '@atlasmechanica/model';
import { analyticBeltAdapter, openBeltDriveModel } from '@atlasmechanica/kinematics';
import { buildMechanismScene } from './index.js';
import type { MechanismScene, PolylinePrimitive, Vec2 } from './types.js';

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

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function productionScene(): MechanismScene {
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
  return buildMechanismScene({ model, state, parameters });
}

describe('production Brown belt scene', () => {
  it('wraps an equal-pulley open rope around the exterior semicircles', () => {
    const scene = productionScene();
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

  it('uses clearly tapered open cast-spoke edges that remain clear of hub and inner rim', () => {
    const scene = productionScene();
    const leftEdge = scene.primitives.find((primitive) => primitive.id === 'belt-driver-spoke-0');
    const rightEdge = scene.primitives.find((primitive) => primitive.id === 'belt-driver-spoke-0-edge');
    const hub = scene.primitives.find((primitive) => primitive.id === 'belt-driver-hub');
    const innerRim = scene.primitives.find((primitive) => primitive.id === 'belt-driver-rim-inner');
    if (
      leftEdge?.type !== 'segment' ||
      rightEdge?.type !== 'segment' ||
      hub?.type !== 'circle' ||
      innerRim?.type !== 'circle'
    ) {
      throw new TypeError('Missing production cast-spoke geometry');
    }

    const rootWidth = distance(leftEdge.a, rightEdge.a);
    const tipWidth = distance(leftEdge.b, rightEdge.b);
    const rootCenter = midpoint(leftEdge.a, rightEdge.a);
    const tipCenter = midpoint(leftEdge.b, rightEdge.b);

    expect(rootWidth / tipWidth).toBeCloseTo(2, 10);
    expect(distance(rootCenter, hub.center)).toBeGreaterThan(hub.radius);
    expect(distance(tipCenter, innerRim.center)).toBeLessThan(innerRim.radius);
    expect(leftEdge.width).toBeCloseTo(2.4 * 1.35, 12);
    expect(rightEdge.width).toBeCloseTo(2.4 * 1.35, 12);
    expect(scene.primitives.some((primitive) => primitive.id.startsWith('belt-driver-spoke-root-'))).toBe(false);
    expect(scene.primitives.some((primitive) => primitive.id.startsWith('belt-driver-spoke-core-'))).toBe(false);
  });

  it('makes the weighted cast rim tangent to the rope edge without moving the physical contact path', () => {
    const scene = productionScene();
    const rope = scene.primitives.find((primitive) => primitive.id === 'belt-band-underlay');
    const driver = scene.primitives.find((primitive) => primitive.id === 'belt-driver');
    if (
      rope?.type !== 'polyline' ||
      driver?.type !== 'circle' ||
      rope.width === undefined ||
      driver.width === undefined
    ) {
      throw new TypeError('Missing weighted rope/rim geometry');
    }

    const contact = rope.points[0];
    if (contact === undefined) throw new TypeError('Missing physical rope contact');
    const pitchRadius = distance(driver.center, contact);
    const worldUnitsPerReferencePixel = 0.64 / 1180;
    const ropeInnerRadius = pitchRadius - rope.width * worldUnitsPerReferencePixel / 2;
    const rimOuterRadius = driver.radius + driver.width * worldUnitsPerReferencePixel / 2;

    expect(pitchRadius).toBeCloseTo(0.045, 10);
    expect(ropeInnerRadius - rimOuterRadius).toBeCloseTo(0, 10);
  });

  it('applies one consistent 1.35x weight to the Brown mechanism strokes', () => {
    const scene = productionScene();
    const expectations = [
      ['belt-band-underlay', 'polyline', 7.0],
      ['belt-path', 'polyline', 4.0],
      ['belt-driver', 'circle', 4.4],
      ['belt-driver-rim-inner', 'circle', 3.0],
      ['belt-driver-hub', 'circle', 3.4],
      ['belt-driver-spoke-0', 'segment', 2.4],
      ['belt-surface-mark-0', 'segment', 1.1],
    ] as const;

    for (const [id, type, nominalWidth] of expectations) {
      const primitive = scene.primitives.find((candidate) => candidate.id === id);
      if (primitive?.type !== type || !('width' in primitive)) {
        throw new TypeError(`Missing weighted production primitive ${id}`);
      }
      expect(primitive.width).toBeCloseTo(nominalWidth * 1.35, 12);
    }
  });
});
