import type { createThreeMechanismRenderer } from '@atlasmechanica/renderer-three';

export interface LoadedThreeRendererModule {
  readonly createThreeMechanismRenderer: typeof createThreeMechanismRenderer;
  readonly loaderVariant: string;
}

type ThreeRendererLoader = () => Promise<LoadedThreeRendererModule>;

const THREE_RENDERER_LOADERS: Readonly<Record<string, readonly ThreeRendererLoader[]>> = Object.freeze({
  'atlas.renderer-three.belt.v0': Object.freeze([
    () => import('./threeRendererLoaderA.js'),
    () => import('./threeRendererLoaderB.js'),
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
