import {
  canonicalQuarterTurnBeltModel,
  spatialBeltAdapter,
} from '@atlasmechanica/kinematics';
import { hasErrors, quantity, type ModelState } from '@atlasmechanica/model';
import { createBrown003SpatialRenderer } from '@atlasmechanica/renderer-three/brown003-spatial';
import { brown003SpatialSceneCompiler } from '@atlasmechanica/scene/compilers';

const angleInput = document.querySelector<HTMLInputElement>('#angle');
const host = document.querySelector<HTMLElement>('#brown003-spatial-three-host');
if (angleInput === null || host === null) {
  throw new TypeError('Brown 003 spatial regression harness is missing its controls or host');
}

const compiled = spatialBeltAdapter.compile(canonicalQuarterTurnBeltModel);
const session = compiled.createSession({ configuration: 'reference' });
const renderer = createBrown003SpatialRenderer(host, {
  ariaLabel: 'Brown 003 true spatial Three.js regression view',
});
let currentState: ModelState;

function evaluate(angleDeg: number): ModelState {
  const state = session.evaluate({
    coordinates: { 'driver-angle': quantity(angleDeg, 'deg') },
    rates: { 'driver-angle': quantity(Math.PI, 'rad/s') },
  });
  if (hasErrors(state)) {
    throw new TypeError(state.diagnostics.map((item) => item.message).join('; '));
  }
  return state;
}

function render(): void {
  currentState = evaluate(Number(angleInput.value));
  const parameters = {};
  const scene = brown003SpatialSceneCompiler.build({
    model: canonicalQuarterTurnBeltModel,
    state: currentState,
    parameters,
  });
  renderer.update(scene, {
    model: canonicalQuarterTurnBeltModel,
    state: currentState,
    parameters,
  });
  host.dataset.angle = angleInput.value;
}

angleInput.addEventListener('input', render);

window.addEventListener('beforeunload', () => renderer.destroy(), { once: true });

declare global {
  interface Window {
    __atlasBrown003Spatial: {
      fitView(): void;
      zoomBy(factor: number): void;
      snapshot(): {
        angle: string | undefined;
        geometryBuildCount: string | undefined;
        poseUpdateCount: string | undefined;
        materialArclength: string | undefined;
        spatialDepth: string | undefined;
        cameraPosition: string | undefined;
      };
    };
  }
}

window.__atlasBrown003Spatial = {
  fitView: () => renderer.fitView(),
  zoomBy: (factor) => renderer.zoomBy(factor),
  snapshot: () => ({
    angle: host.dataset.angle,
    geometryBuildCount: host.dataset.geometryBuildCount,
    poseUpdateCount: host.dataset.poseUpdateCount,
    materialArclength: host.dataset.materialArclength,
    spatialDepth: host.dataset.spatialDepth,
    cameraPosition: host.dataset.cameraPosition,
  }),
};

render();
