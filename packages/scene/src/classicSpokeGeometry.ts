import type { PolylinePrimitive, Vec2 } from './types.js';

export interface ClassicSpokeOptions {
  center: Vec2;
  angle: number;
  rootRadius: number;
  tipRadius: number;
  rootHalfWidth: number;
  tipHalfWidth: number;
  id: string;
  ariaLabel: string;
}

function radialPoint(center: Vec2, radius: number, angle: number): Vec2 {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

function lateral(point: Vec2, normal: Vec2, offset: number): Vec2 {
  return {
    x: point.x + normal.x * offset,
    y: point.y + normal.y * offset,
  };
}

/**
 * Brown-era cast spokes read as tapered members rather than constant-width bars.
 * Represent the spoke as a closed outlined trapezoid so the flare is geometric
 * and independent of renderer stroke-width tricks.
 */
export function classicSpoke(options: ClassicSpokeOptions): PolylinePrimitive {
  const root = radialPoint(options.center, options.rootRadius, options.angle);
  const tip = radialPoint(options.center, options.tipRadius, options.angle);
  const normal = { x: -Math.sin(options.angle), y: Math.cos(options.angle) };
  const rootLeft = lateral(root, normal, options.rootHalfWidth);
  const tipLeft = lateral(tip, normal, options.tipHalfWidth);
  const tipRight = lateral(tip, normal, -options.tipHalfWidth);
  const rootRight = lateral(root, normal, -options.rootHalfWidth);

  return {
    type: 'polyline',
    id: options.id,
    layer: 'mechanism',
    styles: ['pulley'],
    points: [rootLeft, tipLeft, tipRight, rootRight, rootLeft],
    width: 2.4,
    ariaLabel: options.ariaLabel,
  };
}
