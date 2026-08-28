import { describe, expect, it } from 'vitest';
import { clientPointToWorld, projectPoint } from './geometry.js';

const viewport = { minX: -1, maxX: 3, minY: -2, maxY: 2 };

describe('SVG renderer coordinate transforms', () => {
  it('projects world coordinates into the configured viewBox', () => {
    expect(projectPoint({ x: -1, y: 2 }, viewport)).toEqual({ x: 0, y: 0 });
    expect(projectPoint({ x: 3, y: -2 }, viewport)).toEqual({ x: 640, y: 400 });
    expect(projectPoint({ x: 1, y: 0 }, viewport)).toEqual({ x: 320, y: 200 });
  });

  it('accounts for letterboxing when mapping client points back to world space', () => {
    const rect = { left: 100, top: 50, width: 1000, height: 400 };
    const center = clientPointToWorld(600, 250, rect, viewport);
    expect(center.x).toBeCloseTo(1, 12);
    expect(center.y).toBeCloseTo(0, 12);

    const leftLetterbox = clientPointToWorld(100, 250, rect, viewport);
    expect(leftLetterbox.x).toBe(-1);
    const rightLetterbox = clientPointToWorld(1100, 250, rect, viewport);
    expect(rightLetterbox.x).toBe(3);
  });
});
