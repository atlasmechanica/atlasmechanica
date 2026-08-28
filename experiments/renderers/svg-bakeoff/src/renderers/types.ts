import type { MechanismScene, Vec2, Viewport } from '../scene.js';

export interface RendererCallbacks {
  onSelect(id: string): void;
  onInputDrag(point: Vec2): void;
  onParameterDrag(point: Vec2): void;
  onNudgeInput(deltaDegrees: number): void;
}

export interface CandidateRenderer {
  readonly id: 'native' | 'svgjs' | 'jsxgraph';
  update(scene: MechanismScene): void;
  exportSvg(): string | null;
  domNodeCount(): number;
  destroy(): void;
}

export type RendererFactory = (
  host: HTMLElement,
  callbacks: RendererCallbacks,
) => CandidateRenderer;

export const SVG_WIDTH = 640;
export const SVG_HEIGHT = 400;

export function project(point: Vec2, viewport: Viewport): Vec2 {
  return {
    x: ((point.x - viewport.minX) / (viewport.maxX - viewport.minX)) * SVG_WIDTH,
    y:
      SVG_HEIGHT -
      ((point.y - viewport.minY) / (viewport.maxY - viewport.minY)) * SVG_HEIGHT,
  };
}

export function clientToWorld(
  clientX: number,
  clientY: number,
  host: HTMLElement,
  viewport: Viewport,
): Vec2 {
  const rect = host.getBoundingClientRect();
  const tx = (clientX - rect.left) / rect.width;
  const ty = (clientY - rect.top) / rect.height;
  return {
    x: viewport.minX + tx * (viewport.maxX - viewport.minX),
    y: viewport.maxY - ty * (viewport.maxY - viewport.minY),
  };
}

export function sceneClassName(classes: readonly string[], selected: boolean): string {
  return ['scene-visible', ...classes, selected ? 'scene-selected' : '']
    .filter(Boolean)
    .join(' ');
}
