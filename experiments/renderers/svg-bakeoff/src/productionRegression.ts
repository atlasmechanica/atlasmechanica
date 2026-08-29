import {
  analyticBeltAdapter,
  analyticFourBarAdapter,
  canonicalFourBarModel,
  crossedBeltDriveModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import { hasErrors, quantity, type ModelState, type QuantityValue, type SimulationModel } from '@atlasmechanica/model';
import { createSvgMechanismRenderer } from '@atlasmechanica/renderer-svg';
import { buildMechanismScene, type Vec2 } from '@atlasmechanica/scene';

type MechanismChoice = 'fourbar' | 'belt-open' | 'belt-crossed';

const brownPulleyRadiusMm = 45;

const mechanismSelect = document.querySelector<HTMLSelectElement>('#mechanism')!;
const angleInput = document.querySelector<HTMLInputElement>('#angle')!;
const distanceInput = document.querySelector<HTMLInputElement>('#distance')!;
const selectionElement = document.querySelector<HTMLElement>('#selection')!;
const statusElement = document.querySelector<HTMLElement>('#status')!;
const host = document.querySelector<HTMLElement>('#production-host')!;

function verticalBrownReference(model: SimulationModel): SimulationModel {
  const mechanical = model.systems.mechanical;
  const ground = mechanical?.bodies.ground;
  const driven = mechanical?.bodies.driven;
  const drivenAxis = ground?.features['driven-axis'];
  if (mechanical === undefined || ground === undefined || driven === undefined || drivenAxis?.type !== 'axis') {
    throw new TypeError('Belt model is missing the expected shaft-center geometry');
  }

  return {
    ...model,
    systems: {
      ...model.systems,
      mechanical: {
        ...mechanical,
        bodies: {
          ...mechanical.bodies,
          ground: {
            ...ground,
            features: {
              ...ground.features,
              'driven-axis': {
                ...drivenAxis,
                origin: {
                  x: quantity(0, 'mm'),
                  y: { parameter: 'center-distance' },
                },
              },
            },
          },
          driven: {
            ...driven,
            referencePose: {
              ...driven.referencePose,
              x: quantity(0, 'mm'),
              y: { parameter: 'center-distance' },
            },
          },
        },
      },
    },
  };
}

const verticalOpenBeltDriveModel = verticalBrownReference(openBeltDriveModel);
const verticalCrossedBeltDriveModel = verticalBrownReference(crossedBeltDriveModel);

const fourBarCompiled = analyticFourBarAdapter.compile(canonicalFourBarModel);
const beltCompiled = {
  'belt-open': analyticBeltAdapter.compile(verticalOpenBeltDriveModel),
  'belt-crossed': analyticBeltAdapter.compile(verticalCrossedBeltDriveModel),
};

let selectedId: string | undefined;
let invalidParameterHandle: Vec2 | undefined;
let parameterDragCount = 0;

function tracePoint(state: ModelState): Vec2 {
  const signal = state.signals['coupler-point-position'];
  if (signal?.type !== 'vector2') throw new TypeError('Four-bar trace state missing tracer');
  return signal.value;
}

const fourBarTrace = (() => {
  const session = fourBarCompiled.createSession({ configuration: 'open' });
  const points: Vec2[] = [];
  for (let angle = 0; angle <= 360; angle += 2) {
    points.push(tracePoint(session.evaluate({ coordinates: { 'driver-angle': quantity(angle, 'deg') } })));
  }
  return points;
})();

function normalizedDegrees(value: number): number {
  const result = ((value % 360) + 360) % 360;
  return Math.abs(result - 360) < 1e-9 ? 0 : result;
}

function choice(): MechanismChoice {
  return mechanismSelect.value as MechanismChoice;
}

function angleDeg(): number {
  return Number(angleInput.value);
}

function centerDistanceMm(): number {
  return Number(distanceInput.value);
}

function evaluateFourBar(): ModelState {
  return fourBarCompiled.createSession({ configuration: 'open' }).evaluate({
    coordinates: { 'driver-angle': quantity(angleDeg(), 'deg') },
    rates: { 'driver-angle': quantity(1, 'rad/s') },
    accelerations: { 'driver-angle': quantity(0, 'rad/s^2') },
  });
}

function beltModel(current: 'belt-open' | 'belt-crossed'): SimulationModel {
  return current === 'belt-open' ? verticalOpenBeltDriveModel : verticalCrossedBeltDriveModel;
}

function beltParameters(distanceMm: number): Record<string, QuantityValue> {
  return {
    'driver-radius': quantity(brownPulleyRadiusMm, 'mm'),
    'driven-radius': quantity(brownPulleyRadiusMm, 'mm'),
    'center-distance': quantity(distanceMm, 'mm'),
  };
}

function evaluateBelt(current: 'belt-open' | 'belt-crossed', distanceMm: number): ModelState {
  return beltCompiled[current].createSession().evaluate({
    coordinates: { 'driver-angle': quantity(angleDeg(), 'deg') },
    rates: { 'driver-angle': quantity(1, 'rad/s') },
    parameters: beltParameters(distanceMm),
  });
}

function sceneInputs(): {
  model: SimulationModel;
  state: ModelState;
  parameters: Record<string, QuantityValue>;
} {
  const current = choice();
  if (current === 'fourbar') {
    return { model: canonicalFourBarModel, state: evaluateFourBar(), parameters: {} };
  }
  const distance = centerDistanceMm();
  const state = evaluateBelt(current, distance);
  if (hasErrors(state)) throw new TypeError('Committed production regression state must remain physically valid');
  return {
    model: beltModel(current),
    state,
    parameters: beltParameters(distance),
  };
}

function dispatchInput(input: HTMLInputElement): void {
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const renderer = createSvgMechanismRenderer(host, {
  instanceId: 'renderer-v0-regression',
  keyboardParameterAxis: 'y',
  callbacks: {
    onSelect(id) {
      selectedId = id;
      selectionElement.textContent = `Selected: ${id}`;
      render();
    },
    onInputDrag(point) {
      angleInput.value = String(normalizedDegrees((Math.atan2(point.y, point.x) * 180) / Math.PI));
      invalidParameterHandle = undefined;
      dispatchInput(angleInput);
    },
    onParameterDrag(point) {
      const current = choice();
      if (current === 'fourbar') return;
      parameterDragCount += 1;
      const candidate = Math.max(50, Math.min(280, point.y * 1000));
      const candidateState = evaluateBelt(current, candidate);
      host.dataset.parameterDragCount = String(parameterDragCount);
      host.dataset.lastParameterWorldY = String(point.y);
      host.dataset.lastParameterCandidateMm = String(candidate);
      host.dataset.lastParameterValidity = hasErrors(candidateState) || candidate < brownPulleyRadiusMm * 2
        ? 'invalid'
        : 'valid';
      if (hasErrors(candidateState) || candidate < brownPulleyRadiusMm * 2) {
        invalidParameterHandle = point;
        const diagnostic = candidateState.diagnostics.find((item) => item.severity === 'error');
        statusElement.textContent = `Invalid geometry: ${diagnostic?.message ?? 'pulley rims overlap'}`;
        render();
        return;
      }
      distanceInput.value = String(candidate);
      invalidParameterHandle = undefined;
      dispatchInput(distanceInput);
    },
    onNudgeInput(deltaDegrees) {
      angleInput.value = String(normalizedDegrees(angleDeg() + deltaDegrees));
      invalidParameterHandle = undefined;
      dispatchInput(angleInput);
    },
  },
});

function render(): void {
  const inputs = sceneInputs();
  renderer.update(buildMechanismScene({
    ...inputs,
    selectedId,
    fourBarTrace,
    invalidParameterHandle,
  }));
  host.dataset.angle = String(angleDeg());
  host.dataset.mechanism = choice();
}

mechanismSelect.addEventListener('change', () => {
  selectedId = undefined;
  invalidParameterHandle = undefined;
  render();
});
angleInput.addEventListener('input', () => {
  invalidParameterHandle = undefined;
  render();
});
distanceInput.addEventListener('input', () => {
  invalidParameterHandle = undefined;
  render();
});

declare global {
  interface Window {
    __atlasProductionRenderer: {
      exportSvg(): string;
      domNodeCount(): number;
    };
  }
}

window.__atlasProductionRenderer = {
  exportSvg: () => renderer.exportSvg(),
  domNodeCount: () => renderer.domNodeCount(),
};

render();
