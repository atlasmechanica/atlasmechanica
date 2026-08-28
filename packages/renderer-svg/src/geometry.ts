import type { Vec2, Viewport } from '@atlasmechanica/scene';

export interface RenderSize {
  width: number;
  height: number;
}

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const DEFAULT_RENDER_SIZE: RenderSize = { width: 640, height: 400 };

export function projectPoint(
  point: Vec2,
  viewport: Viewport,
  size: RenderSize = DEFAULT_RENDER_SIZE,
): Vec2 {
  return {
    x: ((point.x - viewport.minX) / (viewport.maxX - viewport.minX)) * size.width,
    y: size.height - ((point.y - viewport.minY) / (viewport.maxY - viewport.minY)) * size.height,
  };
}

export function clientPointToWorld(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  viewport: Viewport,
  size: RenderSize = DEFAULT_RENDER_SIZE,
): Vec2 {
  const scale = Math.min(rect.width / size.width, rect.height / size.height);
  const renderedWidth = size.width * scale;
  const renderedHeight = size.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const tx = Math.min(1, Math.max(0, (clientX - rect.left - offsetX) / renderedWidth));
  const ty = Math.min(1, Math.max(0, (clientY - rect.top - offsetY) / renderedHeight));
  return {
    x: viewport.minX + tx * (viewport.maxX - viewport.minX),
    y: viewport.maxY - ty * (viewport.maxY - viewport.minY),
  };
}
