import './styles.css';
import {
  analyticBeltAdapter,
  analyticFourBarAdapter,
  canonicalFourBarModel,
  crossedBeltDriveModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import {
  hasErrors,
  quantity,
  type ModelState,
  type QuantityValue,
  type SimulationModel,
} from '@atlasmechanica/model';
import { buildMechanismScene, type MechanismScene, type Vec2 } from './scene.js';
import { createJsxGraphRenderer } from './renderers/jsxGraph.js';
import { createNativeSvgRenderer } from './renderers/nativeSvg.js';
import { createSvgJsRenderer } from './renderers/svgJs.js';
import type { CandidateRenderer, RendererCallbacks, RendererFactory } from './renderers/types.js';

type MechanismChoice = 'fourbar' | 'belt-open' | 'belt-crossed';

interface UiState {
  mechanism: MechanismChoice;
  angleDeg: number;
  centerDistanceMm: number;
  selectedId?: string;
  invalidParameterHandle?: Vec2;
  playing: boolean;
}

interface BenchmarkMetric {
  singleMs: number;
  singleUpdates: number;
  msPerUpdate: number;
  thumbnailMs: number;
  thumbnailUpdates: number;
  largeTraceMs: number;
  domNodes: number;
  exportBytes: number | null;
  focusableNodes: number;
}

const mechanismSelect = document.querySelector<HTMLSelectElement>('#mechanism');
const playButton = document.querySelector<HTMLButtonElement>('#play');
const angleInput = document.querySelector<HTMLInputElement>('#angle');
const angleOutput = document.querySelector<HTMLOutputElement>('#angle-output');
const distanceControl = document.querySelector<HTMLElement>('#distance-control');
const distanceInput = document.querySelector<HTMLInputElement>('#distance');
const distanceOutput = document.querySelector<HTMLOutputElement>('#distance-output');
const statusElement = document.querySelector<HTMLElement>('#status');
const selectionElement = document.querySelector<HTMLElement>('#selection');
const nativeHost = document.querySelector<HTMLElement>('#native-host');
const svgJsHost = document.querySelector<HTMLElement>('#svgjs-host');
const jsxGraphHost = document.querySelector<HTMLElement>('#jsxgraph-host');
if (!mechanismSelect || !playButton || !angleInput || !angleOutput || !distanceControl || !distanceInput || !distanceOutput || !statusElement || !selectionElement || !nativeHost || !svgJsHost || !jsxGraphHost) {
  throw new Error('Renderer bake-off markup is incomplete');
}

const fourBarCompiled = analyticFourBarAdapter.compile(canonicalFourBarModel);
const beltCompiled = {
  'belt-open': analyticBeltAdapter.compile(openBeltDriveModel),
  'belt-crossed': analyticBeltAdapter.compile(crossedBeltDriveModel),
};

function tracePoint(state: ModelState): Vec2 {
  const signal = state.signals['coupler-point-position'];
  if (signal?.type !== 'vector2') throw new Error('Four-bar trace state missing tracer');
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

const state: UiState = {
  mechanism: 'fourbar',
  angleDeg: 0,
  centerDistanceMm: 180,
  playing: false,
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let currentScene: MechanismScene;
let currentModel: SimulationModel = canonicalFourBarModel;
let currentModelState: ModelState;
let currentParameters: Record<string, QuantityValue> = {};
let animationFrame = 0;
let lastAnimationTime = 0;

function evaluateFourBar(angleDeg: number): ModelState {
  return fourBarCompiled.createSession({ configuration: 'open' }).evaluate({
    coordinates: { 'driver-angle': quantity(angleDeg, 'deg') },
    rates: { 'driver-angle': quantity(1, 'rad/s') },
    accelerations: { 'driver-angle': quantity(0, 'rad/s^2') },
  });
}

function beltModel(choice: 'belt-open' | 'belt-crossed'): SimulationModel {
  return choice === 'belt-open' ? openBeltDriveModel : crossedBeltDriveModel;
}

function evaluateBelt(choice: 'belt-open' | 'belt-crossed', angleDeg: number, distanceMm: number): ModelState {
  return beltCompiled[choice].createSession().evaluate({
    coordinates: { 'driver-angle': quantity(angleDeg, 'deg') },
    rates: { 'driver-angle': quantity(1, 'rad/s') },
    parameters: { 'center-distance': quantity(distanceMm, 'mm') },
  });
}

function normalizedDegrees(value: number): number {
  const result = ((value % 360) + 360) % 360;
  return Math.abs(result - 360) < 1e-9 ? 0 : result;
}

function setStatus(message: string): void {
  statusElement.textContent = message;
}

function updateControls(): void {
  mechanismSelect.value = state.mechanism;
  angleInput.value = String(state.angleDeg);
  angleOutput.value = `${state.angleDeg.toFixed(1).replace('.0', '')}°`;
  distanceControl.hidden = state.mechanism === 'fourbar';
  distanceInput.value = String(state.centerDistanceMm);
  distanceOutput.value = `${state.centerDistanceMm.toFixed(0)} mm`;
  playButton.setAttribute('aria-pressed', String(state.playing));
  playButton.textContent = state.playing ? 'Pause' : 'Play';
}

function buildCurrentScene(): MechanismScene {
  if (state.mechanism === 'fourbar') {
    currentModel = canonicalFourBarModel;
    currentParameters = {};
    currentModelState = evaluateFourBar(state.angleDeg);
  } else {
    currentModel = beltModel(state.mechanism);
    currentParameters = { 'center-distance': quantity(state.centerDistanceMm, 'mm') };
    currentModelState = evaluateBelt(state.mechanism, state.angleDeg, state.centerDistanceMm);
    if (hasErrors(currentModelState)) throw new Error('Committed UI state must always be physically valid');
  }
  return buildMechanismScene({
    model: currentModel,
    state: currentModelState,
    parameters: currentParameters,
    selectedId: state.selectedId,
    fourBarTrace,
    invalidParameterHandle: state.invalidParameterHandle,
  });
}

const callbacks: RendererCallbacks = {
  onSelect(id) {
    state.selectedId = id;
    selectionElement.textContent = `Selected: ${id}`;
    render();
  },
  onInputDrag(point) {
    setAngle((Math.atan2(point.y, point.x) * 180) / Math.PI);
  },
  onParameterDrag(point) {
    if (state.mechanism === 'fourbar') return;
    tryCenterDistance(point.x * 1000, point);
  },
  onNudgeInput(deltaDegrees) {
    setAngle(state.angleDeg + deltaDegrees);
  },
};

const candidates: Array<{ factory: RendererFactory; renderer: CandidateRenderer; host: HTMLElement }> = [
  { factory: createNativeSvgRenderer, renderer: createNativeSvgRenderer(nativeHost, callbacks), host: nativeHost },
  { factory: createSvgJsRenderer, renderer: createSvgJsRenderer(svgJsHost, callbacks), host: svgJsHost },
  { factory: createJsxGraphRenderer, renderer: createJsxGraphRenderer(jsxGraphHost, callbacks), host: jsxGraphHost },
];

function render(): void {
  currentScene = buildCurrentScene();
  updateControls();
  for (const candidate of candidates) {
    candidate.renderer.update(currentScene);
    candidate.host.dataset.angle = String(state.angleDeg);
    candidate.host.dataset.mechanism = state.mechanism;
  }
}

function setAngle(value: number): void {
  state.angleDeg = normalizedDegrees(value);
  state.invalidParameterHandle = undefined;
  render();
}

function tryCenterDistance(valueMm: number, proposedPoint?: Vec2): void {
  if (state.mechanism === 'fourbar') return;
  const candidateDistance = Math.max(50, Math.min(280, valueMm));
  const candidateState = evaluateBelt(state.mechanism, state.angleDeg, candidateDistance);
  if (hasErrors(candidateState)) {
    state.invalidParameterHandle = proposedPoint ?? { x: candidateDistance / 1000, y: 0 };
    const diagnostic = candidateState.diagnostics.find((item) => item.severity === 'error');
    setStatus(`Invalid geometry: ${diagnostic?.message ?? 'no real belt tangent'}`);
    render();
    return;
  }
  state.centerDistanceMm = candidateDistance;
  state.invalidParameterHandle = undefined;
  setStatus('Valid mechanism geometry');
  render();
}

function setMechanism(choice: MechanismChoice): void {
  state.mechanism = choice;
  state.selectedId = undefined;
  selectionElement.textContent = 'Nothing selected';
  state.invalidParameterHandle = undefined;
  if (choice !== 'fourbar' && hasErrors(evaluateBelt(choice, state.angleDeg, state.centerDistanceMm))) {
    state.centerDistanceMm = 180;
  }
  setStatus(choice === 'fourbar' ? 'Analytic four-bar state' : 'Analytic belt state');
  render();
}

function stopPlaying(): void {
  state.playing = false;
  cancelAnimationFrame(animationFrame);
  updateControls();
}

function animationTick(time: number): void {
  if (!state.playing) return;
  const deltaSeconds = lastAnimationTime === 0 ? 0 : Math.min((time - lastAnimationTime) / 1000, .05);
  lastAnimationTime = time;
  state.angleDeg = normalizedDegrees(state.angleDeg + deltaSeconds * 45);
  render();
  animationFrame = requestAnimationFrame(animationTick);
}

function togglePlaying(): void {
  if (state.playing) {
    stopPlaying();
    return;
  }
  if (reducedMotion.matches) {
    setStatus('Reduced-motion preference: animation remains paused; scrub or drag instead.');
    return;
  }
  state.playing = true;
  lastAnimationTime = 0;
  updateControls();
  animationFrame = requestAnimationFrame(animationTick);
}

mechanismSelect.addEventListener('change', () => setMechanism(mechanismSelect.value as MechanismChoice));
playButton.addEventListener('click', togglePlaying);
angleInput.addEventListener('input', () => setAngle(Number(angleInput.value)));
distanceInput.addEventListener('input', () => tryCenterDistance(Number(distanceInput.value)));
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) stopPlaying(); });

function benchmarkScenes(count: number): MechanismScene[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * 360;
    const modelState = evaluateFourBar(angle);
    return buildMechanismScene({ model: canonicalFourBarModel, state: modelState, fourBarTrace });
  });
}

function largeTraceScene(base: MechanismScene): MechanismScene {
  const points = Array.from({ length: 5000 }, (_, index) => fourBarTrace[index % fourBarTrace.length] ?? { x: 0, y: 0 });
  return {
    ...base,
    primitives: base.primitives.map((primitive) => primitive.id === 'fourbar-trace' && primitive.type === 'polyline' ? { ...primitive, points } : primitive),
  };
}

const noopCallbacks: RendererCallbacks = { onSelect() {}, onInputDrag() {}, onParameterDrag() {}, onNudgeInput() {} };

async function benchmarkFactory(factory: RendererFactory, id: string): Promise<BenchmarkMetric> {
  const scenes = benchmarkScenes(180);
  const benchRoot = document.createElement('div');
  benchRoot.style.cssText = 'position:fixed;left:-12000px;top:0;width:420px;height:300px;';
  document.body.append(benchRoot);
  const host = document.createElement('div'); host.className = 'renderer-host'; host.style.width = '400px'; host.style.height = '250px'; benchRoot.append(host);
  const renderer = factory(host, noopCallbacks);
  renderer.update(scenes[0] as MechanismScene);
  const started = performance.now();
  for (let cycle = 0; cycle < 3; cycle += 1) for (const scene of scenes) renderer.update(scene);
  host.getBoundingClientRect();
  const singleMs = performance.now() - started;
  const singleUpdates = scenes.length * 3;
  const domNodes = renderer.domNodeCount();
  const exportSvg = renderer.exportSvg();
  const focusableNodes = host.querySelectorAll('[tabindex="0"],button,[role="button"],[role="slider"]').length;

  const large = largeTraceScene(scenes[0] as MechanismScene);
  const traceStart = performance.now();
  for (let index = 0; index < 20; index += 1) renderer.update(large);
  host.getBoundingClientRect();
  const largeTraceMs = performance.now() - traceStart;
  renderer.destroy(); host.remove();

  const thumbnailRoot = document.createElement('div'); thumbnailRoot.style.cssText = 'position:fixed;left:-12000px;top:0;width:320px;'; document.body.append(thumbnailRoot);
  const thumbnails: CandidateRenderer[] = [];
  for (let index = 0; index < 12; index += 1) {
    const thumbHost = document.createElement('div'); thumbHost.className = 'renderer-host'; thumbHost.style.width = '240px'; thumbHost.style.height = '150px'; thumbnailRoot.append(thumbHost);
    thumbnails.push(factory(thumbHost, noopCallbacks));
  }
  const thumbnailStart = performance.now();
  for (let frame = 0; frame < 60; frame += 1) {
    const scene = scenes[(frame * 3) % scenes.length] as MechanismScene;
    for (const thumbnail of thumbnails) thumbnail.update(scene);
  }
  thumbnailRoot.getBoundingClientRect();
  const thumbnailMs = performance.now() - thumbnailStart;
  for (const thumbnail of thumbnails) thumbnail.destroy(); thumbnailRoot.remove(); benchRoot.remove();

  return { singleMs, singleUpdates, msPerUpdate: singleMs / singleUpdates, thumbnailMs, thumbnailUpdates: 12 * 60, largeTraceMs, domNodes, exportBytes: exportSvg === null ? null : new Blob([exportSvg]).size, focusableNodes };
}

async function benchmarkAll(): Promise<Record<string, BenchmarkMetric>> {
  stopPlaying();
  const output: Record<string, BenchmarkMetric> = {};
  for (const candidate of candidates) output[candidate.renderer.id] = await benchmarkFactory(candidate.factory, candidate.renderer.id);
  render();
  return output;
}

declare global {
  interface Window {
    __atlasBakeoff: {
      benchmark(): Promise<Record<string, BenchmarkMetric>>;
      snapshot(): { mechanism: MechanismChoice; angleDeg: number; centerDistanceMm: number; selectedId?: string; exports: Record<string, number | null> };
    };
  }
}

window.__atlasBakeoff = {
  benchmark: benchmarkAll,
  snapshot() {
    const exports: Record<string, number | null> = {};
    for (const candidate of candidates) { const markup = candidate.renderer.exportSvg(); exports[candidate.renderer.id] = markup === null ? null : new Blob([markup]).size; }
    return { mechanism: state.mechanism, angleDeg: state.angleDeg, centerDistanceMm: state.centerDistanceMm, selectedId: state.selectedId, exports };
  },
};

render();
