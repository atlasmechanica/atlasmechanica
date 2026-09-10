import type {
  ModelState,
  ParameterId,
  QuantityValue,
  SimulationModel,
} from '@atlasmechanica/model';
import type {
  ThreeMechanismRenderer,
  ThreeMechanismRendererOptions,
} from '@atlasmechanica/renderer-three';
import type { MechanismScene } from '@atlasmechanica/scene';

export interface ThreeRendererRuntimeContext {
  readonly model: SimulationModel;
  readonly state: ModelState;
  readonly parameters?: Partial<Record<ParameterId, QuantityValue>>;
}

export interface RuntimeAwareThreeMechanismRenderer extends Omit<ThreeMechanismRenderer, 'update'> {
  update(scene: MechanismScene, runtime?: ThreeRendererRuntimeContext): void;
}

export type CreateRegisteredThreeRenderer = (
  host: HTMLElement,
  options?: ThreeMechanismRendererOptions,
) => RuntimeAwareThreeMechanismRenderer;

export interface LoadedThreeRendererModule {
  readonly createThreeMechanismRenderer: CreateRegisteredThreeRenderer;
  readonly loaderVariant: string;
}

type ThreeRendererLoader = () => Promise<LoadedThreeRendererModule>;

const THREE_RENDERER_LOADERS: Readonly<Record<string, readonly ThreeRendererLoader[]>> = Object.freeze({
  'atlas.renderer-three.belt.v0': Object.freeze([
    () => import('./threeRendererLoaderA.js'),
    () => import('./threeRendererLoaderB.js'),
  ]),
  'atlas.renderer-three.brown-003-spatial.v0': Object.freeze([
    () => import('./threeRendererBrown003.js'),
  ]),
});

export function loadRegisteredThreeRenderer(
  rendererId: string,
  attempt: number,
): Promise<LoadedThreeRendererModule> {
  const loaders = THREE_RENDERER_LOADERS[rendererId];
  if (loaders === undefined || loaders.length === 0) {
    return Promise.reject(new TypeError(`No registered 3D renderer ${rendererId}`));
  }
  const loader = loaders[attempt % loaders.length] ?? loaders[0];
  if (loader === undefined) {
    return Promise.reject(new TypeError(`No loader available for 3D renderer ${rendererId}`));
  }
  return loader();
}
