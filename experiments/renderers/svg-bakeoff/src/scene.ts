import {
  canonicalNumber,
  isParameterReference,
  type ModelState,
  type ParameterId,
  type QuantityKind,
  type QuantityValue,
  type ScalarSource,
  type SimulationModel,
  type Vector2,
} from '@atlasmechanica/model';

export type Vec2 = Vector2;

export interface Viewport {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface PrimitiveBase {
  id: string;
  classes: string[];
  selectId?: string;
  ariaLabel?: string;
}

export interface SegmentPrimitive extends PrimitiveBase {
  type: 'segment';
  a: Vec2;
  b: Vec2;
  width?: number;
}

export interface CirclePrimitive extends PrimitiveBase {
  type: 'circle';
  center: Vec2;
  radius: number;
  width?: number;
}

export interface PolylinePrimitive extends PrimitiveBase {
  type: 'polyline';
  points: Vec2[];
  width?: number;
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
  shape?: 'circle' | 'square';
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
    throw new TypeError(`Missing ${bodyId}.${featureId} render geometry`);
  }
  const local = feature.type === 'point' ? feature.position : feature.type === 'axis' ? feature.origin : feature.center;
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
  const delta = Math.abs(Math.abs(ccw) - expectedAngle) <= Math.abs(Math.abs(cw) - expectedAngle) ? ccw : cw;
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    const angle = startAngle + delta * t;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
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
  if (A === undefined || B === undefined || tracer === undefined) throw new TypeError('Four-bar state missing render signals');
  const tracerVelocity = signalVector(state, 'coupler-point-velocity');
  const primitives: ScenePrimitive[] = [
    { type: 'segment', id: 'fourbar-ground', a: O2, b: O4, width: 3, classes: ['scene-ground'], selectId: 'ground', ariaLabel: 'Ground link' },
    { type: 'segment', id: 'fourbar-crank', a: O2, b: A, width: 7, classes: ['scene-body'], selectId: 'crank', ariaLabel: 'Crank link' },
    { type: 'segment', id: 'fourbar-coupler', a: A, b: B, width: 7, classes: ['scene-body'], selectId: 'coupler', ariaLabel: 'Coupler link' },
    { type: 'segment', id: 'fourbar-rocker', a: O4, b: B, width: 7, classes: ['scene-body'], selectId: 'rocker', ariaLabel: 'Rocker link' },
    { type: 'polyline', id: 'fourbar-trace', points: fourBarTrace, width: 1.5, classes: ['scene-trace'], ariaLabel: 'Coupler point trace' },
    ...[O2, A, B, O4].map((center, index): CirclePrimitive => ({ type: 'circle', id: `fourbar-joint-${index}`, center, radius: .0045, width: 2, classes: ['scene-joint'], ariaLabel: 'Revolute joint' })),
    { type: 'circle', id: 'fourbar-tracer', center: tracer, radius: .0038, width: 2, classes: ['scene-tracer'], ariaLabel: 'Coupler tracer point' },
    { type: 'dimension', id: 'fourbar-dimension', a: { x: O2.x, y: -.027 }, b: { x: O4.x, y: -.027 }, text: `${parameterMillimeters(model, parameters, 'ground-length').toFixed(0)} mm`, classes: ['scene-dimension'], ariaLabel: 'Ground link dimension' },
    { type: 'handle', id: 'fourbar-input-handle', at: A, handle: 'input', shape: 'circle', classes: ['scene-handle'], ariaLabel: 'Drag crank input angle' },
    { type: 'label', id: 'fourbar-branch-label', at: { x: -.038, y: .104 }, text: `${signalText(state, 'assembly-branch') ?? 'open'} assembly`, classes: ['scene-label'], ariaLabel: 'Assembly branch' },
  ];
  if (tracerVelocity !== undefined) {
    primitives.push({ type: 'vector', id: 'fourbar-velocity', from: tracer, to: { x: tracer.x + tracerVelocity.x * .22, y: tracer.y + tracerVelocity.y * .22 }, classes: ['scene-vector'], ariaLabel: 'Coupler point velocity vector' });
  }
  return { id: 'fourbar', title: 'Canonical four-bar crank-rocker', viewport: { minX: -.045, maxX: .155, minY: -.065, maxY: .125 }, primitives, selectedId };
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
  if ([driverA, drivenA, driverB, drivenB, driverWrap, drivenWrap].some((value) => value === undefined)) throw new TypeError('Belt state missing derived tangent geometry');
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
  const driverMark = { x: driver.center.x + driver.radius * Math.cos(driverAngle), y: driver.center.y + driver.radius * Math.sin(driverAngle) };
  const drivenMark = { x: driven.center.x + driven.radius * Math.cos(drivenAngle), y: driven.center.y + driven.radius * Math.sin(drivenAngle) };
  const direction = signalText(state, 'output-direction') ?? 'same';
  const ratio = signalScalar(state, 'angular-ratio') ?? 0;
  const primitives: ScenePrimitive[] = [
    { type: 'polyline', id: 'belt-path', points: beltPath, width: 4, classes: ['scene-belt'], ariaLabel: 'Ideal belt pitch path' },
    { type: 'circle', id: 'belt-driver', center: driver.center, radius: driver.radius, width: 4, classes: ['scene-pulley'], selectId: 'driver', ariaLabel: 'Driver pulley' },
    { type: 'circle', id: 'belt-driven', center: driven.center, radius: driven.radius, width: 4, classes: ['scene-pulley'], selectId: 'driven', ariaLabel: 'Driven pulley' },
    { type: 'segment', id: 'belt-driver-mark', a: driver.center, b: driverMark, width: 2, classes: ['scene-body'], selectId: 'driver', ariaLabel: 'Driver phase mark' },
    { type: 'segment', id: 'belt-driven-mark', a: driven.center, b: drivenMark, width: 2, classes: ['scene-body'], selectId: 'driven', ariaLabel: 'Driven phase mark' },
    { type: 'dimension', id: 'belt-distance', a: { x: driver.center.x, y: -.105 }, b: { x: driven.center.x, y: -.105 }, text: `${parameterMillimeters(model, parameters, 'center-distance').toFixed(0)} mm`, classes: ['scene-dimension'], ariaLabel: 'Pulley center distance' },
    { type: 'handle', id: 'belt-input-handle', at: driverMark, handle: 'input', shape: 'circle', classes: ['scene-handle'], ariaLabel: 'Drag driver input angle' },
    { type: 'handle', id: 'belt-distance-handle', at: driven.center, handle: 'parameter', shape: 'square', classes: ['scene-handle'], ariaLabel: 'Drag pulley center distance' },
    { type: 'label', id: 'belt-ratio-label', at: { x: -.047, y: .107 }, text: `${direction} · ratio ${ratio.toFixed(3)}`, classes: ['scene-label'], ariaLabel: 'Transmission direction and ratio' },
  ];
  if (invalidParameterHandle !== undefined) primitives.push({ type: 'handle', id: 'belt-invalid-handle', at: invalidParameterHandle, handle: 'invalid', shape: 'square', classes: ['scene-invalid'], ariaLabel: 'Invalid proposed pulley center' });
  return { id: `belt-${direction}`, title: `${direction === 'same' ? 'Open' : 'Crossed'} belt drive`, viewport: { minX: -.06, maxX: .285, minY: -.13, maxY: .13 }, primitives, selectedId };
}

export function buildMechanismScene(options: SceneBuildOptions): MechanismScene {
  return options.model.subject === 'four-bar-linkage' ? buildFourBar(options) : buildBelt(options);
}
