import {
  buildLabEvaluationRequest,
  controlLabel,
  defaultLabValues,
  formatLabReadout,
  type LabControlDefinition,
  type LabDisplayUnit,
  type LabInteractionDefinition,
  type LabView,
} from '@atlasmechanica/lab';
import { loadMechanismLab } from '@atlasmechanica/lab/lazy-runtime';
import { hasErrors, type EvaluationRequest, type ModelState } from '@atlasmechanica/model';
import { createSvgMechanismRenderer } from '@atlasmechanica/renderer-svg';
import type { ThreeMechanismRenderer } from '@atlasmechanica/renderer-three';
import type { HandlePrimitive, MechanismScene, Vec2 } from '@atlasmechanica/scene';
import {
  loadRegisteredThreeRenderer,
  type LoadedThreeRendererModule,
} from './threeRendererRegistry.js';

const desktopBreakpoint = '(min-width: 641px)';
const desktopViewportMaxHeightPx = 520;
const desktopViewportMinHeightPx = 160;
const desktopViewportBottomClearancePx = 18;
const rendererAspect = 8 / 5;
const zoomMinimum = 0.6;
const zoomMaximum = 2.4;
const zoomStep = 0.2;

function required<T extends Element>(element: T | null, name: string): T {
  if (element === null) throw new TypeError(`Mechanism lab is missing ${name}`);
  return element;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrapRange(value: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0)) return value;
  return ((value - min) % span + span) % span + min;
}

function precisionForStep(step: number): number {
  if (step >= 1) return 0;
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : Math.min(6, text.length - dot - 1);
}

function displayControlValue(control: LabControlDefinition, value: number): string {
  const body = value.toFixed(precisionForStep(control.step));
  if (control.unit === 'deg') return `${body}°`;
  if (control.unit === 'rpm') return `${body} rpm`;
  return `${body} ${control.unit}`;
}

function rateInCoordinateUnitsPerSecond(
  rate: number,
  rateUnit: LabDisplayUnit,
  coordinateUnit: LabDisplayUnit,
): number {
  let radiansPerSecond: number;
  if (rateUnit === 'rpm') radiansPerSecond = rate * Math.PI * 2 / 60;
  else if (rateUnit === 'rad/s') radiansPerSecond = rate;
  else if (rateUnit === 'deg/s') radiansPerSecond = rate * Math.PI / 180;
  else throw new TypeError(`Unsupported animation rate unit ${rateUnit}`);

  if (coordinateUnit === 'rad') return radiansPerSecond;
  if (coordinateUnit === 'deg') return radiansPerSecond * 180 / Math.PI;
  throw new TypeError(`Unsupported animated coordinate unit ${coordinateUnit}`);
}

function interactionValue(
  control: LabControlDefinition,
  interaction: LabInteractionDefinition,
  point: Vec2,
): number {
  if (interaction.mapping.type === 'axis-value') {
    return point[interaction.mapping.axis] * interaction.mapping.scale;
  }

  const [originX, originY] = interaction.mapping.origin;
  const radians = Math.atan2(point.y - originY, point.x - originX);
  if (control.unit === 'rad') return wrapRange(radians, control.min, control.max);
  if (control.unit === 'deg') {
    return wrapRange(radians * 180 / Math.PI, control.min, control.max);
  }
  throw new TypeError(`Polar-angle interaction ${control.id} requires angle units`);
}

function collectByData<T extends HTMLElement>(root: HTMLElement, attribute: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const element of root.querySelectorAll<T>(`[${attribute}]`)) {
    const id = element.getAttribute(attribute);
    if (id !== null) result.set(id, element);
  }
  return result;
}

for (const root of document.querySelectorAll<HTMLElement>('[data-mechanism-lab]')) {
  const modelId = root.dataset.modelId;
  const adapterId = root.dataset.adapterId;
  const labId = root.dataset.labId;
  if (modelId === undefined || adapterId === undefined) {
    throw new TypeError('Mechanism lab requires model and adapter ids');
  }

  root.setAttribute('aria-busy', 'true');
  void loadMechanismLab(modelId, adapterId, labId).then((resolved) => {
  const { definition, model, adapter, sceneCompiler } = resolved;
  const compiled = adapter.compile(model);
  const viewport = required(root.querySelector<HTMLElement>('[data-lab-viewport]'), 'camera viewport');
  const camera = required(root.querySelector<HTMLElement>('[data-lab-camera]'), 'camera');
  const host2d = required(root.querySelector<HTMLElement>('[data-renderer]'), '2D renderer host');
  const host3d = root.querySelector<HTMLElement>('[data-renderer-three]') ?? undefined;
  const view2dButton = root.querySelector<HTMLButtonElement>('[data-view-2d]') ?? undefined;
  const view3dButton = root.querySelector<HTMLButtonElement>('[data-view-3d]') ?? undefined;
  const playButton = root.querySelector<HTMLButtonElement>('[data-play]') ?? undefined;
  const resetButton = required(root.querySelector<HTMLButtonElement>('[data-reset]'), 'reset button');
  const zoomOutButton = required(root.querySelector<HTMLButtonElement>('[data-zoom-out]'), 'zoom-out button');
  const zoomFitButton = required(root.querySelector<HTMLButtonElement>('[data-zoom-fit]'), 'fit-view button');
  const zoomInButton = required(root.querySelector<HTMLButtonElement>('[data-zoom-in]'), 'zoom-in button');
  const status = required(root.querySelector<HTMLElement>('[data-status]'), 'status region');
  const controlInputs = collectByData<HTMLInputElement>(root, 'data-control-id');
  const controlOutputs = collectByData<HTMLOutputElement>(root, 'data-control-output-id');
  const readoutOutputs = collectByData<HTMLElement>(root, 'data-readout-id');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktopLayout = window.matchMedia(desktopBreakpoint);
  const defaults = defaultLabValues(definition);
  const params = new URLSearchParams(window.location.search);
  const values: Record<string, number> = { ...defaults };

  for (const control of definition.controls) {
    if (control.queryKey === undefined) continue;
    const raw = params.get(control.queryKey);
    if (raw === null) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) values[control.id] = clamp(parsed, control.min, control.max);
  }

  for (const control of definition.controls) {
    const input = required(controlInputs.get(control.id) ?? null, `control ${control.id}`);
    input.value = String(values[control.id] ?? control.initial);
  }

  const sessionOptions = definition.sessionConfiguration === undefined
    ? undefined
    : { configuration: definition.sessionConfiguration };
  const session = compiled.createSession(sessionOptions);

  function evaluate(nextValues: Readonly<Record<string, number>> = values): {
    state: ModelState;
    request: EvaluationRequest;
  } {
    const request = buildLabEvaluationRequest(definition, nextValues);
    const state = session.evaluate(request);
    return { state, request };
  }

  let evaluated = evaluate();
  let currentState = evaluated.state;
  let currentRequest = evaluated.request;
  let currentScene: MechanismScene = sceneCompiler.build({
    model,
    state: currentState,
    parameters: currentRequest.parameters,
  });
  let zoom = 1;
  let viewMode: LabView = '2d';
  let requestedViewMode: LabView = '2d';
  let threeRenderer: ThreeMechanismRenderer | undefined;
  let threeRendererPromise: Promise<ThreeMechanismRenderer> | undefined;
  let threeRendererLoadAttempt = 0;
  let invalidParameterHandle: Vec2 | undefined;
  let selectedId: string | undefined;
  let playing = false;
  let animationFrame = 0;
  let previousTime = 0;
  let fitFrame = 0;

  function syncControlOutputs(): void {
    for (const control of definition.controls) {
      const value = values[control.id] ?? control.initial;
      const input = controlInputs.get(control.id);
      const output = controlOutputs.get(control.id);
      if (input !== undefined) input.value = String(value);
      if (output !== undefined) output.value = displayControlValue(control, value);
    }
  }

  function syncReadouts(): void {
    for (const readout of definition.readouts) {
      const output = readoutOutputs.get(readout.id);
      if (output !== undefined) output.textContent = formatLabReadout(readout, currentState);
    }
  }

  function syncUrl(): void {
    const query = new URLSearchParams();
    for (const control of definition.controls) {
      if (control.queryKey === undefined) continue;
      const value = values[control.id] ?? control.initial;
      if (Math.abs(value - control.initial) <= Math.max(control.step * 1e-6, 1e-9)) continue;
      query.set(control.queryKey, String(Number(value.toFixed(6))));
    }
    const next = `${window.location.pathname}${query.size > 0 ? `?${query.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  }

  function syncViewControls(): void {
    const is2d = viewMode === '2d';
    root.dataset.viewMode = viewMode;
    view2dButton?.setAttribute('aria-pressed', String(is2d));
    view3dButton?.setAttribute('aria-pressed', String(!is2d));
    if (is2d) {
      camera.style.setProperty('--lab-zoom', String(zoom));
      camera.dataset.zoom = zoom.toFixed(2);
      root.dataset.zoom = zoom.toFixed(2);
      zoomFitButton.textContent = `${Math.round(zoom * 100)}%`;
      zoomFitButton.setAttribute('aria-label', 'Fit mechanism to viewport');
      zoomOutButton.disabled = zoom <= zoomMinimum + 1e-9;
      zoomInButton.disabled = zoom >= zoomMaximum - 1e-9;
    } else {
      camera.style.setProperty('--lab-zoom', '1');
      camera.dataset.zoom = '1.00';
      root.dataset.zoom = '1.00';
      zoomFitButton.textContent = 'Front';
      zoomFitButton.setAttribute('aria-label', 'Return 3D camera to front view');
      zoomOutButton.disabled = false;
      zoomInButton.disabled = false;
    }
  }

  function applyZoom(next: number, announce = false): void {
    zoom = clamp(Math.round(next * 100) / 100, zoomMinimum, zoomMaximum);
    syncViewControls();
    if (announce) {
      status.textContent = Math.abs(zoom - 1) < 1e-9
        ? 'Mechanism fitted to the viewport.'
        : `Diagram zoom ${Math.round(zoom * 100)}%.`;
    }
  }

  function fitViewportToWindow(): void {
    if (!desktopLayout.matches) {
      viewport.style.removeProperty('height');
      camera.style.removeProperty('width');
      camera.style.removeProperty('height');
      delete root.dataset.fitViewportHeight;
      delete root.dataset.fitCameraWidth;
      return;
    }

    const viewportTop = viewport.getBoundingClientRect().top;
    const remainingHeight = window.innerHeight - viewportTop - desktopViewportBottomClearancePx;
    const targetHeight = clamp(
      remainingHeight,
      desktopViewportMinHeightPx,
      desktopViewportMaxHeightPx,
    );
    const cameraWidth = Math.min(viewport.clientWidth, targetHeight * rendererAspect);
    const cameraHeight = cameraWidth / rendererAspect;

    viewport.style.height = `${cameraHeight}px`;
    camera.style.width = `${cameraWidth}px`;
    camera.style.height = `${cameraHeight}px`;
    root.dataset.fitViewportHeight = cameraHeight.toFixed(2);
    root.dataset.fitCameraWidth = cameraWidth.toFixed(2);
  }

  function scheduleViewportFit(): void {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitViewportToWindow);
  }

  function interactionControl(
    handle: Exclude<HandlePrimitive['handle'], 'invalid'>,
    bindingId?: string,
  ): LabControlDefinition | undefined {
    if (bindingId !== undefined) {
      const bound = definition.controls.find((control) => control.id === bindingId);
      if (bound === undefined) {
        throw new TypeError(`Scene handle references unknown lab control ${bindingId}`);
      }
      if (bound.interaction?.handle !== handle) {
        throw new TypeError(`Scene handle ${bindingId} is incompatible with ${handle} interaction`);
      }
      return bound;
    }
    return definition.controls.find((control) => control.interaction?.handle === handle);
  }

  function render(): void {
    currentScene = sceneCompiler.build({
      model,
      state: currentState,
      parameters: currentRequest.parameters,
      selectedId,
      invalidParameterHandle,
    });
    renderer2d.update(currentScene);
    if (viewMode === '3d') threeRenderer?.update(currentScene);
    syncControlOutputs();
    syncReadouts();
  }

  function acceptValues(nextValues: Record<string, number>, message?: string): boolean {
    const candidate = evaluate(nextValues);
    if (hasErrors(candidate.state)) {
      const diagnostic = candidate.state.diagnostics.find((item) => item.severity === 'error');
      status.textContent = diagnostic?.message ?? 'That configuration is not physically valid.';
      return false;
    }
    Object.assign(values, nextValues);
    currentState = candidate.state;
    currentRequest = candidate.request;
    invalidParameterHandle = undefined;
    if (message !== undefined) status.textContent = message;
    render();
    syncUrl();
    return true;
  }

  const renderer2d = createSvgMechanismRenderer(host2d, {
    instanceId: definition.id.replaceAll(/[^a-zA-Z0-9_-]/g, '-'),
    ...(definition.renderer2d?.keyboardParameterAxis === undefined
      ? {}
      : { keyboardParameterAxis: definition.renderer2d.keyboardParameterAxis }),
    ...(definition.renderer2d?.responsiveStrokeReferenceWidth === undefined
      ? {}
      : { responsiveStrokeReferenceWidth: definition.renderer2d.responsiveStrokeReferenceWidth }),
    callbacks: {
      onSelect(id) {
        selectedId = id;
        status.textContent = `Selected ${id}.`;
        render();
      },
      onInputDrag(point, bindingId) {
        const control = interactionControl('input', bindingId);
        const interaction = control?.interaction;
        if (control === undefined || interaction?.handle !== 'input') return;
        const value = interactionValue(control, interaction, point);
        const next = { ...values, [control.id]: value };
        acceptValues(next, `${controlLabel(control, model)} changed by direct manipulation.`);
      },
      onParameterDrag(point, bindingId) {
        const control = interactionControl('parameter', bindingId);
        const interaction = control?.interaction;
        if (control === undefined || interaction?.handle !== 'parameter') return;
        const value = interactionValue(control, interaction, point);
        if (value < control.min || value > control.max) {
          invalidParameterHandle = point;
          status.textContent = `${controlLabel(control, model)} is outside the allowed exploration range.`;
          render();
          return;
        }
        const next = { ...values, [control.id]: value };
        if (!acceptValues(next, `${controlLabel(control, model)} changed.`)) {
          invalidParameterHandle = point;
          render();
        }
      },
      onNudgeInput(deltaDegrees, bindingId) {
        const control = interactionControl('input', bindingId);
        if (control === undefined || control.kind !== 'coordinate') return;
        const delta = control.unit === 'rad' ? deltaDegrees * Math.PI / 180 : deltaDegrees;
        const current = values[control.id] ?? control.initial;
        const value = wrapRange(current + delta, control.min, control.max);
        acceptValues({ ...values, [control.id]: value });
      },
    },
  });

  function loadThreeRendererModule(): Promise<LoadedThreeRendererModule> {
    const rendererId = definition.threeRendererId;
    if (rendererId === undefined) {
      return Promise.reject(new TypeError(`Mechanism lab ${definition.id} has no 3D renderer binding`));
    }
    const attempt = threeRendererLoadAttempt;
    threeRendererLoadAttempt += 1;
    return loadRegisteredThreeRenderer(rendererId, attempt);
  }

  async function ensureThreeRenderer(): Promise<ThreeMechanismRenderer> {
    if (threeRenderer !== undefined) return threeRenderer;
    if (threeRendererPromise !== undefined) return threeRendererPromise;
    if (host3d === undefined) throw new TypeError('Mechanism lab has no 3D renderer host');

    const pending = loadThreeRendererModule().then(({ createThreeMechanismRenderer, loaderVariant }) => {
      root.dataset.threeLoaderVariant = loaderVariant;
      let created: ThreeMechanismRenderer | undefined;
      try {
        created = createThreeMechanismRenderer(host3d, {
          ariaLabel: root.getAttribute('aria-label') ?? 'Interactive 3D mechanism',
        });
        created.update(currentScene);
        threeRenderer = created;
        return created;
      } catch (error) {
        created?.destroy();
        throw error;
      }
    });
    threeRendererPromise = pending.catch((error: unknown) => {
      threeRendererPromise = undefined;
      throw error;
    });
    return threeRendererPromise;
  }

  async function switchView(next: LabView): Promise<void> {
    requestedViewMode = next;
    if (next === viewMode) {
      if (next === '2d') {
        if (host3d !== undefined) host3d.hidden = true;
        host2d.hidden = false;
        syncViewControls();
        root.removeAttribute('aria-busy');
      }
      return;
    }
    if (next === '2d') {
      viewMode = '2d';
      if (host3d !== undefined) host3d.hidden = true;
      host2d.hidden = false;
      syncViewControls();
      root.removeAttribute('aria-busy');
      status.textContent = '2D reference view. Drag the mechanism or change a parameter.';
      return;
    }
    if (!definition.views.includes('3d') || host3d === undefined || view3dButton === undefined) return;

    view3dButton.disabled = true;
    root.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading 3D mechanism view…';
    try {
      const renderer3d = await ensureThreeRenderer();
      if (requestedViewMode !== '3d') {
        host3d.hidden = true;
        host2d.hidden = false;
        return;
      }
      viewMode = '3d';
      host2d.hidden = true;
      host3d.hidden = false;
      renderer3d.update(currentScene);
      syncViewControls();
      status.textContent = '3D view. Drag to orbit, scroll or pinch to zoom, and right-drag to pan.';
    } catch (error) {
      if (requestedViewMode === '3d') {
        viewMode = '2d';
        host3d.hidden = true;
        host2d.hidden = false;
        syncViewControls();
        status.textContent = '3D view is unavailable in this browser. The 2D mechanism remains active.';
        console.error(error);
      }
    } finally {
      view3dButton.disabled = false;
      root.removeAttribute('aria-busy');
    }
  }

  function setPlaying(next: boolean): void {
    playing = next;
    if (playButton !== undefined) {
      playButton.setAttribute('aria-pressed', String(playing));
      playButton.textContent = playing ? 'Pause' : 'Play';
    }
    if (!playing) {
      cancelAnimationFrame(animationFrame);
      previousTime = 0;
    }
  }

  function tick(time: number): void {
    if (!playing || definition.animation === undefined) return;
    const coordinate = definition.controls.find(
      (control) => control.id === definition.animation?.coordinateControlId,
    );
    const rate = definition.controls.find(
      (control) => control.id === definition.animation?.rateControlId,
    );
    if (coordinate?.kind !== 'coordinate' || rate?.kind !== 'rate') return;

    if (previousTime !== 0) {
      const dt = Math.min((time - previousTime) / 1000, 0.05);
      const current = values[coordinate.id] ?? coordinate.initial;
      const speed = values[rate.id] ?? rate.initial;
      const delta = rateInCoordinateUnitsPerSecond(speed, rate.unit, coordinate.unit) * dt;
      const value = wrapRange(current + delta, coordinate.min, coordinate.max);
      const next = { ...values, [coordinate.id]: value };
      const candidate = evaluate(next);
      if (!hasErrors(candidate.state)) {
        Object.assign(values, next);
        currentState = candidate.state;
        currentRequest = candidate.request;
        render();
      }
    }
    previousTime = time;
    animationFrame = requestAnimationFrame(tick);
  }

  playButton?.addEventListener('click', () => {
    if (playing) {
      setPlaying(false);
      syncUrl();
      return;
    }
    if (reducedMotion.matches) {
      status.textContent = 'Animation is paused because reduced motion is enabled. Scrub or drag the mechanism instead.';
      return;
    }
    setPlaying(true);
    status.textContent = 'Playing at the selected input speed.';
    animationFrame = requestAnimationFrame(tick);
  });

  resetButton.addEventListener('click', () => {
    setPlaying(false);
    for (const control of definition.controls) values[control.id] = control.initial;
    selectedId = undefined;
    invalidParameterHandle = undefined;
    session.reset(definition.sessionConfiguration);
    evaluated = evaluate();
    currentState = evaluated.state;
    currentRequest = evaluated.request;
    applyZoom(1);
    threeRenderer?.resetMotionPhase();
    render();
    if (viewMode === '3d') threeRenderer?.fitView();
    status.textContent = viewMode === '3d'
      ? 'Reset to the reference configuration and front 3D view.'
      : 'Reset to the reference configuration and fitted view.';
    syncUrl();
  });

  view2dButton?.addEventListener('click', () => { void switchView('2d'); });
  view3dButton?.addEventListener('click', () => { void switchView('3d'); });

  zoomOutButton.addEventListener('click', () => {
    if (viewMode === '3d') threeRenderer?.zoomBy(0.84);
    else applyZoom(zoom - zoomStep, true);
  });
  zoomFitButton.addEventListener('click', () => {
    if (viewMode === '3d') {
      threeRenderer?.fitView();
      status.textContent = '3D camera returned to the front view.';
    } else {
      applyZoom(1, true);
    }
  });
  zoomInButton.addEventListener('click', () => {
    if (viewMode === '3d') threeRenderer?.zoomBy(1.19);
    else applyZoom(zoom + zoomStep, true);
  });

  viewport.addEventListener('wheel', (event) => {
    if (viewMode !== '2d' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    applyZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1), false);
  }, { passive: false });

  for (const control of definition.controls) {
    const input = controlInputs.get(control.id);
    if (input === undefined) continue;
    input.addEventListener('input', () => {
      const candidateValue = clamp(Number(input.value), control.min, control.max);
      const previous = values[control.id] ?? control.initial;
      const next = { ...values, [control.id]: candidateValue };
      if (!acceptValues(next)) {
        input.value = String(previous);
      }
    });
  }

  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && playing) {
      setPlaying(false);
      status.textContent = 'Animation paused because reduced motion was enabled.';
    }
  });

  window.addEventListener('resize', scheduleViewportFit);
  desktopLayout.addEventListener('change', scheduleViewportFit);

  applyZoom(1);
  render();
  scheduleViewportFit();
  root.removeAttribute('aria-busy');
  }).catch((error: unknown) => {
    root.removeAttribute('aria-busy');
    const status = root.querySelector<HTMLElement>('[data-status]');
    if (status !== null) status.textContent = 'The interactive mechanism could not be initialized.';
    console.error(error);
  });
}
