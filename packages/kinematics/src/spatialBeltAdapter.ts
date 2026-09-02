import {
  validateSimulationModel,
  type CompiledModel,
  type ConfigurationId,
  type Diagnostic,
  type EvaluationRequest,
  type ModelCapabilities,
  type ModelSession,
  type ModelState,
  type ParameterId,
  type QuantityValue,
  type SessionOptions,
  type SessionSnapshot,
  type SignalValue,
  type SimulationAdapter,
  type SimulationModel,
} from '@atlasmechanica/model';

import {
  buildBrown003MaterialPath,
  resolveBrown003MaterialPhase,
} from './brown003MaterialMotion.js';
import { solveBrown003Route } from './brown003Route.js';
import {
  evaluateFixedAxisBeltContinuity,
  type FixedAxisBeltContinuityResult,
} from './fixedAxisBeltContinuity.js';

const BROWN_003_MODEL_ID = 'foundation:belt-drive:quarter-turn-guided';
const BROWN_003_SUBJECT = 'belt-drive';
const BROWN_003_VARIANT = 'quarter-turn-guided';

const CAPABILITIES: ModelCapabilities = Object.freeze({
  position: 'exact',
  velocity: 'analytic',
  acceleration: 'analytic',
  force: 'unavailable',
  dynamics: 'unavailable',
  events: 'unavailable',
});

function scalar(value: number, unit: '1' | 'm' | 'm/s'): SignalValue {
  return { type: 'scalar', value: { value, unit } };
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

function cloneOwnOverrides(
  source: Partial<Record<ParameterId, QuantityValue>> | undefined,
): Partial<Record<ParameterId, QuantityValue>> {
  const target = Object.create(null) as Partial<Record<ParameterId, QuantityValue>>;
  if (source === undefined) return target;

  for (const key of Reflect.ownKeys(source)) {
    Object.defineProperty(target, key, {
      value: Reflect.get(source, key),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return target;
}

function mergeOwnOverrides(
  base: Partial<Record<ParameterId, QuantityValue>>,
  request: Partial<Record<ParameterId, QuantityValue>> | undefined,
): Partial<Record<ParameterId, QuantityValue>> {
  const merged = cloneOwnOverrides(base);
  if (request === undefined) return merged;

  for (const key of Reflect.ownKeys(request)) {
    Object.defineProperty(merged, key, {
      value: Reflect.get(request, key),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return merged;
}

function continuitySignals(
  continuity: FixedAxisBeltContinuityResult,
): ModelState['signals'] {
  const signals: ModelState['signals'] = {};

  const outputRatio = continuity.angularRatios.driven;
  if (outputRatio !== undefined && Number.isFinite(outputRatio)) {
    signals['output-angular-ratio'] = scalar(outputRatio, '1');
  }
  if (continuity.beltTravel !== undefined && Number.isFinite(continuity.beltTravel)) {
    signals['belt-travel'] = scalar(continuity.beltTravel, 'm');
  }
  if (
    continuity.beltLinearSpeed !== undefined
    && Number.isFinite(continuity.beltLinearSpeed)
  ) {
    signals['belt-linear-speed'] = scalar(continuity.beltLinearSpeed, 'm/s');
  }

  return signals;
}

function stateFromContinuity(
  model: SimulationModel,
  configuration: ConfigurationId,
  continuity: FixedAxisBeltContinuityResult,
  diagnostics: Diagnostic[],
): ModelState {
  return {
    model: model.id,
    configuration,
    coordinates: continuity.coordinates,
    bodies: {},
    signals: continuitySignals(continuity),
    modes: {},
    diagnostics,
  };
}

function adapterIdentityMatches(model: SimulationModel): boolean {
  return (
    model.id === BROWN_003_MODEL_ID
    && model.subject === BROWN_003_SUBJECT
    && model.variant === BROWN_003_VARIANT
    && model.systems.fixedAxisBelt !== undefined
  );
}

function compileDefaultRoute(model: SimulationModel): void {
  const route = solveBrown003Route(model);
  if (hasErrors(route.diagnostics)) {
    throw new TypeError(route.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
  }

  const materialPath = buildBrown003MaterialPath(route);
  if (hasErrors(materialPath.diagnostics) || materialPath.path === undefined) {
    throw new TypeError(
      materialPath.diagnostics.map((diagnostic) => diagnostic.message).join('; ')
      || 'Brown 003 material path could not be compiled',
    );
  }
}

class SpatialBeltSession implements ModelSession {
  private configuration: ConfigurationId;
  private readonly defaultConfiguration: ConfigurationId;
  private readonly parameters: Partial<Record<ParameterId, QuantityValue>>;

  constructor(
    private readonly compiled: SpatialBeltCompiledModel,
    options: SessionOptions = {},
  ) {
    const configuration =
      options.configuration ?? Object.keys(compiled.model.configurations)[0];
    if (configuration === undefined) {
      throw new TypeError('Brown 003 spatial belt model has no reference configuration');
    }
    if (compiled.model.configurations[configuration] === undefined) {
      throw new TypeError(`Unknown configuration ${configuration}`);
    }

    this.configuration = configuration;
    this.defaultConfiguration = configuration;
    this.parameters = cloneOwnOverrides(options.parameters);
  }

  evaluate(request: EvaluationRequest = {}): ModelState {
    const model = this.compiled.model;
    const parameters = mergeOwnOverrides(this.parameters, request.parameters);
    const continuity = evaluateFixedAxisBeltContinuity(model, {
      configuration: this.configuration,
      coordinates: request.coordinates,
      rates: request.rates,
      accelerations: request.accelerations,
      parameters,
    });

    if (hasErrors(continuity.diagnostics)) {
      return stateFromContinuity(
        model,
        this.configuration,
        continuity,
        [...continuity.diagnostics],
      );
    }

    const route = solveBrown003Route(model, { parameters });
    if (hasErrors(route.diagnostics)) {
      return stateFromContinuity(
        model,
        this.configuration,
        continuity,
        [...route.diagnostics],
      );
    }

    const materialPath = buildBrown003MaterialPath(route);
    if (hasErrors(materialPath.diagnostics) || materialPath.path === undefined) {
      return stateFromContinuity(
        model,
        this.configuration,
        continuity,
        materialPath.path === undefined && materialPath.diagnostics.length === 0
          ? [{
              severity: 'error',
              code: 'invalid-geometry',
              message: 'Brown 003 material path could not be built',
            }]
          : [...materialPath.diagnostics],
      );
    }

    try {
      // Phase evaluation is used here as the final composition/provenance gate.
      // The scalar phase itself belongs to presentation/material replay rather
      // than the generic ModelState contract, so the adapter does not invent a
      // new signal merely to carry it.
      resolveBrown003MaterialPhase(materialPath.path, continuity);
    } catch (error) {
      return stateFromContinuity(
        model,
        this.configuration,
        continuity,
        [{
          severity: 'error',
          code: 'invalid-input',
          message: error instanceof Error
            ? error.message
            : 'Brown 003 route and continuity results are incompatible',
        }],
      );
    }

    return stateFromContinuity(model, this.configuration, continuity, []);
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
      parameters: cloneOwnOverrides(this.parameters),
      modes: {},
    };
  }
}

class SpatialBeltCompiledModel implements CompiledModel {
  readonly capabilities = CAPABILITIES;

  constructor(readonly model: SimulationModel) {}

  createSession(options: SessionOptions = {}): ModelSession {
    return new SpatialBeltSession(this, options);
  }
}

/**
 * First spatial belt runtime adapter.
 *
 * v0 is deliberately Brown-003-specific. A successful state certifies that the
 * same resolved parameters satisfy the lumped fixed-axis continuity law, the
 * Brown 003 finite-face route, and the prescribed material-motion compatibility
 * contract. It does not solve friction, traction, tension, adhesion, pressure,
 * elastic creep, or dynamic belt stability.
 */
export const spatialBeltAdapter: SimulationAdapter = Object.freeze({
  id: 'atlas.spatial-belt.v0',

  supports(model): boolean {
    return adapterIdentityMatches(model);
  },

  compile(model): CompiledModel {
    const diagnostics = validateSimulationModel(model);
    if (hasErrors(diagnostics)) {
      throw new TypeError(diagnostics.map((diagnostic) => diagnostic.message).join('; '));
    }
    if (!adapterIdentityMatches(model)) {
      throw new TypeError('Model is not supported by the Brown 003 spatial belt adapter');
    }

    compileDefaultRoute(model);
    return new SpatialBeltCompiledModel(model);
  },
});
