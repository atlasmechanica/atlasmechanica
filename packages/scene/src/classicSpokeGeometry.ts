import type { SegmentPrimitive, Vec2 } from './types.js';

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
 * Brown-era cast spokes are best read as a pair of tapering edge lines. Keeping
 * the hub/rim ends open avoids the modern "trapezoid paddle" look and lets the
 * spoke visually join the two circular cast members without drawing through them.
 */
export function classicSpokeEdges(options: ClassicSpokeOptions): [SegmentPrimitive, SegmentPrimitive] {
  const root = radialPoint(options.center, options.rootRadius, options.angle);
  const tip = radialPoint(options.center, options.tipRadius, options.angle);
  const normal = { x: -Math.sin(options.angle), y: Math.cos(options.angle) };
  const rootLeft = lateral(root, normal, options.rootHalfWidth);
  const tipLeft = lateral(tip, normal, options.tipHalfWidth);
  const rootRight = lateral(root, normal, -options.rootHalfWidth);
  const tipRight = lateral(tip, normal, -options.tipHalfWidth);

  return [
    {
      type: 'segment',
      id: options.id,
      layer: 'mechanism',
      styles: ['pulley'],
      a: rootLeft,
      b: tipLeft,
      width: 2.4,
      ariaLabel: `${options.ariaLabel} left edge`,
    },
    {
      type: 'segment',
      id: `${options.id}-edge`,
      layer: 'mechanism',
      styles: ['pulley'],
      a: rootRight,
      b: tipRight,
      width: 2.4,
      ariaLabel: `${options.ariaLabel} right edge`,
    },
  ];
}
