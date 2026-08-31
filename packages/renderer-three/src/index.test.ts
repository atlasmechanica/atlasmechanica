import { describe, expect, it } from 'vitest';
import type { MechanismScene, PolylinePrimitive } from '@atlasmechanica/scene';
import { beltDepthProfile } from './index.js';

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

const scene: MechanismScene = {
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

describe('beltDepthProfile', () => {
  it('separates the crossed top and under spans in z using the shared bridge cue', () => {
    const profile = beltDepthProfile(scene, belt, 0.01);
    expect(profile).toHaveLength(belt.points.length);
    expect(profile[0]).toBeGreaterThan(0);
    expect(profile[1]).toBeGreaterThan(0);
    expect(profile[2]).toBeLessThan(0);
    expect(profile[3]).toBeLessThan(0);
  });
});
