import { analyticBeltAdapter, openBeltDriveModel } from '@atlasmechanica/kinematics';
import { hasErrors, quantity, type ModelState } from '@atlasmechanica/model';
import { createSvgMechanismRenderer } from '@atlasmechanica/renderer-svg';
import { buildMechanismScene, type Vec2 } from '@atlasmechanica/scene';

function required<T extends Element>(element: T | null, name: string): T {
  if (element === null) throw new TypeError(`Open belt lab is missing ${name}`);
  return element;
}

function scalarSignal(state: ModelState, id: string): number | undefined {
  const signal = state.signals[id];
  return signal?.type === 'scalar' ? signal.value.value : undefined;
}

function textSignal(state: ModelState, id: string): string | undefined {
  const signal = state.signals[id];
  return signal?.type === 'text' ? signal.value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

for (const root of document.querySelectorAll<HTMLElement>('[data-open-belt-lab]')) {
  const host = required(root.querySelector<HTMLElement>('[data-renderer]'), 'renderer host');
  const playButton = required(root.querySelector<HTMLButtonElement>('[data-play]'), 'play button');
  const resetButton = required(root.querySelector<HTMLButtonElement>('[data-reset]'), 'reset button');
  const angleInput = required(root.querySelector<HTMLInputElement>('[data-angle]'), 'angle input');
  const centerInput = required(root.querySelector<HTMLInputElement>('[data-center]'), 'center-distance input');
  const rpmInput = required(root.querySelector<HTMLInputElement>('[data-rpm]'), 'speed input');
  const status = required(root.querySelector<HTMLElement>('[data-status]'), 'status region');
  const angleOutput = required(root.querySelector<HTMLOutputElement>('[data-angle-output]'), 'angle output');
  const centerOutput = required(root.querySelector<HTMLOutputElement>('[data-center-output]'), 'center output');
  const rpmOutput = required(root.querySelector<HTMLOutputElement>('[data-rpm-output]'), 'speed output');
  const directionOutput = required(root.querySelector<HTMLElement>('[data-direction]'), 'direction readout');
  const ratioOutput = required(root.querySelector<HTMLElement>('[data-ratio]'), 'ratio readout');
  const outputRpm = required(root.querySelector<HTMLElement>('[data-output-rpm]'), 'output-speed readout');
  const beltSpeedOutput = required(root.querySelector<HTMLElement>('[data-belt-speed]'), 'belt-speed readout');
  const driverWrapOutput = required(root.querySelector<HTMLElement>('[data-driver-wrap]'), 'wrap-angle readout');
  const beltLengthOutput = required(root.querySelector<HTMLElement>('[data-belt-length]'), 'belt-length readout');

  const compiled = analyticBeltAdapter.compile(openBeltDriveModel);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const defaults = { angle: 0, center: 180, rpm: 30 } as const;
  const params = new URLSearchParams(window.location.search);

  let angleDeg = clamp(Number(params.get('angle') ?? defaults.angle) || 0, 0, 360);
  let centerMm = clamp(Number(params.get('center') ?? defaults.center) || defaults.center, 45, 260);
  let rpm = clamp(Number(params.get('rpm') ?? defaults.rpm) || defaults.rpm, 10, 120);
  let invalidParameterHandle: Vec2 | undefined;
  let selectedId: string | undefined;
  let playing = false;
  let animationFrame = 0;
  let previousTime = 0;

  angleInput.value = String(angleDeg);
  centerInput.value = String(centerMm);
  rpmInput.value = String(rpm);

  function evaluate(candidateCenter = centerMm): ModelState {
    const radiansPerSecond = rpm * Math.PI * 2 / 60;
    return compiled.createSession().evaluate({
      coordinates: { 'driver-angle': quantity(angleDeg, 'deg') },
      rates: { 'driver-angle': quantity(radiansPerSecond, 'rad/s') },
      parameters: { 'center-distance': quantity(candidateCenter, 'mm') },
    });
  }

  let currentState = evaluate();

  function syncUrl(): void {
    const query = new URLSearchParams();
    if (Math.round(angleDeg) !== defaults.angle) query.set('angle', String(Math.round(angleDeg)));
    if (Math.round(centerMm) !== defaults.center) query.set('center', String(Math.round(centerMm)));
    if (Math.round(rpm) !== defaults.rpm) query.set('rpm', String(Math.round(rpm)));
    const next = `${window.location.pathname}${query.size > 0 ? `?${query.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  }

  function updateReadouts(state: ModelState): void {
    const ratio = scalarSignal(state, 'angular-ratio') ?? 0;
    const direction = textSignal(state, 'output-direction') ?? 'same';
    const beltSpeed = scalarSignal(state, 'belt-linear-speed');
    const driverWrap = scalarSignal(state, 'driver-wrap-angle');
    const beltLength = scalarSignal(state, 'belt-length');

    angleOutput.value = `${Math.round(angleDeg)}°`;
    centerOutput.value = `${Math.round(centerMm)} mm`;
    rpmOutput.value = `${Math.round(rpm)} rpm`;
    directionOutput.textContent = direction === 'same' ? 'Same' : 'Reversed';
    ratioOutput.textContent = Math.abs(ratio).toFixed(3);
    outputRpm.textContent = `${(Math.abs(ratio) * rpm).toFixed(1)} rpm`;
    beltSpeedOutput.textContent = beltSpeed === undefined ? '—' : `${beltSpeed.toFixed(3)} m/s`;
    driverWrapOutput.textContent = driverWrap === undefined ? '—' : `${(driverWrap * 180 / Math.PI).toFixed(1)}°`;
    beltLengthOutput.textContent = beltLength === undefined ? '—' : `${(beltLength * 1000).toFixed(1)} mm`;
  }

  const renderer = createSvgMechanismRenderer(host, {
    instanceId: 'open-belt-drive-main',
    callbacks: {
      onSelect(id) {
        selectedId = id;
        status.textContent = `Selected ${id}.`;
        render();
      },
      onInputDrag(point) {
        angleDeg = normalizedDegrees(Math.atan2(point.y, point.x) * 180 / Math.PI);
        angleInput.value = String(angleDeg);
        invalidParameterHandle = undefined;
        currentState = evaluate();
        status.textContent = 'Input angle changed by direct manipulation.';
        render();
        syncUrl();
      },
      onParameterDrag(point) {
        const candidate = clamp(point.x * 1000, 20, 280);
        const candidateState = evaluate(candidate);
        if (hasErrors(candidateState)) {
          invalidParameterHandle = point;
          const diagnostic = candidateState.diagnostics.find((item) => item.severity === 'error');
          status.textContent = diagnostic?.message ?? 'That geometry is not physically valid.';
          render();
          return;
        }
        centerMm = candidate;
        centerInput.value = String(centerMm);
        invalidParameterHandle = undefined;
        currentState = candidateState;
        status.textContent = 'Center distance changed.';
        render();
        syncUrl();
      },
      onNudgeInput(deltaDegrees) {
        angleDeg = normalizedDegrees(angleDeg + deltaDegrees);
        angleInput.value = String(angleDeg);
        currentState = evaluate();
        render();
        syncUrl();
      },
    },
  });

  function render(): void {
    renderer.update(buildMechanismScene({
      model: openBeltDriveModel,
      state: currentState,
      parameters: { 'center-distance': quantity(centerMm, 'mm') },
      selectedId,
      invalidParameterHandle,
    }));
    updateReadouts(currentState);
  }

  function setPlaying(next: boolean): void {
    playing = next;
    playButton.setAttribute('aria-pressed', String(playing));
    playButton.textContent = playing ? 'Pause' : 'Play';
    if (!playing) {
      cancelAnimationFrame(animationFrame);
      previousTime = 0;
    }
  }

  function tick(time: number): void {
    if (!playing) return;
    if (previousTime !== 0) {
      const dt = Math.min((time - previousTime) / 1000, 0.05);
      angleDeg = normalizedDegrees(angleDeg + rpm * 6 * dt);
      angleInput.value = String(angleDeg);
      currentState = evaluate();
      render();
    }
    previousTime = time;
    animationFrame = requestAnimationFrame(tick);
  }

  playButton.addEventListener('click', () => {
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
    status.textContent = 'Playing at the selected driver speed.';
    animationFrame = requestAnimationFrame(tick);
  });

  resetButton.addEventListener('click', () => {
    setPlaying(false);
    angleDeg = defaults.angle;
    centerMm = defaults.center;
    rpm = defaults.rpm;
    selectedId = undefined;
    invalidParameterHandle = undefined;
    angleInput.value = String(angleDeg);
    centerInput.value = String(centerMm);
    rpmInput.value = String(rpm);
    currentState = evaluate();
    status.textContent = 'Reset to the reference configuration.';
    render();
    syncUrl();
  });

  angleInput.addEventListener('input', () => {
    angleDeg = Number(angleInput.value);
    invalidParameterHandle = undefined;
    currentState = evaluate();
    render();
    syncUrl();
  });

  centerInput.addEventListener('input', () => {
    centerMm = Number(centerInput.value);
    invalidParameterHandle = undefined;
    currentState = evaluate();
    render();
    syncUrl();
  });

  rpmInput.addEventListener('input', () => {
    rpm = Number(rpmInput.value);
    currentState = evaluate();
    render();
    syncUrl();
  });

  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && playing) {
      setPlaying(false);
      status.textContent = 'Animation paused because reduced motion was enabled.';
    }
  });

  render();
}
