import { describe, expect, it } from 'vitest';
import type { MechanismScene, PolylinePrimitive } from '@atlasmechanica/scene';
import { beltCordTextureOffset, beltSpatialPoints } from './index.js';

const belt: PolylinePrimitive = {
  type: 'polyline',
  id: 'belt-band-underlay',
  layer: 'mechanism',
  styles: ['belt'],
  width: 7,
  points: [
    { x: -1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
  ],
};

const crossedScene: MechanismScene = {
  id: 'belt-reversed',
  title: 'Crossed belt',
  viewport: { minX: -1.2, maxX: 1.2, minY: -1.2, maxY: 1.2 },
  primitives: [
    belt,
    {
      type: 'segment',
      id: 'belt-crossing-bridge-outline',
      layer: 'mechanism',
      styles: ['belt'],
      a: { x: -0.2, y: -0.2 },
      b: { x: 0.2, y: 0.2 },
      width: 7,
    },
  ],
};

const openScene: MechanismScene = {
  ...crossedScene,
  id: 'belt-same',
  title: 'Open belt',
  primitives: [belt],
};

const motionBelt: PolylinePrimitive = {
  ...belt,
  points: [
    { x: 1, y: 0 },
    { x: 1, y: 2 },
    { x: -1, y: 2 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ],
};

function motionScene(angle: number): MechanismScene {
  const root = { x: Math.cos(angle), y: Math.sin(angle) };
  const tip = { x: root.x * 1.5, y: root.y * 1.5 };
  return {
    id: 'belt-same',
    title: 'Moving open belt',
    viewport: { minX: -2, maxX: 2, minY: -1, maxY: 3 },
    primitives: [
      motionBelt,
      {
        type: 'circle',
        id: 'belt-driver',
        layer: 'mechanism',
        styles: ['pulley'],
        center: { x: 0, y: 0 },
        radius: 0.95,
        width: 4,
      },
      {
        type: 'segment',
        id: 'belt-driver-spoke-0',
        layer: 'mechanism',
        styles: ['pulley'],
        a: root,
        b: tip,
        width: 3,
      },
      {
        type: 'segment',
        id: 'belt-driver-spoke-0-edge',
        layer: 'mechanism',
        styles: ['pulley'],
        a: root,
        b: tip,
        width: 3,
      },
    ],
  };
}

describe('beltSpatialPoints', () => {
  it('keeps the open belt centered on the pulley midplane', () => {
    const points = beltSpatialPoints(openScene, belt, 0.01);
    expect(points).toHaveLength(belt.points.length);
    expect(points.every((point) => point.z === 0)).toBe(true);
  });

  it('grades crossed spans from centered wheel contacts to separated crossing points', () => {
    const crossingOffset = 0.0025;
    const points = beltSpatialPoints(crossedScene, belt, crossingOffset);
    const crossings = points.filter((point) => Math.hypot(point.x, point.y) < 1e-9);

    expect(crossings).toHaveLength(2);
    expect(crossings.map((point) => point.z).sort((a, b) => a - b)).toEqual([
      -crossingOffset,
      crossingOffset,
    ]);

    for (const original of belt.points) {
      const matching = points.find((point) => {
        return Math.hypot(point.x - original.x, point.y - original.y) < 1e-9;
      });
      expect(matching?.z).toBe(0);
    }
  });

  it('keeps the duplicated closing contact centered with no axial seam', () => {
    const points = beltSpatialPoints(crossedScene, belt, 0.0025);
    expect(points[0]?.z).toBe(0);
    expect(points.at(-1)?.z).toBe(0);
    expect(points.at(-1)?.x).toBe(points[0]?.x);
    expect(points.at(-1)?.y).toBe(points[0]?.y);
  });
});

describe('beltCordTextureOffset', () => {
  it('advances the cached cord material with driver rotation and resets with angle', () => {
    const pathLength = 8;
    const initial = beltCordTextureOffset(motionScene(0), motionBelt, pathLength);
    const quarterTurn = beltCordTextureOffset(motionScene(Math.PI / 2), motionBelt, pathLength);
    const expectedQuarterTurn = ((-(Math.PI / 2) / pathLength * 22) % 1 + 1) % 1;

    expect(initial).toBeCloseTo(0, 12);
    expect(quarterTurn).toBeCloseTo(expectedQuarterTurn, 12);
    expect(quarterTurn).not.toBeCloseTo(initial, 6);
    expect(beltCordTextureOffset(motionScene(0), motionBelt, pathLength)).toBeCloseTo(initial, 12);
  });
});
