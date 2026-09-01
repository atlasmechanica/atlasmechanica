import { describe, expect, it } from 'vitest';
import {
  clientPointToWorld,
  fitViewportToSize,
  projectLength,
  projectPoint,
} from './geometry.js';

const viewport = { minX: -1, maxX: 3, minY: -2, maxY: 2 };

describe('SVG renderer coordinate transforms', () => {
  it('expands world framing instead of distorting a non-matching scene aspect ratio', () => {
    expect(fitViewportToSize(viewport)).toEqual({
      minX: -2.2,
      maxX: 4.2,
      minY: -2,
      maxY: 2,
    });
    expect(projectPoint({ x: -1, y: 2 }, viewport)).toEqual({ x: 120, y: 0 });
    expect(projectPoint({ x: 3, y: -2 }, viewport)).toEqual({ x: 520, y: 400 });
    expect(projectPoint({ x: 1, y: 0 }, viewport)).toEqual({ x: 320, y: 200 });
    expect(projectLength(1, viewport)).toBeCloseTo(100, 12);
  });

  it('leaves an 8:5 world viewport unchanged', () => {
    const fitted = { minX: 0, maxX: 8, minY: 0, maxY: 5 };
    expect(fitViewportToSize(fitted)).toEqual(fitted);
    expect(projectPoint({ x: 0, y: 5 }, fitted)).toEqual({ x: 0, y: 0 });
    expect(projectPoint({ x: 8, y: 0 }, fitted)).toEqual({ x: 640, y: 400 });
  });

  it('accounts for CSS letterboxing and fitted world framing when mapping client points back', () => {
    const rect = { left: 100, top: 50, width: 1000, height: 400 };
    const center = clientPointToWorld(600, 250, rect, viewport);
    expect(center.x).toBeCloseTo(1, 12);
    expect(center.y).toBeCloseTo(0, 12);

    const leftLetterbox = clientPointToWorld(100, 250, rect, viewport);
    expect(leftLetterbox.x).toBeCloseTo(-2.2, 12);
    const rightLetterbox = clientPointToWorld(1100, 250, rect, viewport);
    expect(rightLetterbox.x).toBeCloseTo(4.2, 12);
  });
});
