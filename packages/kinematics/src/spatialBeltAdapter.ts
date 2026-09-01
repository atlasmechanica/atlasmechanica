import {
  canonicalNumber,
  isParameterReference,
  validateSimulationModel,
  type CompiledModel,
  type ConfigurationId,
  type CoordinateState,
  type Diagnostic,
  type EvaluationRequest,
  type FixedAxisBeltContactDefinition,
  type FixedAxisBeltLoopDefinition,
  type FixedAxisBeltSystemDefinition,
  type FixedAxisPulleyDefinition,
  type ModelCapabilities,
  type ModelSession,
  type ModelState,
  type ParameterId,
  type QuantityKind,
  type QuantityValue,
  type ScalarSource,
  type SessionOptions,
  type SessionSnapshot,
  type SignalValue,
  type SimulationAdapter,
  type SimulationModel,
} from '@atlasmechanica/model';

const CAPABILITIES: ModelCapabilities = {
  position: 'exact',
  velocity: 'analytic',
  acceleration: 'analytic',
  force: 'unavailable',
  dynamics: 'unavailable',
  events: 'unavailable',
};

const BROWN_003_MODEL_ID = 'foundation:belt-drive:quarter-turn-guided';
const BROWN_003_SUBJECT = 'belt-drive';
const BROWN_003_VARIANT = 'quarter-turn-guided';
const BROWN_003_LOOP_ID = 'main-belt';
const PROFILE_TOLERANCE = 1e-9;

const BROWN_003_CONTACT_PROFILE = [
  { pulley: 'driver', role: 'driver', coordinate: 'driver-angle', sense: 1 },
  { pulley: 'guide-a', role: 'guide', coordinate: 'guide-a-angle', sense: 1 },
  { pulley: 'driven', role: 'driven', coordinate: 'driven-angle', sense: 1 },
  { pulley: 'guide-b', role: 'guide', coordinate: 'guide-b-angle', sense: -1 },
] as const;

const REQUIRED_SIGNALS = [
  { id: 'output-angular-ratio', kind: 'dimensionless', unit: '1' },
  { id: 'belt-travel', kind: 'length', unit: 'm' },
  { id: 'belt-linear-speed', kind: 'velocity', unit: 'm/s' },
] as const;

type Vec3 = readonly [number, number, number];

interface ResolvedParameter {
  value: number;
  kind: QuantityKind;
}

type ParameterValues = Record<ParameterId, ResolvedParameter>;

interface ContactContext {
  definition: FixedAxisBeltContactDefinition;
  pulley: FixedAxisPulleyDefinition;
  center: Vec3;
}

interface SpatialBeltContext {
  system: FixedAxisBeltSystemDefinition;
  loop: FixedAxisBeltLoopDefinition;
  contacts: readonly ContactContext[];
  driver: ContactContext;
  driven: ContactContext;
}

function scalar(value: number, unit: '1' | 'm' | 'm/s'): SignalValue {
  return { type: 'scalar', value: { value, unit } };
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

function resolveParameters(
  model: SimulationModel,
  overrides: Partial<Record<ParameterId, QuantityValue>>,
): ParameterValues {
  const values: ParameterValues = {};
  for (const [id, definition] of Object.entries(model.parameters)) {
    const authored = overrides[id] ?? definition.default;
    const value = canonicalNumber(authored, definition.kind);
    if (!Number.isFinite(value)) {
      throw new RangeError(`${id} must be finite`);
    }

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
      throw new TypeError(`Parameter ${source.parameter} is ${resolved.kind}, not ${kind}`);
    }
    return resolved.value;
  }
  return canonicalNumber(source, kind);
}

function directCenter(pulley: FixedAxisPulleyDefinition): Vec3 | undefined {
  const sources = [pulley.center.x, pulley.center.y, pulley.center.z] as const;
  const values: number[] = [];
  for (const source of sources) {
    if (isParameterReference(source)) return undefined;
    const value = canonicalNumber(source, 'length');
    if (!Number.isFinite(value)) return undefined;
    values.push(value);
  }
  const [x, y, z] = values;
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return [x, y, z];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function magnitude(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vec3): Vec3 | undefined {
  if (!vector.every(Number.isFinite)) return undefined;
  const length = magnitude(vector);
  if (!(length > PROFILE_TOLERANCE)) return undefined;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function sameDirection(a: Vec3, b: Vec3): boolean {
  const an = normalize(a);
  const bn = normalize(b);
  return an !== undefined
    && bn !== undefined
    && dot(an, bn) >= 1 - PROFILE_TOLERANCE;
}

function perpendicular(a: Vec3, b: Vec3): boolean {
  const an = normalize(a);
  const bn = normalize(b);
  return an !== undefined
    && bn !== undefined
    && Math.abs(dot(an, bn)) <= PROFILE_TOLERANCE;
}

function hasRequiredSignals(model: SimulationModel): boolean {
  return REQUIRED_SIGNALS.every((expected) => {
    const signal = model.signals[expected.id];
    return signal !== undefined
      && signal.id === expected.id
      && signal.valueType === 'scalar'
      && signal.kind === expected.kind
      && signal.unit === expected.unit;
  });
}

function matchesBrown003Profile(
  model: SimulationModel,
  system: FixedAxisBeltSystemDefinition,
  loop: FixedAxisBeltLoopDefinition,
  contacts: readonly ContactContext[],
): boolean {
  if (
    model.id !== BROWN_003_MODEL_ID
    || model.subject !== BROWN_003_SUBJECT
    || model.variant !== BROWN_003_VARIANT
    || model.systems.mechanical !== undefined
    || loop.id !== BROWN_003_LOOP_ID
    || contacts.length !== BROWN_003_CONTACT_PROFILE.length
    || Object.keys(system.pulleys).length !== BROWN_003_CONTACT_PROFILE.length
    || !hasRequiredSignals(model)
  ) {
    return false;
  }

  for (let index = 0; index < BROWN_003_CONTACT_PROFILE.length; index += 1) {
    const expected = BROWN_003_CONTACT_PROFILE[index];
    const actual = contacts[index];
    if (
      expected === undefined
      || actual === undefined
      || actual.pulley.id !== expected.pulley
      || actual.pulley.role !== expected.role
      || actual.pulley.coordinate !== expected.coordinate
      || actual.definition.sense !== expected.sense
    ) {
      return false;
    }
  }

  const driver = contacts[0];
  const guideA = contacts[1];
  const driven = contacts[2];
  const guideB = contacts[3];
  if (
    driver === undefined
    || guideA === undefined
    || driven === undefined
    || guideB === undefined
  ) {
    return false;
  }

  if (
    !sameDirection(guideA.pulley.axis, driven.pulley.axis)
    || !sameDirection(guideB.pulley.axis, driven.pulley.axis)
    || !perpendicular(driver.pulley.axis, driven.pulley.axis)
  ) {
    return false;
  }

  const guideSpan = subtract(guideB.center, guideA.center);
  if (!sameDirection(guideSpan, driven.pulley.axis)) return false;

  const guideMidpoint = midpoint(guideA.center, guideB.center);
  const drivenOffset = subtract(driven.center, guideMidpoint);
  if (!sameDirection(drivenOffset, driver.pulley.axis)) return false;

  const riser = subtract(guideMidpoint, driver.center);
  return magnitude(riser) > PROFILE_TOLERANCE
    && perpendicular(riser, driver.pulley.axis)
    && perpendicular(riser, driven.pulley.axis);
}

function resolveContactRadii(
  contacts: readonly ContactContext[],
  parameters: ParameterValues,
): Map<string, number> {
  const radii = new Map<string, number>();
  for (const contact of contacts) {
    const radius = resolveScalar(contact.pulley.pitchRadius, parameters, 'length');
    if (!Number.isFinite(radius) || !(radius > 0)) {
      throw new RangeError(`${contact.pulley.id} pitch radius must be positive and finite`);
    }
    radii.set(contact.pulley.id, radius);
  }
  return radii;
}

function hasLoopClearance(
  contacts: readonly ContactContext[],
  radii: ReadonlyMap<string, number>,
): boolean {
  for (let index = 0; index < contacts.length; index += 1) {
    const a = contacts[index];
    const b = contacts[(index + 1) % contacts.length];
    if (a === undefined || b === undefined) return false;
    const ra = radii.get(a.pulley.id);
    const rb = radii.get(b.pulley.id);
    if (ra === undefined || rb === undefined) return false;
    const centerDistance = magnitude(subtract(b.center, a.center));
    if (!(centerDistance > ra + rb + PROFILE_TOLERANCE)) return false;
  }
  return true;
}

function getContext(model: SimulationModel): SpatialBeltContext | undefined {
  const system = model.systems.fixedAxisBelt;
  if (system === undefined || model.systems.mechanical !== undefined) return undefined;

  const loops = Object.values(system.loops);
  if (loops.length !== 1) return undefined;
  const loop = loops[0];
  if (loop === undefined) return undefined;

  const contacts: ContactContext[] = [];
  for (const definition of loop.contacts) {
    const pulley = system.pulleys[definition.pulley];
    if (pulley === undefined) return undefined;
    const center = directCenter(pulley);
    if (center === undefined) return undefined;
    contacts.push({ definition, pulley, center });
  }

  const drivers = contacts.filter((contact) => contact.pulley.role === 'driver');
  const driven = contacts.filter((contact) => contact.pulley.role === 'driven');
  if (drivers.length !== 1 || driven.length !== 1) return undefined;

  const driver = drivers[0];
  const output = driven[0];
  if (driver === undefined || output === undefined) return undefined;

  const context = { system, loop, contacts, driver, driven: output } as const;
  if (!matchesBrown003Profile(model, system, loop, contacts)) return undefined;

  try {
    const parameters = resolveParameters(model, {});
    const radii = resolveContactRadii(contacts, parameters);
    if (!hasLoopClearance(contacts, radii)) return undefined;
  } catch {
    return undefined;
  }

  return context;
}

function onlyPrescribes(
  values: Readonly<Record<string, unknown>> | undefined,
  coordinate: string,
): boolean {
  return values === undefined || Object.keys(values).every((id) => id === coordinate);
}

class SpatialBeltSession implements ModelSession {
  private configuration: ConfigurationId;
  private readonly defaultConfiguration: ConfigurationId;
  private readonly parameters: Partial<Record<ParameterId, QuantityValue>>;

  constructor(
    private readonly compiled: SpatialBeltCompiledModel,
    options: SessionOptions,
  ) {
    const configuration = options.configuration ?? Object.keys(compiled.model.configurations)[0];
    if (configuration === undefined) {
      throw new TypeError('Fixed-axis belt model has no reference configuration');
    }
    if (compiled.model.configurations[configuration] === undefined) {
      throw new TypeError(`Unknown configuration ${configuration}`);
    }
    this.configuration = configuration;
    this.defaultConfiguration = configuration;
    this.parameters = { ...(options.parameters ?? {}) };
  }

  evaluate(request: EvaluationRequest = {}): ModelState {
    const { model, context } = this.compiled;
    const configuration = model.configurations[this.configuration];
    if (configuration === undefined) {
      throw new TypeError(`Unknown configuration ${this.configuration}`);
    }

    const inputId = context.driver.pulley.coordinate;
    if (
      !onlyPrescribes(request.coordinates, inputId)
      || !onlyPrescribes(request.rates, inputId)
      || !onlyPrescribes(request.accelerations, inputId)
    ) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic(
          'invalid-input',
          `Fixed-axis belt evaluation may prescribe only driver coordinate ${inputId}`,
        ),
      );
    }

    let parameters: ParameterValues;
    let inputAngle: number;
    let referenceInput: number;
    let inputRate: number | undefined;
    let inputAcceleration: number | undefined;
    let radii: Map<string, number>;
    try {
      parameters = resolveParameters(model, {
        ...this.parameters,
        ...(request.parameters ?? {}),
      });

      const inputSource = request.coordinates?.[inputId] ?? configuration.coordinates[inputId];
      if (inputSource === undefined) {
        return invalidState(
          model,
          this.configuration,
          errorDiagnostic('missing-input', `Missing coordinate ${inputId}`),
        );
      }

      inputAngle = canonicalNumber(inputSource, 'angle');
      referenceInput = canonicalNumber(
        configuration.coordinates[inputId] ?? { value: 0, unit: 'rad' },
        'angle',
      );
      const rate = request.rates?.[inputId];
      const acceleration = request.accelerations?.[inputId];
      inputRate = rate === undefined ? undefined : canonicalNumber(rate, 'angular-velocity');
      inputAcceleration = acceleration === undefined
        ? undefined
        : canonicalNumber(acceleration, 'angular-acceleration');
      radii = resolveContactRadii(context.contacts, parameters);
    } catch (error) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic(
          'invalid-input',
          error instanceof Error ? error.message : 'Invalid fixed-axis belt input',
        ),
      );
    }

    if (!hasLoopClearance(context.contacts, radii)) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic(
          'invalid-geometry',
          'Brown 003 fixed-axis belt profile lost required clearance between consecutive pulley contacts',
        ),
      );
    }

    const driverRadius = radii.get(context.driver.pulley.id);
    if (driverRadius === undefined) {
      throw new TypeError('Compiled fixed-axis belt model lost its driver radius');
    }

    const coordinates: ModelState['coordinates'] = {};
    const ratios = new Map<string, number>();

    for (const contact of context.contacts) {
      const radius = radii.get(contact.pulley.id);
      if (radius === undefined) {
        throw new TypeError(`Compiled fixed-axis belt model lost radius ${contact.pulley.id}`);
      }

      let referenceAngle: number;
      try {
        referenceAngle = canonicalNumber(
          configuration.coordinates[contact.pulley.coordinate] ?? { value: 0, unit: 'rad' },
          'angle',
        );
      } catch (error) {
        return invalidState(
          model,
          this.configuration,
          errorDiagnostic(
            'invalid-input',
            error instanceof Error ? error.message : 'Invalid fixed-axis pulley reference angle',
          ),
        );
      }

      const ratio = (context.driver.definition.sense / contact.definition.sense)
        * (driverRadius / radius);
      ratios.set(contact.pulley.id, ratio);
      const state: CoordinateState = {
        position: {
          value: referenceAngle + ratio * (inputAngle - referenceInput),
          unit: 'rad',
        },
      };
      if (inputRate !== undefined) {
        state.velocity = { value: ratio * inputRate, unit: 'rad/s' };
      }
      if (inputAcceleration !== undefined) {
        state.acceleration = {
          value: ratio * inputAcceleration,
          unit: 'rad/s^2',
        };
      }
      coordinates[contact.pulley.coordinate] = state;
    }

    const outputRatio = ratios.get(context.driven.pulley.id);
    if (outputRatio === undefined) {
      throw new TypeError('Compiled fixed-axis belt model lost its driven ratio');
    }

    const beltTravel = context.driver.definition.sense
      * driverRadius
      * (inputAngle - referenceInput);
    const signals: ModelState['signals'] = {
      'output-angular-ratio': scalar(outputRatio, '1'),
      'belt-travel': scalar(beltTravel, 'm'),
    };
    if (inputRate !== undefined) {
      signals['belt-linear-speed'] = scalar(
        context.driver.definition.sense * driverRadius * inputRate,
        'm/s',
      );
    }

    return {
      model: model.id,
      configuration: this.configuration,
      coordinates,
      bodies: {},
      signals,
      modes: {
        ...(configuration.modes ?? {}),
        'belt-loop': context.loop.id,
      },
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
      modes: {
        'belt-loop': this.compiled.context.loop.id,
      },
    };
  }
}

class SpatialBeltCompiledModel implements CompiledModel {
  readonly capabilities = CAPABILITIES;

  constructor(
    readonly model: SimulationModel,
    readonly context: SpatialBeltContext,
  ) {}

  createSession(options: SessionOptions = {}): ModelSession {
    return new SpatialBeltSession(this, options);
  }
}

export const spatialBeltAdapter: SimulationAdapter = {
  id: 'atlas.spatial-belt.v0',

  supports(model): boolean {
    return getContext(model) !== undefined;
  },

  compile(model): CompiledModel {
    const diagnostics = validateSimulationModel(model);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      throw new TypeError(diagnostics.map((diagnostic) => diagnostic.message).join('; '));
    }

    const context = getContext(model);
    if (context === undefined) {
      throw new TypeError(
        'Model is not supported by the fixed-axis spatial belt adapter; v0 is restricted to the validated Brown 003 quarter-turn guide-pulley profile until routed tangent geometry is implemented',
      );
    }
    return new SpatialBeltCompiledModel(model, context);
  },
};
