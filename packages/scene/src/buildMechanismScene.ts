import {
  canonicalNumber,
  isParameterReference,
  type ModelState,
  type ParameterId,
  type QuantityKind,
  type QuantityValue,
  type ScalarSource,
  type SimulationModel,
} from '@atlasmechanica/model';
import type {
  CirclePrimitive,
  MechanismScene,
  ScenePrimitive,
  Vec2,
} from './types.js';
import { assertMechanismScene } from './types.js';

export interface SceneBuildOptions {
  model: SimulationModel;
  state: ModelState;
  parameters?: Partial<Record<ParameterId, QuantityValue>> | undefined;
  selectedId?: string | undefined;
  fourBarTrace?: Vec2[] | undefined;
  invalidParameterHandle?: Vec2 | undefined;
}

function resolveScalar(
  model: SimulationModel,
  parameters: Partial<Record<ParameterId, QuantityValue>>,
  source: ScalarSource,
  kind: QuantityKind,
): number {
  if (isParameterReference(source)) {
    const definition = model.parameters[source.parameter];
    if (definition === undefined) throw new TypeError(`Unknown parameter ${source.parameter}`);
    return canonicalNumber(parameters[source.parameter] ?? definition.default, kind);
  }
  return canonicalNumber(source, kind);
}

function rotate(point: Vec2, angle: number): Vec2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
  };
}

function worldPoint(pose: { x: number; y: number; angle: number }, local: Vec2): Vec2 {
  const rotated = rotate(local, pose.angle);
  return { x: pose.x + rotated.x, y: pose.y + rotated.y };
}

function featurePoint(
  model: SimulationModel,
  state: ModelState,
  parameters: Partial<Record<ParameterId, QuantityValue>>,
  bodyId: string,
  featureId: string,
): Vec2 {
  const body = model.systems.mechanical?.bodies[bodyId];
  const pose = state.bodies[bodyId]?.pose;
  const feature = body?.features[featureId];
  if (body === undefined || pose === undefined || feature === undefined) {
    throw new TypeError(`Missing ${bodyId}.${featureId} presentation geometry`);
  }
  const local = feature.type === 'point'
    ? feature.position
    : feature.type === 'axis'
      ? feature.origin
      : feature.center;
  return worldPoint(pose, {
    x: resolveScalar(model, parameters, local.x, 'length'),
    y: resolveScalar(model, parameters, local.y, 'length'),
  });
}

function pulleyGeometry(
  model: SimulationModel,
  state: ModelState,
  parameters: Partial<Record<ParameterId, QuantityValue>>,
  bodyId: string,
): { center: Vec2; radius: number } {
  const body = model.systems.mechanical?.bodies[bodyId];
  const feature = body?.features.pulley;
  if (feature?.type !== 'pulley') throw new TypeError(`Missing ${bodyId} pulley feature`);
  return {
    center: featurePoint(model, state, parameters, bodyId, 'pulley'),
    radius: resolveScalar(model, parameters, feature.pitchRadius, 'length'),
  };
}

function signalVector(state: ModelState, id: string): Vec2 | undefined {
  const signal = state.signals[id];
  return signal?.type === 'vector2' ? signal.value : undefined;
}

function signalScalar(state: ModelState, id: string): number | undefined {
  const signal = state.signals[id];
  return signal?.type === 'scalar' ? signal.value.value : undefined;
}

function signalText(state: ModelState, id: string): string | undefined {
  const signal = state.signals[id];
  return signal?.type === 'text' ? signal.value : undefined;
}

function normalizedPositive(angle: number): number {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function sampleArc(
  center: Vec2,
  start: Vec2,
  end: Vec2,
  expectedAngle: number,
  samples = 36,
): Vec2[] {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const ccw = normalizedPositive(endAngle - startAngle);
  const cw = ccw - Math.PI * 2;
  const delta = Math.abs(Math.abs(ccw) - expectedAngle) <= Math.abs(Math.abs(cw) - expectedAngle)
    ? ccw
    : cw;
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    const angle = startAngle + delta * t;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

function parameterMillimeters(
  model: SimulationModel,
  parameters: Partial<Record<ParameterId, QuantityValue>>,
  id: ParameterId,
): number {
  const definition = model.parameters[id];
  if (definition === undefined) return 0;
  return canonicalNumber(parameters[id] ?? definition.default, definition.kind) * 1000;
}

function buildFourBar(options: SceneBuildOptions): MechanismScene {
  const { model, state, selectedId, fourBarTrace = [] } = options;
  const parameters = options.parameters ?? {};
  const O2 = featurePoint(model, state, parameters, 'ground', 'O2');
  const O4 = featurePoint(model, state, parameters, 'ground', 'O4');
  const A = signalVector(state, 'point-a-position');
  const B = signalVector(state, 'point-b-position');
  const tracer = signalVector(state, 'coupler-point-position');
  if (A === undefined || B === undefined || tracer === undefined) {
    throw new TypeError('Four-bar state missing presentation signals');
  }
  const tracerVelocity = signalVector(state, 'coupler-point-velocity');
  const primitives: ScenePrimitive[] = [
    { type: 'segment', id: 'fourbar-ground', layer: 'background', styles: ['ground'], a: O2, b: O4, width: 3, selectId: 'ground', ariaLabel: 'Ground link' },
    { type: 'polyline', id: 'fourbar-trace', layer: 'trace', styles: ['trace'], points: fourBarTrace, width: 1.5, ariaLabel: 'Coupler point trace' },
    { type: 'segment', id: 'fourbar-crank', layer: 'mechanism', styles: ['body'], a: O2, b: A, width: 7, selectId: 'crank', ariaLabel: 'Crank link' },
    { type: 'segment', id: 'fourbar-coupler', layer: 'mechanism', styles: ['body'], a: A, b: B, width: 7, selectId: 'coupler', ariaLabel: 'Coupler link' },
    { type: 'segment', id: 'fourbar-rocker', layer: 'mechanism', styles: ['body'], a: O4, b: B, width: 7, selectId: 'rocker', ariaLabel: 'Rocker link' },
    ...[O2, A, B, O4].map((center, index): CirclePrimitive => ({ type: 'circle', id: `fourbar-joint-${index}`, layer: 'mechanism', styles: ['joint'], center, radius: 0.0045, width: 2, ariaLabel: 'Revolute joint' })),
    { type: 'circle', id: 'fourbar-tracer', layer: 'mechanism', styles: ['tracer'], center: tracer, radius: 0.0038, width: 2, ariaLabel: 'Coupler tracer point' },
    { type: 'dimension', id: 'fourbar-dimension', layer: 'annotation', styles: ['dimension'], a: { x: O2.x, y: -0.027 }, b: { x: O4.x, y: -0.027 }, text: `${parameterMillimeters(model, parameters, 'ground-length').toFixed(0)} mm`, ariaLabel: 'Ground link dimension' },
    { type: 'label', id: 'fourbar-branch-label', layer: 'annotation', styles: ['label'], at: { x: -0.038, y: 0.104 }, text: `${signalText(state, 'assembly-branch') ?? 'open'} assembly`, ariaLabel: 'Assembly branch' },
    { type: 'handle', id: 'fourbar-input-handle', layer: 'interaction', styles: ['handle'], at: A, handle: 'input', bindingId: 'driver-angle', shape: 'circle', ariaLabel: 'Drag crank input angle' },
  ];
  if (tracerVelocity !== undefined) {
    primitives.push({
      type: 'vector',
      id: 'fourbar-velocity',
      layer: 'annotation',
      styles: ['vector'],
      from: tracer,
      to: {
        x: tracer.x + tracerVelocity.x * 0.22,
        y: tracer.y + tracerVelocity.y * 0.22,
      },
      ariaLabel: 'Coupler point velocity vector',
    });
  }
  return {
    id: 'fourbar',
    title: 'Canonical four-bar crank-rocker',
    viewport: { minX: -0.045, maxX: 0.155, minY: -0.065, maxY: 0.125 },
    primitives,
    selectedId,
  };
}

function buildBelt(options: SceneBuildOptions): MechanismScene {
  const { model, state, selectedId, invalidParameterHandle } = options;
  const parameters = options.parameters ?? {};
  const driver = pulleyGeometry(model, state, parameters, 'driver');
  const driven = pulleyGeometry(model, state, parameters, 'driven');
  const driverA = signalVector(state, 'driver-contact-a');
  const drivenA = signalVector(state, 'driven-contact-a');
  const driverB = signalVector(state, 'driver-contact-b');
  const drivenB = signalVector(state, 'driven-contact-b');
  const driverWrap = signalScalar(state, 'driver-wrap-angle');
  const drivenWrap = signalScalar(state, 'driven-wrap-angle');
  if ([driverA, drivenA, driverB, drivenB, driverWrap, drivenWrap].some((value) => value === undefined)) {
    throw new TypeError('Belt state missing derived tangent geometry');
  }
  const dA = driverA as Vec2;
  const rA = drivenA as Vec2;
  const dB = driverB as Vec2;
  const rB = drivenB as Vec2;
  const beltPath = [
    dA,
    rA,
    ...sampleArc(driven.center, rA, rB, drivenWrap as number).slice(1),
    dB,
    ...sampleArc(driver.center, dB, dA, driverWrap as number).slice(1),
  ];
  const driverAngle = state.bodies.driver?.pose.angle ?? 0;
  const drivenAngle = state.bodies.driven?.pose.angle ?? 0;
  const driverMark = {
    x: driver.center.x + driver.radius * Math.cos(driverAngle),
    y: driver.center.y + driver.radius * Math.sin(driverAngle),
  };
  const drivenMark = {
    x: driven.center.x + driven.radius * Math.cos(drivenAngle),
    y: driven.center.y + driven.radius * Math.sin(drivenAngle),
  };
  const direction = signalText(state, 'output-direction') ?? 'same';
  const ratio = signalScalar(state, 'angular-ratio') ?? 0;
  const primitives: ScenePrimitive[] = [
    { type: 'polyline', id: 'belt-path', layer: 'mechanism', styles: ['belt'], points: beltPath, width: 4, ariaLabel: 'Ideal belt pitch path' },
    { type: 'circle', id: 'belt-driver', layer: 'mechanism', styles: ['pulley'], center: driver.center, radius: driver.radius, width: 4, selectId: 'driver', ariaLabel: 'Driver pulley' },
    { type: 'circle', id: 'belt-driven', layer: 'mechanism', styles: ['pulley'], center: driven.center, radius: driven.radius, width: 4, selectId: 'driven', ariaLabel: 'Driven pulley' },
    { type: 'segment', id: 'belt-driver-mark', layer: 'mechanism', styles: ['body'], a: driver.center, b: driverMark, width: 2, selectId: 'driver', ariaLabel: 'Driver phase mark' },
    { type: 'segment', id: 'belt-driven-mark', layer: 'mechanism', styles: ['body'], a: driven.center, b: drivenMark, width: 2, selectId: 'driven', ariaLabel: 'Driven phase mark' },
    { type: 'dimension', id: 'belt-distance', layer: 'annotation', styles: ['dimension'], a: { x: driver.center.x, y: -0.105 }, b: { x: driven.center.x, y: -0.105 }, text: `${parameterMillimeters(model, parameters, 'center-distance').toFixed(0)} mm`, ariaLabel: 'Pulley center distance' },
    { type: 'label', id: 'belt-ratio-label', layer: 'annotation', styles: ['label'], at: { x: -0.047, y: 0.107 }, text: `${direction} · ratio ${ratio.toFixed(3)}`, ariaLabel: 'Transmission direction and ratio' },
    { type: 'handle', id: 'belt-input-handle', layer: 'interaction', styles: ['handle'], at: driverMark, handle: 'input', bindingId: 'driver-angle', shape: 'circle', ariaLabel: 'Drag driver input angle' },
    { type: 'handle', id: 'belt-distance-handle', layer: 'interaction', styles: ['handle'], at: driven.center, handle: 'parameter', bindingId: 'center-distance', shape: 'square', ariaLabel: 'Drag pulley center distance' },
  ];
  if (invalidParameterHandle !== undefined) {
    primitives.push({
      type: 'handle',
      id: 'belt-invalid-handle',
      layer: 'feedback',
      styles: ['invalid'],
      at: invalidParameterHandle,
      handle: 'invalid',
      shape: 'square',
      ariaLabel: 'Invalid proposed pulley center',
    });
  }
  return {
    id: `belt-${direction}`,
    title: `${direction === 'same' ? 'Open' : 'Crossed'} belt drive`,
    viewport: { minX: -0.06, maxX: 0.285, minY: -0.13, maxY: 0.13 },
    primitives,
    selectedId,
  };
}

export function buildMechanismScene(options: SceneBuildOptions): MechanismScene {
  let scene: MechanismScene;
  switch (options.model.subject) {
    case 'four-bar-linkage':
      scene = buildFourBar(options);
      break;
    case 'belt-drive':
      scene = buildBelt(options);
      break;
    default:
      throw new TypeError(`No production scene compiler for model subject ${options.model.subject}`);
  }
  assertMechanismScene(scene);
  return scene;
}
