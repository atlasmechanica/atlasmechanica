import type { Vector2 } from '@atlasmechanica/model';

export type Vec2 = Vector2;

export const SCENE_LAYER_ORDER = [
  'background',
  'trace',
  'mechanism',
  'annotation',
  'interaction',
  'feedback',
] as const;

export type SceneLayer = (typeof SCENE_LAYER_ORDER)[number];

export const SCENE_STYLE_TOKENS = [
  'ground',
  'body',
  'joint',
  'tracer',
  'belt',
  'pulley',
  'trace',
  'vector',
  'dimension',
  'label',
  'handle',
  'invalid',
  'cutout',
] as const;

export type SceneStyleToken = (typeof SCENE_STYLE_TOKENS)[number];

export interface Viewport {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PrimitiveBase {
  id: string;
  layer: SceneLayer;
  styles: SceneStyleToken[];
  selectId?: string | undefined;
  ariaLabel?: string | undefined;
}

export interface SegmentPrimitive extends PrimitiveBase {
  type: 'segment';
  a: Vec2;
  b: Vec2;
  width?: number | undefined;
}

export interface CirclePrimitive extends PrimitiveBase {
  type: 'circle';
  center: Vec2;
  radius: number;
  width?: number | undefined;
}

export interface PolylinePrimitive extends PrimitiveBase {
  type: 'polyline';
  points: Vec2[];
  width?: number | undefined;
}

export interface VectorPrimitive extends PrimitiveBase {
  type: 'vector';
  from: Vec2;
  to: Vec2;
}

export interface LabelPrimitive extends PrimitiveBase {
  type: 'label';
  at: Vec2;
  text: string;
}

export interface DimensionPrimitive extends PrimitiveBase {
  type: 'dimension';
  a: Vec2;
  b: Vec2;
  text: string;
}

export interface HandlePrimitive extends PrimitiveBase {
  type: 'handle';
  at: Vec2;
  handle: 'input' | 'parameter' | 'invalid';
  shape?: 'circle' | 'square' | undefined;
}

export type ScenePrimitive =
  | SegmentPrimitive
  | CirclePrimitive
  | PolylinePrimitive
  | VectorPrimitive
  | LabelPrimitive
  | DimensionPrimitive
  | HandlePrimitive;

export interface MechanismScene {
  id: string;
  title: string;
  viewport: Viewport;
  primitives: ScenePrimitive[];
  selectedId?: string | undefined;
}

export function assertMechanismScene(scene: MechanismScene): void {
  if (!(scene.viewport.maxX > scene.viewport.minX) || !(scene.viewport.maxY > scene.viewport.minY)) {
    throw new TypeError('Mechanism scene viewport must have positive width and height');
  }

  const ids = new Set<string>();
  for (const primitive of scene.primitives) {
    if (ids.has(primitive.id)) throw new TypeError(`Duplicate scene primitive id ${primitive.id}`);
    ids.add(primitive.id);
    if (primitive.type === 'circle' && !(primitive.radius >= 0)) {
      throw new TypeError(`Scene circle ${primitive.id} has invalid radius`);
    }
  }
}
