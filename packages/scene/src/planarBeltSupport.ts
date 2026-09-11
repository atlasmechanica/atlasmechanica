import { analyticBeltAdapter } from '@atlasmechanica/kinematics';
import {
  normalizeParameterQuantity, resolveParameterValues, validateSimulationModel,
  type ModelState, type PulleyFeatureDefinition, type RigidBodyDefinition,
  type SimulationModel,
} from '@atlasmechanica/model';
import type { SceneBuildOptions } from './buildMechanismScene.js';

interface PulleyBinding {
  readonly body: RigidBodyDefinition;
  readonly pulley: PulleyFeatureDefinition;
  readonly coordinate: string;
}

/** The deliberately bounded two-pulley capability, not a catalog identity. */
export interface PlanarBeltTopology {
  readonly routing: 'open' | 'crossed';
  readonly driver: PulleyBinding;
  readonly driven: PulleyBinding;
  readonly distanceParameter: string;
  readonly layout: 'horizontal' | 'vertical';
}

function requireCondition(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new TypeError(`Unsupported planar belt structure: ${detail}`);
}
function keys(value: object, expected: readonly string[], detail: string): void {
  requireCondition(Object.keys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key)), detail);
}
function zero(value: unknown, kind: 'length' | 'angle'): boolean {
  try { return normalizeParameterQuantity(value, kind).value === 0; }
  catch { return false; }
}
function parameter(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === 1 && Object.hasOwn(fields, 'parameter') && typeof fields.parameter === 'string'
    ? fields.parameter : undefined;
}
function origin(value: { x: unknown; y: unknown }): boolean {
  return zero(value.x, 'length') && zero(value.y, 'length');
}

/**
 * Resolve semantic roles from the actual coupling/joints/features. Named body,
 * feature, coordinate and parameter slots are bindings, not item allowlists.
 * This profile supports centered fixed pulleys on positive X or Y separation.
 * The wider analytic adapter's support predicate alone is not a scene contract.
 */
export function resolvePlanarBeltTopology(model: SimulationModel): PlanarBeltTopology {
  requireCondition(model.subject === 'belt-drive', 'expected the belt-drive physical family');
  requireCondition(validateSimulationModel(model).every((item) => item.severity !== 'error'), 'invalid physical model');
  keys(model.systems, ['mechanical'], 'only the planar mechanical system is supported');
  const system = model.systems.mechanical;
  requireCondition(system?.dimensionality === 'planar', 'expected planar dimensionality');
  requireCondition(Object.keys(system.couplings).length === 1, 'expected one belt coupling');
  const coupling = Object.values(system.couplings)[0]!;
  requireCondition(coupling.type === 'belt' && (coupling.routing === 'open' || coupling.routing === 'crossed'), 'unsupported routing');
  requireCondition(coupling.driver.body !== coupling.driven.body
    && coupling.driver.body !== system.referenceBody && coupling.driven.body !== system.referenceBody,
  'ground, driver and driven bodies must be distinct');
  keys(system.bodies, [system.referenceBody, coupling.driver.body, coupling.driven.body], 'expected ground and two pulley bodies');
  requireCondition(coupling.inputCoordinate !== coupling.outputCoordinate, 'input and output coordinates must be distinct');
  keys(model.coordinates, [coupling.inputCoordinate, coupling.outputCoordinate], 'expected exactly two angle coordinates');
  requireCondition(Object.keys(system.joints).length === 2, 'expected two revolute bearings');
  const ground = system.bodies[system.referenceBody]!;
  requireCondition(origin(ground.referencePose) && zero(ground.referencePose.angle, 'angle'), 'ground must define the unrotated origin');
  const parentFeatures: string[] = [];
  const radiusParameters: string[] = [];
  const bind = (role: 'driver' | 'driven'): PulleyBinding => {
    const ref = coupling[role];
    const body = system.bodies[ref.body]!;
    const coordinate = role === 'driver' ? coupling.inputCoordinate : coupling.outputCoordinate;
    const definition = model.coordinates[coordinate]!;
    requireCondition(definition.type === 'angle' && definition.unit === 'rad' && definition.periodic === true
      && definition.role === (role === 'driver' ? 'input' : 'output'), `${role} coordinate semantics`);
    const bearings = Object.values(system.joints).filter((joint) => joint.coordinate === coordinate);
    requireCondition(bearings.length === 1, `${role} must have one coordinate-bound bearing`);
    const bearing = bearings[0]!;
    requireCondition(bearing.type === 'revolute' && definition.joint === bearing.id
      && bearing.parent.body === ground.id && bearing.child.body === body.id, `${role} bearing bindings`);
    const pulley = body.features[ref.feature];
    requireCondition(pulley?.type === 'pulley' && origin(pulley.center), `${role} pulley must be centered on its body origin`);
    const radius = parameter(pulley.pitchRadius);
    requireCondition(radius !== undefined, `${role} pitch radius must bind a length parameter`);
    radiusParameters.push(radius);
    keys(body.features, [ref.feature, bearing.child.feature], `${role} must contain only its pulley and shaft`);
    const shaft = body.features[bearing.child.feature];
    const support = ground.features[bearing.parent.feature];
    requireCondition(shaft?.type === 'axis' && support?.type === 'axis' && origin(shaft.origin), `${role} shaft must be centered`);
    for (const axis of [shaft, support]) {
      requireCondition(axis.direction.length === 3 && axis.direction[0] === 0 && axis.direction[1] === 0
        && Number.isFinite(axis.direction[2]) && axis.direction[2] > 0, `${role} shaft must point along positive Z`);
    }
    requireCondition(zero(body.referencePose.angle, 'angle'), `${role} reference orientation must be unrotated`);
    for (const axis of ['x', 'y'] as const) {
      const source = body.referencePose[axis], fixed = support.origin[axis];
      requireCondition((zero(source, 'length') && zero(fixed, 'length'))
        || (parameter(source) !== undefined && parameter(source) === parameter(fixed)), `${role} fixed bearing center must match body origin`);
    }
    parentFeatures.push(bearing.parent.feature);
    return { body, pulley, coordinate };
  };
  const driver = bind('driver'), driven = bind('driven');
  keys(ground.features, parentFeatures, 'ground must contain exactly the two shaft supports');
  requireCondition(new Set(parentFeatures).size === 2, 'shaft supports must be distinct');
  requireCondition(origin(driver.body.referencePose), 'driver center must be the origin');
  const pose = driven.body.referencePose;
  const horizontal = parameter(pose.x) !== undefined && zero(pose.y, 'length');
  const vertical = parameter(pose.y) !== undefined && zero(pose.x, 'length');
  requireCondition(horizontal || vertical, 'driven center must use one separation parameter along X or Y');
  const distanceParameter = parameter(horizontal ? pose.x : pose.y)!;
  const ids = [...radiusParameters, distanceParameter];
  requireCondition(new Set(ids).size === 3, 'radii and separation must have independent parameter bindings');
  keys(model.parameters, ids, 'only two radii and separation are supported');
  requireCondition(ids.every((id) => model.parameters[id]?.kind === 'length'), 'geometry parameters must be lengths');
  const defaults = resolveParameterValues(model.parameters);
  requireCondition(ids.every((id) => defaults[id]!.value > 0), 'geometry defaults must be positive');

  const signals = {
    'angular-ratio': ['scalar', 'dimensionless', '1'],
    'output-direction': ['text', undefined, undefined],
    'belt-linear-speed': ['scalar', 'velocity', 'm/s'],
    'belt-travel': ['scalar', 'length', 'm'],
    'straight-span-length': ['scalar', 'length', 'm'],
    'driver-wrap-angle': ['scalar', 'angle', 'rad'],
    'driven-wrap-angle': ['scalar', 'angle', 'rad'],
    'belt-length': ['scalar', 'length', 'm'],
    'validity-margin': ['scalar', 'length', 'm'],
    'driver-contact-a': ['vector2', 'length', 'm'],
    'driven-contact-a': ['vector2', 'length', 'm'],
    'driver-contact-b': ['vector2', 'length', 'm'],
    'driven-contact-b': ['vector2', 'length', 'm'],
  } as const;
  keys(model.signals, Object.keys(signals), 'expected the analytic belt signal contract');
  for (const [id, [valueType, kind, unit]] of Object.entries(signals)) {
    const signal = model.signals[id]!;
    requireCondition(signal.id === id && signal.valueType === valueType && signal.kind === kind && signal.unit === unit, `signal ${id}`);
  }
  requireCondition(Object.keys(model.configurations).length > 0, 'a reference configuration is required');
  for (const configuration of Object.values(model.configurations)) {
    keys(configuration.coordinates, [driver.coordinate, driven.coordinate], 'configurations must define both pulley phases');
    for (const coordinate of [driver.coordinate, driven.coordinate]) normalizeParameterQuantity(configuration.coordinates[coordinate], 'angle');
    requireCondition(Object.keys(configuration.bodyPoses ?? {}).length === 0
      && Object.keys(configuration.modes ?? {}).length === 0, 'body-pose seeds and modes are not supported by this fixed-center capability');
  }
  return { routing: coupling.routing, driver, driven, distanceParameter, layout: horizontal ? 'horizontal' : 'vertical' };
}

export function supportsPlanarBeltScene(model: SimulationModel): boolean {
  try { resolvePlanarBeltTopology(model); return true; }
  catch { return false; }
}

/** Exact deterministic data comparison; reject non-finite values, including NaN. */
function sameStateData(actual: unknown, expected: unknown): boolean {
  if (typeof expected === 'number') return Number.isFinite(expected) && actual === expected;
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual) !== Array.isArray(expected)) return false;
  const a = actual as Record<string, unknown>, b = expected as Record<string, unknown>;
  const names = Object.keys(b);
  return Object.keys(a).length === names.length && names.every((key) => Object.hasOwn(a, key) && sameStateData(a[key], b[key]));
}

/**
 * Recheck the adapter-owned state against this exact model/configuration and
 * effective parameters before either planar scene path consumes its geometry.
 * Reuses the existing analytic solver, never a second routing/phase formula.
 * No identity-only or mutable-object cache can hide changed topology/parameters.
 */
export function validatePlanarBeltSceneInput(options: SceneBuildOptions): PlanarBeltTopology {
  const { model, state } = options;
  const topology = resolvePlanarBeltTopology(model);
  requireCondition(state.model === model.id, 'model and state identities differ');
  requireCondition(state.diagnostics.every((item) => item.severity !== 'error'), 'requires a successful adapter state');
  requireCondition(typeof state.configuration === 'string' && Object.hasOwn(model.configurations, state.configuration), 'requires a known reference configuration');
  const parameters = resolveParameterValues(model.parameters, options.parameters ?? {});
  requireCondition(Object.values(parameters).every((value) => value.value > 0), 'effective radii and separation must be positive');
  const input = state.coordinates[topology.driver.coordinate];
  requireCondition(input !== undefined, 'missing driver state');
  const request = {
    coordinates: { [topology.driver.coordinate]: input.position },
    ...(input.velocity === undefined ? {} : { rates: { [topology.driver.coordinate]: input.velocity } }),
    ...(input.acceleration === undefined ? {} : { accelerations: { [topology.driver.coordinate]: input.acceleration } }),
  };
  const expected = analyticBeltAdapter.compile(model).createSession({ configuration: state.configuration, parameters }).evaluate(request);
  requireCondition(expected.diagnostics.every((item) => item.severity !== 'error'), 'invalid parameters or route geometry');
  for (const field of ['coordinates', 'bodies', 'signals', 'modes'] satisfies (keyof ModelState)[]) {
    requireCondition(sameStateData(state[field], expected[field]), `state ${field} do not match the model/configuration/parameters`);
  }
  return topology;
}
