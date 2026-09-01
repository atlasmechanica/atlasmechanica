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

interface ResolvedParameter {
  value: number;
  kind: QuantityKind;
}

type ParameterValues = Record<ParameterId, ResolvedParameter>;

interface ContactContext {
  definition: FixedAxisBeltContactDefinition;
  pulley: FixedAxisPulleyDefinition;
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

function getContext(model: SimulationModel): SpatialBeltContext | undefined {
  const system = model.systems.fixedAxisBelt;
  if (system === undefined) return undefined;

  const loops = Object.values(system.loops);
  if (loops.length !== 1) return undefined;
  const loop = loops[0];
  if (loop === undefined) return undefined;

  const contacts: ContactContext[] = [];
  for (const definition of loop.contacts) {
    const pulley = system.pulleys[definition.pulley];
    if (pulley === undefined) return undefined;
    contacts.push({ definition, pulley });
  }

  const drivers = contacts.filter((contact) => contact.pulley.role === 'driver');
  const driven = contacts.filter((contact) => contact.pulley.role === 'driven');
  if (drivers.length !== 1 || driven.length !== 1) return undefined;

  const driver = drivers[0];
  const output = driven[0];
  if (driver === undefined || output === undefined) return undefined;
  return { system, loop, contacts, driver, driven: output };
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

    const inputSource = request.coordinates?.[inputId] ?? configuration.coordinates[inputId];
    if (inputSource === undefined) {
      return invalidState(
        model,
        this.configuration,
        errorDiagnostic('missing-input', `Missing coordinate ${inputId}`),
      );
    }

    let inputAngle: number;
    let inputRate: number | undefined;
    let inputAcceleration: number | undefined;
    let driverRadius: number;
    try {
      inputAngle = canonicalNumber(inputSource, 'angle');
      const rate = request.rates?.[inputId];
      const acceleration = request.accelerations?.[inputId];
      inputRate = rate === undefined ? undefined : canonicalNumber(rate, 'angular-velocity');
      inputAcceleration = acceleration === undefined
        ? undefined
        : canonicalNumber(acceleration, 'angular-acceleration');
      driverRadius = resolveScalar(context.driver.pulley.pitchRadius, parameters, 'length');
      if (!(driverRadius > 0)) throw new RangeError('Driver pitch radius must be positive');
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

    const referenceInputSource = configuration.coordinates[inputId] ?? { value: 0, unit: 'rad' as const };
    const referenceInput = canonicalNumber(referenceInputSource, 'angle');
    const coordinates: ModelState['coordinates'] = {};
    const ratios = new Map<string, number>();

    for (const contact of context.contacts) {
      let radius: number;
      let referenceAngle: number;
      try {
        radius = resolveScalar(contact.pulley.pitchRadius, parameters, 'length');
        if (!(radius > 0)) throw new RangeError(`${contact.pulley.id} pitch radius must be positive`);
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
            error instanceof Error ? error.message : 'Invalid fixed-axis pulley geometry',
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
        'Model is not supported by the fixed-axis spatial belt adapter; v0 requires one loop with exactly one driver and one driven pulley',
      );
    }
    return new SpatialBeltCompiledModel(model, context);
  },
};
