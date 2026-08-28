import {
  canonicalNumber,
  isParameterReference,
  validateSimulationModel,
  type BodyId,
  type BodyState,
  type CompiledModel,
  type ConfigurationId,
  type CoordinateId,
  type CoordinateState,
  type Diagnostic,
  type EvaluationRequest,
  type FeatureRef,
  type JointDefinition,
  type ModelCapabilities,
  type ModelSession,
  type ModelState,
  type ParameterId,
  type PlanarPoseValue,
  type PointFeatureDefinition,
  type Pose2D,
  type QuantityKind,
  type QuantityValue,
  type RigidBodyDefinition,
  type ScalarSource,
  type SessionOptions,
  type SessionSnapshot,
  type SignalValue,
  type SimulationAdapter,
  type SimulationModel,
  type Vector2,
} from '@atlasmechanica/model';
import {
  add2,
  alignTwoPoints2,
  angularCross,
  bodyOriginAccelerationFromPoint,
  bodyOriginVelocityFromPoint,
  bodyPointAcceleration,
  bodyPointVelocity,
  cross2,
  magnitude2,
  rotate2,
  scale2,
  subtract2,
  worldPoint2,
} from './planarRigidBody.js';

const CAPABILITIES: ModelCapabilities = {
  position: 'exact',
  velocity: 'analytic',
  acceleration: 'analytic',
  force: 'unavailable',
  dynamics: 'unavailable',
  events: 'unavailable',
};

const GEOMETRY_EPSILON = 1e-12;
const SINGULARITY_EPSILON = 1e-12;

interface ResolvedParameter {
  value: number;
  kind: QuantityKind;
}

type ParameterValues = Record<ParameterId, ResolvedParameter>;

interface FourBarContext {
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

interface CircleIntersectionResult {
  points: Vector2[];
  tangent: boolean;
}

function errorDiagnostic(
  code: Diagnostic['code'],
  message: string,
  context?: Diagnostic['context'],
): Diagnostic {
  const diagnostic: Diagnostic = { severity: 'error', code, message };
  if (context !== undefined) diagnostic.context = context;
  return diagnostic;
}

function warningDiagnostic(
  code: Diagnostic['code'],
  message: string,
  context?: Diagnostic['context'],
): Diagnostic {
  const diagnostic: Diagnostic = { severity: 'warning', code, message };
  if (context !== undefined) diagnostic.context = context;
  return diagnostic;
}

function invalidState(
  model: SimulationModel,
  configuration: ConfigurationId,
  diagnostic: Diagnostic,
): ModelState {
  return {
    model: model.id,
    configuration,
    coordinates: {},
    bodies: {},
    signals: {},
    modes: {},
    diagnostics: [diagnostic],
  };
}

function scalar(value: number, unit: 'rad' | 'rad/s' | 'rad/s^2'): SignalValue {
  return { type: 'scalar', value: { value, unit } };
}

function vector(value: Vector2, unit: 'm' | 'm/s' | 'm/s^2'): SignalValue {
  return { type: 'vector2', value, unit };
}

function resolveScalar(
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

function resolveParameters(
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

function resolvePose(
  body: RigidBodyDefinition,
  parameters: ParameterValues,
): Pose2D {
  return {
    x: resolveScalar(body.referencePose.x, parameters, 'length'),
    y: resolveScalar(body.referencePose.y, parameters, 'length'),
    angle: resolveScalar(body.referencePose.angle, parameters, 'angle'),
  };
}

function resolvePoseValue(value: PlanarPoseValue): Pose2D {
  return {
    x: canonicalNumber(value.x, 'length'),
    y: canonicalNumber(value.y, 'length'),
    angle: canonicalNumber(value.angle, 'angle'),
  };
}

function resolvePoint(
  feature: PointFeatureDefinition,
  parameters: ParameterValues,
): Vector2 {
  return {
    x: resolveScalar(feature.position.x, parameters, 'length'),
    y: resolveScalar(feature.position.y, parameters, 'length'),
  };
}

function getPointFeature(
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

function discoverFourBar(model: SimulationModel): FourBarContext | undefined {
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

  const jointFeatureIds = new Set([couplerCrank.feature, couplerRocker.feature]);
  const tracerFeature = Object.values(mechanical.bodies[couplerBody]?.features ?? {}).find(
    (feature) => feature.type === 'point' && !jointFeatureIds.has(feature.id),
  );

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

function circleIntersections(
  centerA: Vector2,
  radiusA: number,
  centerB: Vector2,
  radiusB: number,
): CircleIntersectionResult | undefined {
  const centerDelta = subtract2(centerB, centerA);
  const distance = magnitude2(centerDelta);

  if (radiusA <= 0 || radiusB <= 0 || distance <= GEOMETRY_EPSILON) {
    return undefined;
  }

  if (
    distance > radiusA + radiusB + GEOMETRY_EPSILON ||
    distance < Math.abs(radiusA - radiusB) - GEOMETRY_EPSILON
  ) {
    return undefined;
  }

  const x =
    (radiusA ** 2 - radiusB ** 2 + distance ** 2) / (2 * distance);
  const heightSquared = radiusA ** 2 - x ** 2;
  if (heightSquared < -GEOMETRY_EPSILON) return undefined;

  const direction = scale2(centerDelta, 1 / distance);
  const base = add2(centerA, scale2(direction, x));
  const height = Math.sqrt(Math.max(0, heightSquared));
  if (height <= GEOMETRY_EPSILON) {
    return { points: [base], tangent: true };
  }

  const perpendicular = { x: -direction.y, y: direction.x };
  const offset = scale2(perpendicular, height);
  return {
    points: [add2(base, offset), subtract2(base, offset)],
    tangent: false,
  };
}

function solve2x2(
  a11: number,
  a12: number,
  a21: number,
  a22: number,
  b1: number,
  b2: number,
): readonly [number, number] | undefined {
  const determinant = a11 * a22 - a12 * a21;
  if (Math.abs(determinant) <= SINGULARITY_EPSILON) return undefined;

  return [
    (b1 * a22 - a12 * b2) / determinant,
    (a11 * b2 - b1 * a21) / determinant,
  ];
}

function angleOf(vector: Vector2): number {
  return Math.atan2(vector.y, vector.x);
}

function signedBranch(
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

function poseSeed(
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

function computeConfigurationBranchSign(
  model: SimulationModel,
  configuration: ConfigurationId,
  context: FourBarContext,
): number {
  const parameters = resolveParameters(model, {});
  const groundDefinition = model.systems.mechanical?.bodies[context.groundBody];
  const crankDefinition = model.systems.mechanical?.bodies[context.crankBody];
  const couplerDefinition = model.systems.mechanical?.bodies[context.couplerBody];
  if (
    groundDefinition === undefined ||
    crankDefinition === undefined ||
    couplerDefinition === undefined
  ) {
    throw new TypeError('Four-bar configuration references missing bodies');
  }

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
  const sign = signedBranch(A, O4, B);
  if (sign === 0) {
    throw new TypeError(`Configuration ${configuration} does not identify an assembly branch`);
  }
  return sign;
}

function nearestPoint(points: Vector2[], target: Vector2): Vector2 {
  let best = points[0];
  if (best === undefined) throw new TypeError('Cannot choose from zero points');
  let bestDistance = magnitude2(subtract2(best, target));

  for (const point of points.slice(1)) {
    const distance = magnitude2(subtract2(point, target));
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

class AnalyticFourBarSession implements ModelSession {
  private configuration: ConfigurationId;
  private readonly defaultConfiguration: ConfigurationId;
  private readonly parameters: Partial<Record<ParameterId, QuantityValue>>;
  private branchSign: number;
  private previousB?: Vector2;

  constructor(
    private readonly compiled: AnalyticFourBarCompiledModel,
    options: SessionOptions = {},
  ) {
    const configuration =
      options.configuration ?? Object.keys(compiled.model.configurations)[0];
    if (configuration === undefined) {
      throw new TypeError('Four-bar model has no reference configuration');
    }
    if (compiled.model.configurations[configuration] === undefined) {
      throw new TypeError(`Unknown configuration ${configuration}`);
    }

    this.configuration = configuration;
    this.defaultConfiguration = configuration;
    this.parameters = { ...(options.parameters ?? {}) };
    this.branchSign = computeConfigurationBranchSign(
      compiled.model,
      configuration,
      compiled.context,
    );
  }

  evaluate(request: EvaluationRequest = {}): ModelState {
    const model = this.compiled.model;
    const context = this.compiled.context;
    const configuration = model.configurations[this.configuration];
    if (configuration === undefined) {
      throw new TypeError(`Unknown configuration ${this.configuration}`);
    }

    let parameters: ParameterValues;
    try {
      parameters = resolveParameters(model, {
        ...this.parameters,
        ...(request.parameters ?? {}),
      });
    } catch (error) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic(
          'invalid-input',
          error instanceof Error ? error.message : 'Invalid parameter input',
        ),
      );
    }

    const inputSource =
      request.coordinates?.[context.inputCoordinate] ??
      configuration.coordinates[context.inputCoordinate];
    if (inputSource === undefined) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic('missing-input', `Missing coordinate ${context.inputCoordinate}`),
      );
    }

    let inputAngle: number;
    let inputRate: number | undefined;
    let inputAcceleration: number | undefined;
    try {
      inputAngle = canonicalNumber(inputSource, 'angle');
      const rateSource = request.rates?.[context.inputCoordinate];
      const accelerationSource = request.accelerations?.[context.inputCoordinate];
      if (rateSource !== undefined) {
        inputRate = canonicalNumber(rateSource, 'angular-velocity');
      }
      if (accelerationSource !== undefined) {
        if (inputRate === undefined) {
          throw new TypeError('Input angular acceleration requires an input angular velocity');
        }
        inputAcceleration = canonicalNumber(
          accelerationSource,
          'angular-acceleration',
        );
      }
    } catch (error) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic(
          'invalid-input',
          error instanceof Error ? error.message : 'Invalid coordinate input',
        ),
      );
    }

    const mechanical = model.systems.mechanical;
    if (mechanical === undefined) {
      throw new TypeError('Compiled four-bar lost its mechanical system');
    }

    const ground = mechanical.bodies[context.groundBody];
    const crank = mechanical.bodies[context.crankBody];
    const coupler = mechanical.bodies[context.couplerBody];
    const rocker = mechanical.bodies[context.rockerBody];
    if (
      ground === undefined ||
      crank === undefined ||
      coupler === undefined ||
      rocker === undefined
    ) {
      throw new TypeError('Compiled four-bar lost a body');
    }

    const groundInputFeature = getPointFeature(model, context.groundInput);
    const crankInputFeature = getPointFeature(model, context.crankInput);
    const crankCouplerFeature = getPointFeature(model, context.crankCoupler);
    const couplerCrankFeature = getPointFeature(model, context.couplerCrank);
    const couplerRockerFeature = getPointFeature(model, context.couplerRocker);
    const rockerCouplerFeature = getPointFeature(model, context.rockerCoupler);
    const groundOutputFeature = getPointFeature(model, context.groundOutput);
    const rockerGroundFeature = getPointFeature(model, context.rockerGround);
    if (
      groundInputFeature === undefined ||
      crankInputFeature === undefined ||
      crankCouplerFeature === undefined ||
      couplerCrankFeature === undefined ||
      couplerRockerFeature === undefined ||
      rockerCouplerFeature === undefined ||
      groundOutputFeature === undefined ||
      rockerGroundFeature === undefined
    ) {
      throw new TypeError('Compiled four-bar lost a joint point feature');
    }

    let groundPose: Pose2D;
    let referenceCrankPose: Pose2D;
    let referenceInput: number;
    let localGroundInput: Vector2;
    let localGroundOutput: Vector2;
    let localCrankInput: Vector2;
    let localCrankCoupler: Vector2;
    let localCouplerCrank: Vector2;
    let localCouplerRocker: Vector2;
    let localRockerGround: Vector2;
    let localRockerCoupler: Vector2;
    try {
      groundPose = resolvePose(ground, parameters);
      referenceCrankPose =
        poseSeed(model, this.configuration, context.crankBody, parameters) ??
        resolvePose(crank, parameters);
      referenceInput = canonicalNumber(
        configuration.coordinates[context.inputCoordinate] ?? { value: 0, unit: 'rad' },
        'angle',
      );
      localGroundInput = resolvePoint(groundInputFeature, parameters);
      localGroundOutput = resolvePoint(groundOutputFeature, parameters);
      localCrankInput = resolvePoint(crankInputFeature, parameters);
      localCrankCoupler = resolvePoint(crankCouplerFeature, parameters);
      localCouplerCrank = resolvePoint(couplerCrankFeature, parameters);
      localCouplerRocker = resolvePoint(couplerRockerFeature, parameters);
      localRockerGround = resolvePoint(rockerGroundFeature, parameters);
      localRockerCoupler = resolvePoint(rockerCouplerFeature, parameters);
    } catch (error) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic(
          'invalid-model',
          error instanceof Error ? error.message : 'Invalid four-bar geometry',
        ),
      );
    }

    const O2 = worldPoint2(groundPose, localGroundInput);
    const O4 = worldPoint2(groundPose, localGroundOutput);
    const crankAngle = referenceCrankPose.angle + inputAngle - referenceInput;
    const rotatedCrankPivot = rotate2(localCrankInput, crankAngle);
    const crankPose: Pose2D = {
      x: O2.x - rotatedCrankPivot.x,
      y: O2.y - rotatedCrankPivot.y,
      angle: crankAngle,
    };
    const A = worldPoint2(crankPose, localCrankCoupler);

    const crankLength = magnitude2(subtract2(localCrankCoupler, localCrankInput));
    const couplerLength = magnitude2(subtract2(localCouplerRocker, localCouplerCrank));
    const rockerLength = magnitude2(subtract2(localRockerCoupler, localRockerGround));
    if (
      crankLength <= GEOMETRY_EPSILON ||
      couplerLength <= GEOMETRY_EPSILON ||
      rockerLength <= GEOMETRY_EPSILON
    ) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic('invalid-model', 'Four-bar links must have nonzero length'),
      );
    }

    const intersections = circleIntersections(A, couplerLength, O4, rockerLength);
    const coordinates: ModelState['coordinates'] = {
      [context.inputCoordinate]: {
        position: { value: inputAngle, unit: 'rad' },
      },
    };
    const inputCoordinateState = coordinates[context.inputCoordinate];
    if (inputCoordinateState !== undefined) {
      if (inputRate !== undefined) {
        inputCoordinateState.velocity = { value: inputRate, unit: 'rad/s' };
      }
      if (inputAcceleration !== undefined) {
        inputCoordinateState.acceleration = {
          value: inputAcceleration,
          unit: 'rad/s^2',
        };
      }
    }

    const groundState: BodyState = { pose: groundPose };
    const crankState: BodyState = { pose: crankPose };
    const bodies: ModelState['bodies'] = {
      [context.groundBody]: groundState,
      [context.crankBody]: crankState,
    };
    const signals: ModelState['signals'] = {};
    const setSignal = (id: string, signal: SignalValue): void => {
      if (model.signals[id] !== undefined) signals[id] = signal;
    };
    setSignal('point-a-position', vector(A, 'm'));
    setSignal('assembly-branch', {
      type: 'text',
      value:
        typeof configuration.modes?.assembly === 'string'
          ? configuration.modes.assembly
          : this.branchSign > 0
            ? 'positive'
            : 'negative',
    });

    if (intersections === undefined) {
      this.previousB = undefined;
      return {
        model: model.id,
        configuration: this.configuration,
        coordinates,
        bodies,
        signals,
        modes: {
          assembly: this.branchSign > 0 ? 'positive' : 'negative',
        },
        diagnostics: [
          errorDiagnostic(
            'invalid-geometry',
            'No real four-bar loop closure exists for the current parameters and input angle',
          ),
        ],
      };
    }

    let B: Vector2;
    if (intersections.points.length === 1) {
      const onlyPoint = intersections.points[0];
      if (onlyPoint === undefined) {
        throw new TypeError('Tangent intersection did not contain a point');
      }
      B = onlyPoint;
    } else {
      const matching = intersections.points.filter(
        (point) => signedBranch(A, O4, point) === this.branchSign,
      );
      if (matching.length === 1) {
        const match = matching[0];
        if (match === undefined) throw new TypeError('Missing branch intersection');
        B = match;
      } else if (this.previousB !== undefined) {
        B = nearestPoint(intersections.points, this.previousB);
      } else {
        return {
          model: model.id,
          configuration: this.configuration,
          coordinates,
          bodies,
          signals,
          modes: {},
          diagnostics: [
            errorDiagnostic(
              'branch-ambiguity',
              'Reference configuration could not select a unique four-bar assembly branch',
            ),
          ],
        };
      }
    }

    const couplerPose = alignTwoPoints2(
      localCouplerCrank,
      localCouplerRocker,
      A,
      B,
    );
    const rockerPose = alignTwoPoints2(
      localRockerGround,
      localRockerCoupler,
      O4,
      B,
    );
    if (couplerPose === undefined || rockerPose === undefined) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic('invalid-geometry', 'Four-bar body alignment is degenerate'),
      );
    }

    const couplerState: BodyState = { pose: couplerPose };
    const rockerState: BodyState = { pose: rockerPose };
    bodies[context.couplerBody] = couplerState;
    bodies[context.rockerBody] = rockerState;
    this.previousB = B;

    const theta2 = angleOf(subtract2(A, O2));
    const theta3 = angleOf(subtract2(B, A));
    const theta4 = angleOf(subtract2(B, O4));
    setSignal('point-b-position', vector(B, 'm'));
    setSignal('coupler-angle', scalar(theta3, 'rad'));
    setSignal('rocker-angle', scalar(theta4, 'rad'));

    const diagnostics: Diagnostic[] = [];
    if (intersections.tangent) {
      diagnostics.push(
        warningDiagnostic(
          'physical-singularity',
          'The four-bar is at a toggle/tangent configuration; derivative state may be indeterminate',
        ),
      );
    }

    const zero = { x: 0, y: 0 };
    if (inputRate !== undefined) {
      groundState.linearVelocity = zero;
      groundState.angularVelocity = 0;
      crankState.angularVelocity = inputRate;
      crankState.linearVelocity = bodyOriginVelocityFromPoint(
        crankPose,
        localCrankInput,
        zero,
        inputRate,
      );

      const velocitySolution = solve2x2(
        -couplerLength * Math.sin(theta3),
        rockerLength * Math.sin(theta4),
        couplerLength * Math.cos(theta3),
        -rockerLength * Math.cos(theta4),
        crankLength * Math.sin(theta2) * inputRate,
        -crankLength * Math.cos(theta2) * inputRate,
      );

      if (velocitySolution === undefined) {
        diagnostics.push(
          warningDiagnostic(
            'physical-singularity',
            'Four-bar velocity equations are singular at this configuration',
          ),
        );
      } else {
        const [omega3, omega4] = velocitySolution;
        const crankRadius = subtract2(A, O2);
        const velocityA = angularCross(inputRate, crankRadius);

        couplerState.angularVelocity = omega3;
        couplerState.linearVelocity = bodyOriginVelocityFromPoint(
          couplerPose,
          localCouplerCrank,
          velocityA,
          omega3,
        );
        rockerState.angularVelocity = omega4;
        rockerState.linearVelocity = bodyOriginVelocityFromPoint(
          rockerPose,
          localRockerGround,
          zero,
          omega4,
        );

        setSignal('coupler-angular-velocity', scalar(omega3, 'rad/s'));
        setSignal('rocker-angular-velocity', scalar(omega4, 'rad/s'));

        if (inputAcceleration !== undefined) {
          groundState.linearAcceleration = zero;
          groundState.angularAcceleration = 0;
          crankState.angularAcceleration = inputAcceleration;
          crankState.linearAcceleration = bodyOriginAccelerationFromPoint(
            crankPose,
            localCrankInput,
            zero,
            inputRate,
            inputAcceleration,
          );

          const accelerationSolution = solve2x2(
            -couplerLength * Math.sin(theta3),
            rockerLength * Math.sin(theta4),
            couplerLength * Math.cos(theta3),
            -rockerLength * Math.cos(theta4),
            crankLength * Math.cos(theta2) * inputRate ** 2 +
              crankLength * Math.sin(theta2) * inputAcceleration +
              couplerLength * Math.cos(theta3) * omega3 ** 2 -
              rockerLength * Math.cos(theta4) * omega4 ** 2,
            crankLength * Math.sin(theta2) * inputRate ** 2 -
              crankLength * Math.cos(theta2) * inputAcceleration +
              couplerLength * Math.sin(theta3) * omega3 ** 2 -
              rockerLength * Math.sin(theta4) * omega4 ** 2,
          );

          if (accelerationSolution === undefined) {
            diagnostics.push(
              warningDiagnostic(
                'physical-singularity',
                'Four-bar acceleration equations are singular at this configuration',
              ),
            );
          } else {
            const [alpha3, alpha4] = accelerationSolution;
            const accelerationA = add2(
              angularCross(inputAcceleration, crankRadius),
              scale2(crankRadius, -(inputRate ** 2)),
            );

            couplerState.angularAcceleration = alpha3;
            couplerState.linearAcceleration = bodyOriginAccelerationFromPoint(
              couplerPose,
              localCouplerCrank,
              accelerationA,
              omega3,
              alpha3,
            );
            rockerState.angularAcceleration = alpha4;
            rockerState.linearAcceleration = bodyOriginAccelerationFromPoint(
              rockerPose,
              localRockerGround,
              zero,
              omega4,
              alpha4,
            );

            setSignal('coupler-angular-acceleration', scalar(alpha3, 'rad/s^2'));
            setSignal('rocker-angular-acceleration', scalar(alpha4, 'rad/s^2'));
          }
        }
      }
    }

    if (context.tracer !== undefined) {
      const tracerFeature = getPointFeature(model, context.tracer);
      if (tracerFeature !== undefined) {
        const localTracer = resolvePoint(tracerFeature, parameters);
        setSignal(
          'coupler-point-position',
          vector(worldPoint2(couplerState.pose, localTracer), 'm'),
        );
        const tracerVelocity = bodyPointVelocity(couplerState, localTracer);
        if (tracerVelocity !== undefined) {
          setSignal('coupler-point-velocity', vector(tracerVelocity, 'm/s'));
        }
        const tracerAcceleration = bodyPointAcceleration(couplerState, localTracer);
        if (tracerAcceleration !== undefined) {
          setSignal(
            'coupler-point-acceleration',
            vector(tracerAcceleration, 'm/s^2'),
          );
        }
      }
    }

    return {
      model: model.id,
      configuration: this.configuration,
      coordinates,
      bodies,
      signals,
      modes: {
        assembly:
          typeof configuration.modes?.assembly === 'string'
            ? configuration.modes.assembly
            : this.branchSign > 0
              ? 'positive'
              : 'negative',
      },
      diagnostics,
    };
  }

  reset(configuration = this.defaultConfiguration): void {
    if (this.compiled.model.configurations[configuration] === undefined) {
      throw new TypeError(`Unknown configuration ${configuration}`);
    }
    this.configuration = configuration;
    this.branchSign = computeConfigurationBranchSign(
      this.compiled.model,
      configuration,
      this.compiled.context,
    );
    this.previousB = undefined;
  }

  snapshot(): SessionSnapshot {
    return {
      configuration: this.configuration,
      parameters: { ...this.parameters },
      modes: {
        assembly:
          typeof this.compiled.model.configurations[this.configuration]?.modes?.assembly ===
          'string'
            ? (this.compiled.model.configurations[this.configuration]?.modes?.assembly as string)
            : this.branchSign > 0
              ? 'positive'
              : 'negative',
        branchSign: this.branchSign,
      },
    };
  }
}

class AnalyticFourBarCompiledModel implements CompiledModel {
  readonly capabilities = CAPABILITIES;

  constructor(
    readonly model: SimulationModel,
    readonly context: FourBarContext,
  ) {}

  createSession(options: SessionOptions = {}): ModelSession {
    return new AnalyticFourBarSession(this, options);
  }
}

export const analyticFourBarAdapter: SimulationAdapter = {
  id: 'atlas.analytic-four-bar.v0',

  supports(model): boolean {
    return discoverFourBar(model) !== undefined;
  },

  compile(model): CompiledModel {
    const diagnostics = validateSimulationModel(model);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      throw new TypeError(
        diagnostics.map((diagnostic) => diagnostic.message).join('; '),
      );
    }

    const context = discoverFourBar(model);
    if (context === undefined) {
      throw new TypeError('Model is not supported by the analytic four-bar adapter');
    }

    for (const configuration of Object.keys(model.configurations)) {
      computeConfigurationBranchSign(model, configuration, context);
    }

    return new AnalyticFourBarCompiledModel(model, context);
  },
};
