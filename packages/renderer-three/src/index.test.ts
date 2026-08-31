import { describe, expect, it } from 'vitest';
import type { MechanismScene, PolylinePrimitive } from '@atlasmechanica/scene';
import { beltSpatialPoints } from './index.js';

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
