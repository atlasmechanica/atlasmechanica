import {
  canonicalNumber,
  isParameterReference,
  type BodyId,
  type ConfigurationId,
  type CoordinateId,
  type FeatureRef,
  type JointDefinition,
  type ParameterId,
  type PlanarPoseValue,
  type PointFeatureDefinition,
  type Pose2D,
  type QuantityKind,
  type QuantityValue,
  type RigidBodyDefinition,
  type ScalarSource,
  type SimulationModel,
  type Vector2,
} from '@atlasmechanica/model';
import { cross2, subtract2, worldPoint2 } from './planarRigidBody.js';

export interface ResolvedParameter {
  value: number;
  kind: QuantityKind;
}

export type ParameterValues = Record<ParameterId, ResolvedParameter>;

export interface FourBarContext {
  inputCoordinate: CoordinateId;
  groundBody: BodyId;
  crankBody: BodyId;
  couplerBody: BodyId;
  rockerBody: BodyId;
  groundInput: FeatureRef;
  crankInput: FeatureRef;
  crankCoupler: FeatureRef;
  couplerCrank: FeatureRef;
  couplerRocker: FeatureRef;
  rockerCoupler: FeatureRef;
  groundOutput: FeatureRef;
  rockerGround: FeatureRef;
  tracer?: FeatureRef;
}

export function resolveScalar(
  source: ScalarSource,
  parameters: ParameterValues,
  kind: QuantityKind,
): number {
  if (isParameterReference(source)) {
    const resolved = parameters[source.parameter];
    if (resolved === undefined) {
      throw new TypeError(`Missing resolved parameter ${source.parameter}`);
    }
    if (resolved.kind !== kind) {
      throw new TypeError(
        `Parameter ${source.parameter} is ${resolved.kind}, not ${kind}`,
      );
    }
    return resolved.value;
  }

  return canonicalNumber(source, kind);
}

export function resolveParameters(
  model: SimulationModel,
  overrides: Partial<Record<ParameterId, QuantityValue>>,
): ParameterValues {
  const values: ParameterValues = {};

  for (const [id, definition] of Object.entries(model.parameters)) {
    const authored = overrides[id] ?? definition.default;
    const value = canonicalNumber(authored, definition.kind);

    if (definition.domain?.min !== undefined) {
      const minimum = canonicalNumber(definition.domain.min, definition.kind);
      if (value < minimum) {
        throw new RangeError(`${id} must be >= ${minimum} in canonical units`);
      }
    }

    if (definition.domain?.max !== undefined) {
      const maximum = canonicalNumber(definition.domain.max, definition.kind);
      if (value > maximum) {
        throw new RangeError(`${id} must be <= ${maximum} in canonical units`);
      }
    }

    values[id] = { value, kind: definition.kind };
  }

  return values;
}

export function resolvePose(
  body: RigidBodyDefinition,
  parameters: ParameterValues,
): Pose2D {
  return {
    x: resolveScalar(body.referencePose.x, parameters, 'length'),
    y: resolveScalar(body.referencePose.y, parameters, 'length'),
    angle: resolveScalar(body.referencePose.angle, parameters, 'angle'),
  };
}

export function resolvePoseValue(value: PlanarPoseValue): Pose2D {
  return {
    x: canonicalNumber(value.x, 'length'),
    y: canonicalNumber(value.y, 'length'),
    angle: canonicalNumber(value.angle, 'angle'),
  };
}

export function resolvePoint(
  feature: PointFeatureDefinition,
  parameters: ParameterValues,
): Vector2 {
  return {
    x: resolveScalar(feature.position.x, parameters, 'length'),
    y: resolveScalar(feature.position.y, parameters, 'length'),
  };
}

export function getPointFeature(
  model: SimulationModel,
  ref: FeatureRef,
): PointFeatureDefinition | undefined {
  const feature = model.systems.mechanical?.bodies[ref.body]?.features[ref.feature];
  return feature?.type === 'point' ? feature : undefined;
}

function otherBody(joint: JointDefinition, body: BodyId): BodyId | undefined {
  if (joint.parent.body === body) return joint.child.body;
  if (joint.child.body === body) return joint.parent.body;
  return undefined;
}

function featureForBody(
  joint: JointDefinition,
  body: BodyId,
): FeatureRef | undefined {
  if (joint.parent.body === body) return joint.parent;
  if (joint.child.body === body) return joint.child;
  return undefined;
}

function jointsForBody(
  joints: Record<string, JointDefinition>,
  body: BodyId,
): JointDefinition[] {
  return Object.values(joints).filter(
    (joint) => joint.parent.body === body || joint.child.body === body,
  );
}

export function discoverFourBar(model: SimulationModel): FourBarContext | undefined {
  const mechanical = model.systems.mechanical;
  if (mechanical === undefined || mechanical.dimensionality !== 'planar') {
    return undefined;
  }
  if (Object.keys(mechanical.bodies).length !== 4) return undefined;
  if (Object.keys(mechanical.joints).length !== 4) return undefined;
  if (Object.keys(mechanical.couplings).length !== 0) return undefined;

  const inputs = Object.values(model.coordinates).filter(
    (coordinate) => coordinate.role === 'input' && coordinate.joint !== undefined,
  );
  if (inputs.length !== 1) return undefined;

  const inputCoordinate = inputs[0];
  if (inputCoordinate === undefined || inputCoordinate.joint === undefined) {
    return undefined;
  }

  const inputJoint = mechanical.joints[inputCoordinate.joint];
  if (inputJoint === undefined) return undefined;

  const groundBody = mechanical.referenceBody;
  const crankBody = otherBody(inputJoint, groundBody);
  if (crankBody === undefined) return undefined;

  const crankOtherJoints = jointsForBody(mechanical.joints, crankBody).filter(
    (joint) => joint.id !== inputJoint.id,
  );
  if (crankOtherJoints.length !== 1) return undefined;
  const crankCouplerJoint = crankOtherJoints[0];
  if (crankCouplerJoint === undefined) return undefined;

  const couplerBody = otherBody(crankCouplerJoint, crankBody);
  if (couplerBody === undefined || couplerBody === groundBody) return undefined;

  const groundOtherJoints = jointsForBody(mechanical.joints, groundBody).filter(
    (joint) => joint.id !== inputJoint.id,
  );
  if (groundOtherJoints.length !== 1) return undefined;
  const groundRockerJoint = groundOtherJoints[0];
  if (groundRockerJoint === undefined) return undefined;

  const rockerBody = otherBody(groundRockerJoint, groundBody);
  if (
    rockerBody === undefined ||
    rockerBody === crankBody ||
    rockerBody === couplerBody
  ) {
    return undefined;
  }

  const couplerRockerJoint = Object.values(mechanical.joints).find(
    (joint) =>
      joint.id !== inputJoint.id &&
      joint.id !== crankCouplerJoint.id &&
      joint.id !== groundRockerJoint.id &&
      otherBody(joint, couplerBody) === rockerBody,
  );
  if (couplerRockerJoint === undefined) return undefined;

  const groundInput = featureForBody(inputJoint, groundBody);
  const crankInput = featureForBody(inputJoint, crankBody);
  const crankCoupler = featureForBody(crankCouplerJoint, crankBody);
  const couplerCrank = featureForBody(crankCouplerJoint, couplerBody);
  const couplerRocker = featureForBody(couplerRockerJoint, couplerBody);
  const rockerCoupler = featureForBody(couplerRockerJoint, rockerBody);
  const groundOutput = featureForBody(groundRockerJoint, groundBody);
  const rockerGround = featureForBody(groundRockerJoint, rockerBody);

  if (
    groundInput === undefined ||
    crankInput === undefined ||
    crankCoupler === undefined ||
    couplerCrank === undefined ||
    couplerRocker === undefined ||
    rockerCoupler === undefined ||
    groundOutput === undefined ||
    rockerGround === undefined
  ) {
    return undefined;
  }

  const context: FourBarContext = {
    inputCoordinate: inputCoordinate.id,
    groundBody,
    crankBody,
    couplerBody,
    rockerBody,
    groundInput,
    crankInput,
    crankCoupler,
    couplerCrank,
    couplerRocker,
    rockerCoupler,
    groundOutput,
    rockerGround,
  };

  const couplerDefinition = mechanical.bodies[couplerBody];
  if (couplerDefinition === undefined) return undefined;
  const jointFeatureIds = new Set([couplerCrank.feature, couplerRocker.feature]);
  const tracerFeature = Object.values(couplerDefinition.features).find(
    (feature) => feature.type === 'point' && !jointFeatureIds.has(feature.id),
  );
  if (tracerFeature !== undefined) {
    context.tracer = { body: couplerBody, feature: tracerFeature.id };
  }

  for (const ref of [
    context.groundInput,
    context.crankInput,
    context.crankCoupler,
    context.couplerCrank,
    context.couplerRocker,
    context.rockerCoupler,
    context.groundOutput,
    context.rockerGround,
  ]) {
    if (getPointFeature(model, ref) === undefined) return undefined;
  }

  return context;
}

export function poseSeed(
  model: SimulationModel,
  configuration: ConfigurationId,
  body: BodyId,
  parameters: ParameterValues,
): Pose2D | undefined {
  const configPose = model.configurations[configuration]?.bodyPoses?.[body];
  if (configPose !== undefined) return resolvePoseValue(configPose);

  const definition = model.systems.mechanical?.bodies[body];
  return definition === undefined ? undefined : resolvePose(definition, parameters);
}

export function branchSign(
  inputPivot: Vector2,
  outputPivot: Vector2,
  movingPivot: Vector2,
): number {
  return Math.sign(
    cross2(
      subtract2(outputPivot, inputPivot),
      subtract2(movingPivot, inputPivot),
    ),
  );
}

export function configurationBranchSign(
  model: SimulationModel,
  configuration: ConfigurationId,
  context: FourBarContext,
): number {
  const parameters = resolveParameters(model, {});
  const groundPose = poseSeed(
    model,
    configuration,
    context.groundBody,
    parameters,
  );
  const crankPose = poseSeed(
    model,
    configuration,
    context.crankBody,
    parameters,
  );
  const couplerPose = poseSeed(
    model,
    configuration,
    context.couplerBody,
    parameters,
  );
  if (groundPose === undefined || crankPose === undefined || couplerPose === undefined) {
    throw new TypeError(`Configuration ${configuration} is missing body pose seeds`);
  }

  const groundOutputFeature = getPointFeature(model, context.groundOutput);
  const crankCouplerFeature = getPointFeature(model, context.crankCoupler);
  const couplerRockerFeature = getPointFeature(model, context.couplerRocker);
  if (
    groundOutputFeature === undefined ||
    crankCouplerFeature === undefined ||
    couplerRockerFeature === undefined
  ) {
    throw new TypeError('Four-bar configuration is missing point features');
  }

  const A = worldPoint2(crankPose, resolvePoint(crankCouplerFeature, parameters));
  const O4 = worldPoint2(groundPose, resolvePoint(groundOutputFeature, parameters));
  const B = worldPoint2(couplerPose, resolvePoint(couplerRockerFeature, parameters));
  const sign = branchSign(A, O4, B);
  if (sign === 0) {
    throw new TypeError(`Configuration ${configuration} does not identify an assembly branch`);
  }
  return sign;
}
