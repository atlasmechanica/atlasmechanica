import {
  canonicalNumber,
  hasErrors,
  isParameterReference,
  validateSimulationModel,
  type BeltCouplingDefinition,
  type BodyState,
  type CompiledModel,
  type ConfigurationId,
  type Diagnostic,
  type EvaluationRequest,
  type MechanicalFeatureDefinition,
  type ModelCapabilities,
  type ModelSession,
  type ParameterId,
  type Pose2D,
  type PulleyFeatureDefinition,
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

const CAPABILITIES: ModelCapabilities = {
  position: 'exact',
  velocity: 'analytic',
  acceleration: 'analytic',
  force: 'unavailable',
  dynamics: 'unavailable',
  events: 'unavailable',
};

type ParameterValues = Record<ParameterId, number>;

interface BeltContext {
  coupling: BeltCouplingDefinition;
  driverBody: RigidBodyDefinition;
  drivenBody: RigidBodyDefinition;
  driverPulley: PulleyFeatureDefinition;
  drivenPulley: PulleyFeatureDefinition;
}

interface BeltGeometry {
  spanLength: number;
  driverWrapAngle: number;
  drivenWrapAngle: number;
  beltLength: number;
  validityMargin: number;
  driverContactA: Vector2;
  drivenContactA: Vector2;
  driverContactB: Vector2;
  drivenContactB: Vector2;
}

function scalar(value: number, unit: '1' | 'm' | 'rad' | 'm/s'): SignalValue {
  return { type: 'scalar', value: { value, unit } };
}

function point(value: Vector2): SignalValue {
  return { type: 'vector2', value, unit: 'm' };
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

function resolveScalar(
  source: ScalarSource,
  parameters: ParameterValues,
  kind: QuantityKind,
): number {
  if (isParameterReference(source)) {
    const value = parameters[source.parameter];
    if (value === undefined) {
      throw new TypeError(`Missing resolved parameter ${source.parameter}`);
    }
    return value;
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

    values[id] = value;
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

function add(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(vector: Vector2, factor: number): Vector2 {
  return { x: vector.x * factor, y: vector.y * factor };
}

function magnitude(vector: Vector2): number {
  return Math.hypot(vector.x, vector.y);
}

function worldPoint(
  pose: Pose2D,
  localX: number,
  localY: number,
): Vector2 {
  const cosine = Math.cos(pose.angle);
  const sine = Math.sin(pose.angle);

  return {
    x: pose.x + cosine * localX - sine * localY,
    y: pose.y + sine * localX + cosine * localY,
  };
}

function pulleyCenter(
  bodyPose: Pose2D,
  pulley: PulleyFeatureDefinition,
  parameters: ParameterValues,
): Vector2 {
  return worldPoint(
    bodyPose,
    resolveScalar(pulley.center.x, parameters, 'length'),
    resolveScalar(pulley.center.y, parameters, 'length'),
  );
}

function beltGeometry(
  driverCenter: Vector2,
  drivenCenter: Vector2,
  driverRadius: number,
  drivenRadius: number,
  routing: 'open' | 'crossed',
): BeltGeometry | undefined {
  const centerVector = subtract(drivenCenter, driverCenter);
  const centerDistance = magnitude(centerVector);

  if (driverRadius <= 0 || drivenRadius <= 0 || centerDistance <= 0) {
    return undefined;
  }

  const e = scale(centerVector, 1 / centerDistance);
  const perpendicular = { x: -e.y, y: e.x };

  if (routing === 'open') {
    const radiusDifference = drivenRadius - driverRadius;
    const validityMargin = centerDistance - Math.abs(radiusDifference);
    if (validityMargin <= 0) return undefined;

    const k = radiusDifference / centerDistance;
    const perpendicularScale = Math.sqrt(1 - k * k);
    const normalA = add(scale(e, -k), scale(perpendicular, perpendicularScale));
    const normalB = add(scale(e, -k), scale(perpendicular, -perpendicularScale));

    const driverContactA = add(driverCenter, scale(normalA, driverRadius));
    const drivenContactA = add(drivenCenter, scale(normalA, drivenRadius));
    const driverContactB = add(driverCenter, scale(normalB, driverRadius));
    const drivenContactB = add(drivenCenter, scale(normalB, drivenRadius));
    const spanLength = magnitude(subtract(drivenContactA, driverContactA));
    const alpha = Math.asin(k);
    const driverWrapAngle = Math.PI - 2 * alpha;
    const drivenWrapAngle = Math.PI + 2 * alpha;

    return {
      spanLength,
      driverWrapAngle,
      drivenWrapAngle,
      beltLength:
        2 * spanLength +
        driverRadius * driverWrapAngle +
        drivenRadius * drivenWrapAngle,
      validityMargin,
      driverContactA,
      drivenContactA,
      driverContactB,
      drivenContactB,
    };
  }

  const radiusSum = driverRadius + drivenRadius;
  const validityMargin = centerDistance - radiusSum;
  if (validityMargin <= 0) return undefined;

  const k = radiusSum / centerDistance;
  const perpendicularScale = Math.sqrt(1 - k * k);
  const normalA = add(scale(e, k), scale(perpendicular, perpendicularScale));
  const normalB = add(scale(e, k), scale(perpendicular, -perpendicularScale));

  const driverContactA = add(driverCenter, scale(normalA, driverRadius));
  const drivenContactA = add(drivenCenter, scale(normalA, -drivenRadius));
  const driverContactB = add(driverCenter, scale(normalB, driverRadius));
  const drivenContactB = add(drivenCenter, scale(normalB, -drivenRadius));
  const spanLength = magnitude(subtract(drivenContactA, driverContactA));
  const alpha = Math.asin(k);
  const wrapAngle = Math.PI + 2 * alpha;

  return {
    spanLength,
    driverWrapAngle: wrapAngle,
    drivenWrapAngle: wrapAngle,
    beltLength: 2 * spanLength + radiusSum * wrapAngle,
    validityMargin,
    driverContactA,
    drivenContactA,
    driverContactB,
    drivenContactB,
  };
}

function getPulleyFeature(
  body: RigidBodyDefinition,
  featureId: string,
): PulleyFeatureDefinition | undefined {
  const feature: MechanicalFeatureDefinition | undefined = body.features[featureId];
  return feature?.type === 'pulley' ? feature : undefined;
}

function getContext(model: SimulationModel): BeltContext | undefined {
  const mechanical = model.systems.mechanical;
  if (mechanical === undefined) return undefined;

  const beltCouplings = Object.values(mechanical.couplings).filter(
    (coupling): coupling is BeltCouplingDefinition => coupling.type === 'belt',
  );
  if (beltCouplings.length !== 1) return undefined;

  const coupling = beltCouplings[0];
  if (coupling === undefined) return undefined;

  const driverBody = mechanical.bodies[coupling.driver.body];
  const drivenBody = mechanical.bodies[coupling.driven.body];
  if (driverBody === undefined || drivenBody === undefined) return undefined;

  const driverPulley = getPulleyFeature(driverBody, coupling.driver.feature);
  const drivenPulley = getPulleyFeature(drivenBody, coupling.driven.feature);
  if (driverPulley === undefined || drivenPulley === undefined) return undefined;

  return { coupling, driverBody, drivenBody, driverPulley, drivenPulley };
}

class AnalyticBeltSession implements ModelSession {
  private configuration: ConfigurationId;
  private readonly defaultConfiguration: ConfigurationId;
  private parameters: Partial<Record<ParameterId, QuantityValue>>;

  constructor(
    private readonly compiled: AnalyticBeltCompiledModel,
    options: SessionOptions = {},
  ) {
    const configuration =
      options.configuration ?? Object.keys(compiled.model.configurations)[0];

    if (configuration === undefined) {
      throw new TypeError('Belt model has no reference configuration');
    }
    if (compiled.model.configurations[configuration] === undefined) {
      throw new TypeError(`Unknown configuration ${configuration}`);
    }

    this.configuration = configuration;
    this.defaultConfiguration = configuration;
    this.parameters = { ...(options.parameters ?? {}) };
  }

  evaluate(request: EvaluationRequest = {}): ReturnType<ModelSession['evaluate']> {
    const model = this.compiled.model;
    const context = this.compiled.context;
    const configuration = model.configurations[this.configuration];
    if (configuration === undefined) {
      throw new TypeError(`Unknown configuration ${this.configuration}`);
    }

    const parameterOverrides = {
      ...this.parameters,
      ...(request.parameters ?? {}),
    };

    let parameters: ParameterValues;
    try {
      parameters = resolveParameters(model, parameterOverrides);
    } catch (error) {
      return {
        model: model.id,
        configuration: this.configuration,
        coordinates: {},
        bodies: {},
        signals: {},
        modes: {},
        diagnostics: [
          errorDiagnostic(
            'invalid-input',
            error instanceof Error ? error.message : 'Invalid parameter input',
          ),
        ],
      };
    }

    const inputId = context.coupling.inputCoordinate;
    const outputId = context.coupling.outputCoordinate;
    const inputSource =
      request.coordinates?.[inputId] ?? configuration.coordinates[inputId];

    if (inputSource === undefined) {
      return {
        model: model.id,
        configuration: this.configuration,
        coordinates: {},
        bodies: {},
        signals: {},
        modes: {},
        diagnostics: [
          errorDiagnostic('missing-input', `Missing coordinate ${inputId}`),
        ],
      };
    }

    let inputAngle: number;
    let referenceInput: number;
    let referenceOutput: number;
    try {
      inputAngle = canonicalNumber(inputSource, 'angle');
      referenceInput = canonicalNumber(
        configuration.coordinates[inputId] ?? inputSource,
        'angle',
      );
      referenceOutput = canonicalNumber(
        configuration.coordinates[outputId] ?? { value: 0, unit: 'rad' },
        'angle',
      );
    } catch (error) {
      return {
        model: model.id,
        configuration: this.configuration,
        coordinates: {},
        bodies: {},
        signals: {},
        modes: {},
        diagnostics: [
          errorDiagnostic(
            'invalid-input',
            error instanceof Error ? error.message : 'Invalid coordinate input',
          ),
        ],
      };
    }

    const driverRadius = resolveScalar(
      context.driverPulley.pitchRadius,
      parameters,
      'length',
    );
    const drivenRadius = resolveScalar(
      context.drivenPulley.pitchRadius,
      parameters,
      'length',
    );
    const direction = context.coupling.routing === 'open' ? 1 : -1;
    const signedRatio = direction * (driverRadius / drivenRadius);
    const phase = referenceOutput - signedRatio * referenceInput;
    const outputAngle = signedRatio * inputAngle + phase;

    const inputRateSource = request.rates?.[inputId];
    const inputAccelerationSource = request.accelerations?.[inputId];
    let inputRate: number | undefined;
    let inputAcceleration: number | undefined;

    try {
      if (inputRateSource !== undefined) {
        inputRate = canonicalNumber(inputRateSource, 'angular-velocity');
      }
      if (inputAccelerationSource !== undefined) {
        inputAcceleration = canonicalNumber(
          inputAccelerationSource,
          'angular-acceleration',
        );
      }
    } catch (error) {
      return {
        model: model.id,
        configuration: this.configuration,
        coordinates: {},
        bodies: {},
        signals: {},
        modes: {},
        diagnostics: [
          errorDiagnostic(
            'invalid-input',
            error instanceof Error ? error.message : 'Invalid derivative input',
          ),
        ],
      };
    }

    const bodyPoses: Record<string, Pose2D> = {};
    const mechanical = model.systems.mechanical;
    if (mechanical === undefined) {
      throw new TypeError('Compiled belt model lost its mechanical system');
    }

    for (const [bodyId, body] of Object.entries(mechanical.bodies)) {
      bodyPoses[bodyId] = resolvePose(body, parameters);
    }

    const driverPose = bodyPoses[context.driverBody.id];
    const drivenPose = bodyPoses[context.drivenBody.id];
    if (driverPose === undefined || drivenPose === undefined) {
      throw new TypeError('Compiled belt model lost a pulley body pose');
    }

    driverPose.angle += inputAngle;
    drivenPose.angle += outputAngle;

    const driverCenter = pulleyCenter(
      driverPose,
      context.driverPulley,
      parameters,
    );
    const drivenCenter = pulleyCenter(
      drivenPose,
      context.drivenPulley,
      parameters,
    );
    const centerDistance = magnitude(subtract(drivenCenter, driverCenter));
    const validityMargin =
      context.coupling.routing === 'open'
        ? centerDistance - Math.abs(drivenRadius - driverRadius)
        : centerDistance - (driverRadius + drivenRadius);
    const geometry = beltGeometry(
      driverCenter,
      drivenCenter,
      driverRadius,
      drivenRadius,
      context.coupling.routing,
    );

    const coordinates: ReturnType<ModelSession['evaluate']>['coordinates'] = {
      [inputId]: { position: { value: inputAngle, unit: 'rad' } },
    };
    const bodies: ReturnType<ModelSession['evaluate']>['bodies'] = {};
    const signals: ReturnType<ModelSession['evaluate']>['signals'] = {
      'validity-margin': scalar(validityMargin, 'm'),
    };

    for (const [bodyId, pose] of Object.entries(bodyPoses)) {
      bodies[bodyId] = { pose };
    }

    const driverState = bodies[context.driverBody.id];
    if (driverState !== undefined) {
      if (inputRate !== undefined) driverState.angularVelocity = inputRate;
      if (inputAcceleration !== undefined) {
        driverState.angularAcceleration = inputAcceleration;
      }
    }

    if (geometry === undefined) {
      delete bodies[context.drivenBody.id];
      return {
        model: model.id,
        configuration: this.configuration,
        coordinates,
        bodies,
        signals,
        modes: {},
        diagnostics: [
          errorDiagnostic(
            'invalid-geometry',
            `No real ${context.coupling.routing} belt tangent exists for the current geometry`,
            { validityMargin },
          ),
        ],
      };
    }

    const outputCoordinate = {
      position: { value: outputAngle, unit: 'rad' as const },
    };
    if (inputRate !== undefined) {
      outputCoordinate.velocity = {
        value: signedRatio * inputRate,
        unit: 'rad/s' as const,
      };
    }
    if (inputAcceleration !== undefined) {
      outputCoordinate.acceleration = {
        value: signedRatio * inputAcceleration,
        unit: 'rad/s^2' as const,
      };
    }
    coordinates[outputId] = outputCoordinate;

    const drivenState: BodyState | undefined = bodies[context.drivenBody.id];
    if (drivenState !== undefined) {
      if (inputRate !== undefined) {
        drivenState.angularVelocity = signedRatio * inputRate;
      }
      if (inputAcceleration !== undefined) {
        drivenState.angularAcceleration = signedRatio * inputAcceleration;
      }
    }

    signals['angular-ratio'] = scalar(signedRatio, '1');
    signals['output-direction'] = {
      type: 'text',
      value: direction === 1 ? 'same' : 'reversed',
    };
    signals['belt-travel'] = scalar(
      driverRadius * (inputAngle - referenceInput),
      'm',
    );
    signals['straight-span-length'] = scalar(geometry.spanLength, 'm');
    signals['driver-wrap-angle'] = scalar(geometry.driverWrapAngle, 'rad');
    signals['driven-wrap-angle'] = scalar(geometry.drivenWrapAngle, 'rad');
    signals['belt-length'] = scalar(geometry.beltLength, 'm');
    signals['driver-contact-a'] = point(geometry.driverContactA);
    signals['driven-contact-a'] = point(geometry.drivenContactA);
    signals['driver-contact-b'] = point(geometry.driverContactB);
    signals['driven-contact-b'] = point(geometry.drivenContactB);

    if (inputRate !== undefined) {
      signals['belt-linear-speed'] = scalar(driverRadius * inputRate, 'm/s');
    }

    return {
      model: model.id,
      configuration: this.configuration,
      coordinates,
      bodies,
      signals,
      modes: {},
      diagnostics: [],
    };
  }

  reset(configuration = this.defaultConfiguration): void {
    if (this.compiled.model.configurations[configuration] === undefined) {
      throw new TypeError(`Unknown configuration ${configuration}`);
    }
    this.configuration = configuration;
  }

  snapshot(): SessionSnapshot {
    return {
      configuration: this.configuration,
      parameters: { ...this.parameters },
      modes: {},
    };
  }
}

class AnalyticBeltCompiledModel implements CompiledModel {
  readonly capabilities = CAPABILITIES;

  constructor(
    readonly model: SimulationModel,
    readonly context: BeltContext,
  ) {}

  createSession(options: SessionOptions = {}): ModelSession {
    return new AnalyticBeltSession(this, options);
  }
}

export const analyticBeltAdapter: SimulationAdapter = {
  id: 'atlas.analytic-belt.v0',

  supports(model): boolean {
    return getContext(model) !== undefined;
  },

  compile(model): CompiledModel {
    const diagnostics = validateSimulationModel(model);
    const state = {
      model: model.id,
      coordinates: {},
      bodies: {},
      signals: {},
      modes: {},
      diagnostics,
    };
    if (hasErrors(state)) {
      throw new TypeError(
        diagnostics.map((diagnostic) => diagnostic.message).join('; '),
      );
    }

    const context = getContext(model);
    if (context === undefined) {
      throw new TypeError('Model is not supported by the analytic belt adapter');
    }

    return new AnalyticBeltCompiledModel(model, context);
  },
};
