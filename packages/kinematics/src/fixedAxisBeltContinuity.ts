import {
  canonicalNumber,
  isParameterReference,
  validateSimulationModel,
  type BeltLoopId,
  type ConfigurationId,
  type CoordinateId,
  type CoordinateState,
  type Diagnostic,
  type EvaluationRequest,
  type FixedAxisBeltContactDefinition,
  type FixedAxisBeltLoopDefinition,
  type FixedAxisPulleyDefinition,
  type FixedAxisPulleyId,
  type ParameterId,
  type QuantityKind,
  type QuantityValue,
  type ScalarSource,
  type SimulationModel,
} from '@atlasmechanica/model';

interface ResolvedParameter {
  value: number;
  kind: QuantityKind;
}

type ParameterValues = Record<ParameterId, ResolvedParameter>;

interface ContactContext {
  definition: FixedAxisBeltContactDefinition;
  pulley: FixedAxisPulleyDefinition;
}

export interface FixedAxisBeltContinuityRequest extends EvaluationRequest {
  configuration?: ConfigurationId;
  loop?: BeltLoopId;
}

/**
 * Algebraic no-slip continuity result for a fixed-axis belt loop.
 *
 * This is intentionally not a SimulationAdapter and exposes no solver
 * capabilities. It answers only: if the authored loop exists and does not
 * slip, what angular continuity follows from its radii and contact senses?
 *
 * Centers and axes are still validated as model data, but this function does
 * not inspect them and does not certify tangent/contact feasibility. A route
 * solver must establish that geometry before Atlas may expose an adapter for
 * the mechanism.
 */
export interface FixedAxisBeltContinuityResult {
  model: string;
  configuration?: ConfigurationId;
  loop?: BeltLoopId;
  coordinates: Partial<Record<CoordinateId, CoordinateState>>;
  angularRatios: Partial<Record<FixedAxisPulleyId, number>>;
  /** Signed belt travel in meters, relative to the reference configuration. */
  beltTravel?: number;
  /** Signed belt speed in meters per second when a driver rate is supplied. */
  beltLinearSpeed?: number;
  diagnostics: Diagnostic[];
}

function diagnostic(
  code: Diagnostic['code'],
  message: string,
  context?: Diagnostic['context'],
): Diagnostic {
  const item: Diagnostic = { severity: 'error', code, message };
  if (context !== undefined) item.context = context;
  return item;
}

function emptyResult(
  model: SimulationModel,
  diagnostics: Diagnostic[],
  configuration?: ConfigurationId,
  loop?: BeltLoopId,
): FixedAxisBeltContinuityResult {
  const result: FixedAxisBeltContinuityResult = {
    model: model.id,
    coordinates: {},
    angularRatios: {},
    diagnostics,
  };
  if (configuration !== undefined) result.configuration = configuration;
  if (loop !== undefined) result.loop = loop;
  return result;
}

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function resolveParameters(
  model: SimulationModel,
  overrides: Partial<Record<ParameterId, QuantityValue>>,
): ParameterValues {
  const values: ParameterValues = {};
  for (const [id, definition] of Object.entries(model.parameters)) {
    const authored = overrides[id] ?? definition.default;
    const value = assertFinite(canonicalNumber(authored, definition.kind), id);

    if (definition.domain?.min !== undefined) {
      const minimum = assertFinite(
        canonicalNumber(definition.domain.min, definition.kind),
        `${id} minimum`,
      );
      if (value < minimum) {
        throw new RangeError(`${id} must be >= ${minimum} in canonical units`);
      }
    }
    if (definition.domain?.max !== undefined) {
      const maximum = assertFinite(
        canonicalNumber(definition.domain.max, definition.kind),
        `${id} maximum`,
      );
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
  return assertFinite(canonicalNumber(source, kind), `${kind} scalar`);
}

function onlyPrescribes(
  values: Readonly<Record<string, unknown>> | undefined,
  coordinate: string,
): boolean {
  return values === undefined || Object.keys(values).every((id) => id === coordinate);
}

function selectLoop(
  model: SimulationModel,
  requested: BeltLoopId | undefined,
): FixedAxisBeltLoopDefinition | undefined {
  const system = model.systems.fixedAxisBelt;
  if (system === undefined) return undefined;
  if (requested !== undefined) return system.loops[requested];

  const loops = Object.values(system.loops);
  return loops.length === 1 ? loops[0] : undefined;
}

function resolveContacts(
  model: SimulationModel,
  loop: FixedAxisBeltLoopDefinition,
): ContactContext[] | undefined {
  const system = model.systems.fixedAxisBelt;
  if (system === undefined) return undefined;

  const contacts: ContactContext[] = [];
  for (const definition of loop.contacts) {
    const pulley = system.pulleys[definition.pulley];
    if (pulley === undefined) return undefined;
    contacts.push({ definition, pulley });
  }
  return contacts;
}

export function evaluateFixedAxisBeltContinuity(
  model: SimulationModel,
  request: FixedAxisBeltContinuityRequest = {},
): FixedAxisBeltContinuityResult {
  const validation = validateSimulationModel(model);
  if (validation.some((item) => item.severity === 'error')) {
    return emptyResult(model, validation, request.configuration, request.loop);
  }

  const system = model.systems.fixedAxisBelt;
  if (system === undefined) {
    return emptyResult(model, [
      diagnostic('unsupported-model', 'Fixed-axis belt continuity requires a fixedAxisBelt system'),
    ]);
  }

  const configurationId = request.configuration ?? Object.keys(model.configurations)[0];
  if (configurationId === undefined) {
    return emptyResult(model, [
      diagnostic('invalid-model', 'SimulationModel requires at least one reference configuration'),
    ]);
  }
  const configuration = model.configurations[configurationId];
  if (configuration === undefined) {
    return emptyResult(model, [
      diagnostic('invalid-input', `Unknown configuration ${configurationId}`),
    ], configurationId);
  }

  const loop = selectLoop(model, request.loop);
  if (loop === undefined) {
    return emptyResult(model, [
      diagnostic(
        'unsupported-model',
        request.loop === undefined
          ? 'Fixed-axis belt continuity requires exactly one loop when no loop id is supplied'
          : `Unknown fixed-axis belt loop ${request.loop}`,
      ),
    ], configurationId, request.loop);
  }

  const contacts = resolveContacts(model, loop);
  if (contacts === undefined) {
    return emptyResult(model, [
      diagnostic('invalid-model', `Fixed-axis belt loop ${loop.id} has unresolved pulley contacts`),
    ], configurationId, loop.id);
  }

  const drivers = contacts.filter((contact) => contact.pulley.role === 'driver');
  if (drivers.length !== 1 || drivers[0] === undefined) {
    return emptyResult(model, [
      diagnostic('invalid-model', `Fixed-axis belt loop ${loop.id} requires exactly one driver`),
    ], configurationId, loop.id);
  }
  const driver = drivers[0];
  const inputId = driver.pulley.coordinate;

  if (
    !onlyPrescribes(request.coordinates, inputId)
    || !onlyPrescribes(request.rates, inputId)
    || !onlyPrescribes(request.accelerations, inputId)
  ) {
    return emptyResult(model, [
      diagnostic(
        'invalid-input',
        `Fixed-axis belt continuity may prescribe only driver coordinate ${inputId}`,
      ),
    ], configurationId, loop.id);
  }

  let parameters: ParameterValues;
  let inputAngle: number;
  let referenceInput: number;
  let inputRate: number | undefined;
  let inputAcceleration: number | undefined;
  let driverRadius: number;
  const radii = new Map<FixedAxisPulleyId, number>();

  try {
    parameters = resolveParameters(model, request.parameters ?? {});
    const inputSource = request.coordinates?.[inputId] ?? configuration.coordinates[inputId];
    if (inputSource === undefined) {
      return emptyResult(model, [
        diagnostic('missing-input', `Missing coordinate ${inputId}`),
      ], configurationId, loop.id);
    }

    inputAngle = assertFinite(canonicalNumber(inputSource, 'angle'), 'Driver angle');
    referenceInput = assertFinite(
      canonicalNumber(
        configuration.coordinates[inputId] ?? { value: 0, unit: 'rad' },
        'angle',
      ),
      'Driver reference angle',
    );

    const rate = request.rates?.[inputId];
    inputRate = rate === undefined
      ? undefined
      : assertFinite(canonicalNumber(rate, 'angular-velocity'), 'Driver angular velocity');
    const acceleration = request.accelerations?.[inputId];
    inputAcceleration = acceleration === undefined
      ? undefined
      : assertFinite(
          canonicalNumber(acceleration, 'angular-acceleration'),
          'Driver angular acceleration',
        );

    for (const contact of contacts) {
      const radius = resolveScalar(contact.pulley.pitchRadius, parameters, 'length');
      if (!(radius > 0)) {
        throw new RangeError(`${contact.pulley.id} pitch radius must be positive`);
      }
      radii.set(contact.pulley.id, radius);
    }

    const resolvedDriverRadius = radii.get(driver.pulley.id);
    if (resolvedDriverRadius === undefined) {
      throw new TypeError('Fixed-axis belt continuity lost the driver radius');
    }
    driverRadius = resolvedDriverRadius;
  } catch (error) {
    return emptyResult(model, [
      diagnostic(
        'invalid-input',
        error instanceof Error ? error.message : 'Invalid fixed-axis belt continuity input',
      ),
    ], configurationId, loop.id);
  }

  const coordinates: FixedAxisBeltContinuityResult['coordinates'] = {};
  const angularRatios: FixedAxisBeltContinuityResult['angularRatios'] = {};

  try {
    for (const contact of contacts) {
      const radius = radii.get(contact.pulley.id);
      if (radius === undefined) throw new TypeError(`Missing radius ${contact.pulley.id}`);

      const referenceAngle = assertFinite(
        canonicalNumber(
          configuration.coordinates[contact.pulley.coordinate] ?? { value: 0, unit: 'rad' },
          'angle',
        ),
        `${contact.pulley.id} reference angle`,
      );
      const ratio = assertFinite(
        (driver.definition.sense / contact.definition.sense) * (driverRadius / radius),
        `${contact.pulley.id} angular ratio`,
      );
      const position = assertFinite(
        referenceAngle + ratio * (inputAngle - referenceInput),
        `${contact.pulley.id} angle`,
      );

      const state: CoordinateState = {
        position: { value: position, unit: 'rad' },
      };
      if (inputRate !== undefined) {
        state.velocity = {
          value: assertFinite(ratio * inputRate, `${contact.pulley.id} angular velocity`),
          unit: 'rad/s',
        };
      }
      if (inputAcceleration !== undefined) {
        state.acceleration = {
          value: assertFinite(
            ratio * inputAcceleration,
            `${contact.pulley.id} angular acceleration`,
          ),
          unit: 'rad/s^2',
        };
      }

      coordinates[contact.pulley.coordinate] = state;
      angularRatios[contact.pulley.id] = ratio;
    }

    const beltTravel = assertFinite(
      driver.definition.sense * driverRadius * (inputAngle - referenceInput),
      'Belt travel',
    );
    const beltLinearSpeed = inputRate === undefined
      ? undefined
      : assertFinite(driver.definition.sense * driverRadius * inputRate, 'Belt linear speed');

    const result: FixedAxisBeltContinuityResult = {
      model: model.id,
      configuration: configurationId,
      loop: loop.id,
      coordinates,
      angularRatios,
      beltTravel,
      diagnostics: [],
    };
    if (beltLinearSpeed !== undefined) result.beltLinearSpeed = beltLinearSpeed;
    return result;
  } catch (error) {
    return emptyResult(model, [
      diagnostic(
        'invalid-input',
        error instanceof Error ? error.message : 'Non-finite fixed-axis belt continuity result',
      ),
    ], configurationId, loop.id);
  }
}
