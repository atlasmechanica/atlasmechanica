import {
  canonicalNumber,
  validateSimulationModel,
  type BodyState,
  type CompiledModel,
  type ConfigurationId,
  type CoordinateState,
  type Diagnostic,
  type EvaluationRequest,
  type ModelCapabilities,
  type ModelSession,
  type ModelState,
  type ParameterId,
  type Pose2D,
  type QuantityValue,
  type SessionOptions,
  type SessionSnapshot,
  type SignalValue,
  type SimulationAdapter,
  type SimulationModel,
  type Vector2,
} from '@atlasmechanica/model';
import {
  circleIntersections,
  solveFourBarAcceleration,
  solveFourBarVelocity,
} from './fourBarMath.js';
import {
  branchSign,
  configurationBranchSign,
  discoverFourBar,
  getPointFeature,
  poseSeed,
  resolveParameters,
  resolvePoint,
  resolvePose,
  type FourBarContext,
} from './fourBarTopology.js';
import {
  add2,
  alignTwoPoints2,
  angularCross,
  bodyOriginAccelerationFromPoint,
  bodyOriginVelocityFromPoint,
  bodyPointAcceleration,
  bodyPointVelocity,
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

function angleOf(vectorValue: Vector2): number {
  return Math.atan2(vectorValue.y, vectorValue.x);
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
  private branch: number;
  private previousB: Vector2 | undefined;

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
    this.branch = configurationBranchSign(
      compiled.model,
      configuration,
      compiled.context,
    );
  }

  private assemblyLabel(): string {
    const label = this.compiled.model.configurations[this.configuration]?.modes?.assembly;
    return typeof label === 'string'
      ? label
      : this.branch > 0
        ? 'positive'
        : 'negative';
  }

  evaluate(request: EvaluationRequest = {}): ModelState {
    const model = this.compiled.model;
    const context = this.compiled.context;
    const configuration = model.configurations[this.configuration];
    if (configuration === undefined) {
      throw new TypeError(`Unknown configuration ${this.configuration}`);
    }

    let parameters;
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
        configuration.coordinates[context.inputCoordinate] ?? {
          value: 0,
          unit: 'rad',
        },
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

    const inputCoordinate: CoordinateState = {
      position: { value: inputAngle, unit: 'rad' },
    };
    if (inputRate !== undefined) {
      inputCoordinate.velocity = { value: inputRate, unit: 'rad/s' };
    }
    if (inputAcceleration !== undefined) {
      inputCoordinate.acceleration = {
        value: inputAcceleration,
        unit: 'rad/s^2',
      };
    }

    const coordinates: ModelState['coordinates'] = {
      [context.inputCoordinate]: inputCoordinate,
    };
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
    setSignal('assembly-branch', { type: 'text', value: this.assemblyLabel() });

    const intersections = circleIntersections(A, couplerLength, O4, rockerLength);
    if (intersections === undefined) {
      this.previousB = undefined;
      return {
        model: model.id,
        configuration: this.configuration,
        coordinates,
        bodies,
        signals,
        modes: { assembly: this.assemblyLabel() },
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
        (point) => branchSign(A, O4, point) === this.branch,
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
          modes: { assembly: this.assemblyLabel() },
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

    const zero: Vector2 = { x: 0, y: 0 };
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

      const velocity = solveFourBarVelocity(
        crankLength,
        couplerLength,
        rockerLength,
        theta2,
        theta3,
        theta4,
        inputRate,
      );

      if (velocity === undefined) {
        diagnostics.push(
          warningDiagnostic(
            'physical-singularity',
            'Four-bar velocity equations are singular at this configuration',
          ),
        );
      } else {
        const crankRadius = subtract2(A, O2);
        const velocityA = angularCross(inputRate, crankRadius);

        couplerState.angularVelocity = velocity.coupler;
        couplerState.linearVelocity = bodyOriginVelocityFromPoint(
          couplerPose,
          localCouplerCrank,
          velocityA,
          velocity.coupler,
        );
        rockerState.angularVelocity = velocity.rocker;
        rockerState.linearVelocity = bodyOriginVelocityFromPoint(
          rockerPose,
          localRockerGround,
          zero,
          velocity.rocker,
        );

        setSignal(
          'coupler-angular-velocity',
          scalar(velocity.coupler, 'rad/s'),
        );
        setSignal(
          'rocker-angular-velocity',
          scalar(velocity.rocker, 'rad/s'),
        );

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

          const acceleration = solveFourBarAcceleration(
            crankLength,
            couplerLength,
            rockerLength,
            theta2,
            theta3,
            theta4,
            inputRate,
            velocity.coupler,
            velocity.rocker,
            inputAcceleration,
          );

          if (acceleration === undefined) {
            diagnostics.push(
              warningDiagnostic(
                'physical-singularity',
                'Four-bar acceleration equations are singular at this configuration',
              ),
            );
          } else {
            const accelerationA = add2(
              angularCross(inputAcceleration, crankRadius),
              scale2(crankRadius, -(inputRate ** 2)),
            );

            couplerState.angularAcceleration = acceleration.coupler;
            couplerState.linearAcceleration = bodyOriginAccelerationFromPoint(
              couplerPose,
              localCouplerCrank,
              accelerationA,
              velocity.coupler,
              acceleration.coupler,
            );
            rockerState.angularAcceleration = acceleration.rocker;
            rockerState.linearAcceleration = bodyOriginAccelerationFromPoint(
              rockerPose,
              localRockerGround,
              zero,
              velocity.rocker,
              acceleration.rocker,
            );

            setSignal(
              'coupler-angular-acceleration',
              scalar(acceleration.coupler, 'rad/s^2'),
            );
            setSignal(
              'rocker-angular-acceleration',
              scalar(acceleration.rocker, 'rad/s^2'),
            );
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
      modes: { assembly: this.assemblyLabel() },
      diagnostics,
    };
  }

  reset(configuration = this.defaultConfiguration): void {
    if (this.compiled.model.configurations[configuration] === undefined) {
      throw new TypeError(`Unknown configuration ${configuration}`);
    }
    this.configuration = configuration;
    this.branch = configurationBranchSign(
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
        assembly: this.assemblyLabel(),
        branchSign: this.branch,
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
      configurationBranchSign(model, configuration, context);
    }

    return new AnalyticFourBarCompiledModel(model, context);
  },
};
