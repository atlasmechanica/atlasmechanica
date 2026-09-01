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

/** Expand a world viewport around its center to match the render surface. */
export function fitViewportToSize(
  viewport: Viewport,
  size: RenderSize = DEFAULT_RENDER_SIZE,
): Viewport {
  const width = viewport.maxX - viewport.minX;
  const height = viewport.maxY - viewport.minY;
  const targetAspect = size.width / size.height;
  const worldAspect = width / height;
  const centerX = (viewport.minX + viewport.maxX) / 2;
  const centerY = (viewport.minY + viewport.maxY) / 2;

  if (worldAspect > targetAspect) {
    const fittedHeight = width / targetAspect;
    return {
      minX: viewport.minX,
      maxX: viewport.maxX,
      minY: centerY - fittedHeight / 2,
      maxY: centerY + fittedHeight / 2,
    };
  }

  const fittedWidth = height * targetAspect;
  return {
    minX: centerX - fittedWidth / 2,
    maxX: centerX + fittedWidth / 2,
    minY: viewport.minY,
    maxY: viewport.maxY,
  };
}

export function projectPoint(
  point: Vec2,
  viewport: Viewport,
  size: RenderSize = DEFAULT_RENDER_SIZE,
): Vec2 {
  const fitted = fitViewportToSize(viewport, size);
  return {
    x: ((point.x - fitted.minX) / (fitted.maxX - fitted.minX)) * size.width,
    y: size.height - ((point.y - fitted.minY) / (fitted.maxY - fitted.minY)) * size.height,
  };
}

export function projectLength(
  length: number,
  viewport: Viewport,
  size: RenderSize = DEFAULT_RENDER_SIZE,
): number {
  const fitted = fitViewportToSize(viewport, size);
  return (length / (fitted.maxX - fitted.minX)) * size.width;
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
  const fitted = fitViewportToSize(viewport, size);
  return {
    x: fitted.minX + tx * (fitted.maxX - fitted.minX),
    y: fitted.maxY - ty * (fitted.maxY - fitted.minY),
  };
}
