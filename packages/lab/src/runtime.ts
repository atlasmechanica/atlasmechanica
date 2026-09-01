import {
  analyticBeltAdapter,
  analyticFourBarAdapter,
  canonicalFourBarModel,
  crossedBeltDriveModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import {
  quantity,
  type EvaluationRequest,
  type ModelId,
  type ModelState,
  type ParameterId,
  type QuantityValue,
  type SimulationAdapter,
  type SimulationModel,
  type UnitCode,
} from '@atlasmechanica/model';
import {
  brownBeltSceneCompiler,
  fourBarSceneCompiler,
  type MechanismSceneCompiler,
} from '@atlasmechanica/scene/compilers';
import { mechanismLabDefinitions } from './definitions.js';
import {
  MECHANISM_LAB_SCHEMA_VERSION,
  type LabControlDefinition,
  type LabReadoutDefinition,
  type MechanismLabDefinition,
} from './schema.js';

export interface ResolvedMechanismLab {
  readonly definition: MechanismLabDefinition;
  readonly model: SimulationModel;
  readonly adapter: SimulationAdapter;
  readonly sceneCompiler: MechanismSceneCompiler;
}

type ModelTransform = (model: SimulationModel) => SimulationModel;

const MODELS = new Map<ModelId, SimulationModel>([
  [openBeltDriveModel.id, openBeltDriveModel],
  [crossedBeltDriveModel.id, crossedBeltDriveModel],
  [canonicalFourBarModel.id, canonicalFourBarModel],
]);

const ADAPTERS = new Map<string, SimulationAdapter>([
  [analyticBeltAdapter.id, analyticBeltAdapter],
  [analyticFourBarAdapter.id, analyticFourBarAdapter],
]);

const SCENE_COMPILERS = new Map<string, MechanismSceneCompiler>([
  [brownBeltSceneCompiler.id, brownBeltSceneCompiler],
  [fourBarSceneCompiler.id, fourBarSceneCompiler],
]);

const LABS_BY_MODEL = new Map<ModelId, MechanismLabDefinition>();
for (const definition of mechanismLabDefinitions) {
  if (LABS_BY_MODEL.has(definition.modelId)) {
    throw new TypeError(`Duplicate mechanism lab model binding ${definition.modelId}`);
  }
  LABS_BY_MODEL.set(definition.modelId, definition);
}

function verticalBeltReference(model: SimulationModel): SimulationModel {
  const mechanical = model.systems.mechanical;
  const ground = mechanical?.bodies.ground;
  const driven = mechanical?.bodies.driven;
  const drivenAxis = ground?.features['driven-axis'];
  if (mechanical === undefined || ground === undefined || driven === undefined || drivenAxis?.type !== 'axis') {
    throw new TypeError('Vertical belt transform requires driver/driven shaft-center geometry');
  }

  return {
    ...model,
    systems: {
      ...model.systems,
      mechanical: {
        ...mechanical,
        bodies: {
          ...mechanical.bodies,
          ground: {
            ...ground,
            features: {
              ...ground.features,
              'driven-axis': {
                ...drivenAxis,
                origin: {
                  x: quantity(0, 'mm'),
                  y: { parameter: 'center-distance' },
                },
              },
            },
          },
          driven: {
            ...driven,
            referencePose: {
              ...driven.referencePose,
              x: quantity(0, 'mm'),
              y: { parameter: 'center-distance' },
            },
          },
        },
      },
    },
  };
}

const MODEL_TRANSFORMS = new Map<string, ModelTransform>([
  ['atlas.lab.vertical-belt.v0', verticalBeltReference],
]);

function finiteRange(control: LabControlDefinition): boolean {
  return Number.isFinite(control.min)
    && Number.isFinite(control.max)
    && Number.isFinite(control.step)
    && Number.isFinite(control.initial)
    && control.max > control.min
    && control.step > 0
    && control.initial >= control.min
    && control.initial <= control.max;
}

export function validateMechanismLabDefinition(
  definition: MechanismLabDefinition,
  model: SimulationModel,
): void {
  if (definition.schemaVersion !== MECHANISM_LAB_SCHEMA_VERSION) {
    throw new TypeError(
      `Mechanism lab ${definition.id} has unsupported schema version ${definition.schemaVersion}`,
    );
  }
  if (definition.modelId !== model.id) {
    throw new TypeError(`Mechanism lab ${definition.id} targets ${definition.modelId}, received ${model.id}`);
  }
  if (!definition.views.includes('2d')) {
    throw new TypeError(`Mechanism lab ${definition.id} must provide a 2D view`);
  }
  if (definition.sessionConfiguration !== undefined && model.configurations[definition.sessionConfiguration] === undefined) {
    throw new TypeError(
      `Mechanism lab ${definition.id} references unknown configuration ${definition.sessionConfiguration}`,
    );
  }

  for (const parameter of Object.keys(definition.parameterOverrides ?? {})) {
    if (model.parameters[parameter] === undefined) {
      throw new TypeError(`Mechanism lab ${definition.id} overrides unknown parameter ${parameter}`);
    }
  }

  const controlIds = new Set<string>();
  const queryKeys = new Set<string>();
  for (const control of definition.controls) {
    if (controlIds.has(control.id)) throw new TypeError(`Duplicate mechanism lab control ${control.id}`);
    controlIds.add(control.id);
    if (!finiteRange(control)) throw new TypeError(`Mechanism lab control ${control.id} has an invalid range`);
    if (control.queryKey !== undefined) {
      if (queryKeys.has(control.queryKey)) throw new TypeError(`Duplicate mechanism lab query key ${control.queryKey}`);
      queryKeys.add(control.queryKey);
    }
    if (control.kind === 'parameter') {
      if (model.parameters[control.parameter] === undefined) {
        throw new TypeError(`Mechanism lab control ${control.id} references unknown parameter ${control.parameter}`);
      }
      if (control.unit === 'rpm') {
        throw new TypeError(`Parameter control ${control.id} cannot use rpm`);
      }
    } else {
      if (model.coordinates[control.coordinate] === undefined) {
        throw new TypeError(`Mechanism lab control ${control.id} references unknown coordinate ${control.coordinate}`);
      }
      if (control.kind === 'coordinate' && control.unit === 'rpm') {
        throw new TypeError(`Coordinate control ${control.id} cannot use rpm`);
      }
    }
    if (control.interaction?.handle === 'input' && control.kind !== 'coordinate') {
      throw new TypeError(`Input interaction ${control.id} must bind a coordinate control`);
    }
    if (control.interaction?.handle === 'parameter' && control.kind !== 'parameter') {
      throw new TypeError(`Parameter interaction ${control.id} must bind a parameter control`);
    }
  }

  const readoutIds = new Set<string>();
  for (const readout of definition.readouts) {
    if (readoutIds.has(readout.id)) throw new TypeError(`Duplicate mechanism lab readout ${readout.id}`);
    readoutIds.add(readout.id);
    if (readout.source.kind === 'signal') {
      if (model.signals[readout.source.signal] === undefined) {
        throw new TypeError(`Mechanism lab readout ${readout.id} references unknown signal ${readout.source.signal}`);
      }
    } else if (model.coordinates[readout.source.coordinate] === undefined) {
      throw new TypeError(
        `Mechanism lab readout ${readout.id} references unknown coordinate ${readout.source.coordinate}`,
      );
    }
  }

  if (definition.animation !== undefined) {
    const coordinate = definition.controls.find((control) => control.id === definition.animation?.coordinateControlId);
    const rate = definition.controls.find((control) => control.id === definition.animation?.rateControlId);
    if (coordinate?.kind !== 'coordinate') {
      throw new TypeError(`Mechanism lab ${definition.id} animation coordinate control is invalid`);
    }
    if (rate?.kind !== 'rate' || rate.coordinate !== coordinate.coordinate) {
      throw new TypeError(`Mechanism lab ${definition.id} animation rate control is invalid`);
    }
  }
}

export function mechanismLabDefinitionForModel(modelId: ModelId): MechanismLabDefinition {
  const definition = LABS_BY_MODEL.get(modelId);
  if (definition === undefined) throw new TypeError(`No mechanism lab definition for model ${modelId}`);
  return definition;
}

export function resolveMechanismLab(modelId: ModelId, adapterId: string): ResolvedMechanismLab {
  const definition = mechanismLabDefinitionForModel(modelId);
  const baseModel = MODELS.get(modelId);
  if (baseModel === undefined) throw new TypeError(`No registered simulation model ${modelId}`);
  validateMechanismLabDefinition(definition, baseModel);

  const transform = definition.modelTransformId === undefined
    ? undefined
    : MODEL_TRANSFORMS.get(definition.modelTransformId);
  if (definition.modelTransformId !== undefined && transform === undefined) {
    throw new TypeError(`No registered lab model transform ${definition.modelTransformId}`);
  }
  const model = transform?.(baseModel) ?? baseModel;

  const adapter = ADAPTERS.get(adapterId);
  if (adapter === undefined) throw new TypeError(`No registered simulation adapter ${adapterId}`);
  if (!adapter.supports(model)) {
    throw new TypeError(`Simulation adapter ${adapterId} does not support ${modelId}`);
  }

  const sceneCompiler = SCENE_COMPILERS.get(definition.sceneCompilerId);
  if (sceneCompiler === undefined) {
    throw new TypeError(`No registered scene compiler ${definition.sceneCompilerId}`);
  }
  if (!sceneCompiler.supports(model)) {
    throw new TypeError(`Scene compiler ${sceneCompiler.id} does not support ${modelId}`);
  }

  return Object.freeze({ definition, model, adapter, sceneCompiler });
}

export function defaultLabValues(definition: MechanismLabDefinition): Record<string, number> {
  return Object.fromEntries(definition.controls.map((control) => [control.id, control.initial]));
}

function inputQuantity(value: number, unit: UnitCode | 'rpm'): QuantityValue {
  if (unit === 'rpm') return quantity(value * Math.PI * 2 / 60, 'rad/s');
  return quantity(value, unit);
}

export function buildLabEvaluationRequest(
  definition: MechanismLabDefinition,
  values: Readonly<Record<string, number>>,
): EvaluationRequest {
  const parameters: Partial<Record<ParameterId, QuantityValue>> = {
    ...(definition.parameterOverrides ?? {}),
  };
  const coordinates: NonNullable<EvaluationRequest['coordinates']> = {};
  const rates: NonNullable<EvaluationRequest['rates']> = {};

  for (const control of definition.controls) {
    const value = values[control.id];
    if (value === undefined || !Number.isFinite(value)) {
      throw new TypeError(`Mechanism lab control ${control.id} is missing a finite value`);
    }
    if (control.kind === 'parameter') {
      parameters[control.parameter] = inputQuantity(value, control.unit);
    } else if (control.kind === 'coordinate') {
      coordinates[control.coordinate] = inputQuantity(value, control.unit);
    } else {
      rates[control.coordinate] = inputQuantity(value, control.unit);
    }
  }

  return { parameters, coordinates, rates };
}

export function controlLabel(control: LabControlDefinition, model: SimulationModel): string {
  if (control.label !== undefined) return control.label;
  if (control.kind === 'parameter') return model.parameters[control.parameter]?.label ?? control.id;
  const coordinate = model.coordinates[control.coordinate];
  if (control.kind === 'rate') return coordinate === undefined ? control.id : `${coordinate.label} speed`;
  return coordinate?.label ?? control.id;
}

export function readoutLabel(readout: LabReadoutDefinition, model: SimulationModel): string {
  if (readout.label !== undefined) return readout.label;
  if (readout.source.kind === 'signal') return model.signals[readout.source.signal]?.label ?? readout.id;
  return model.coordinates[readout.source.coordinate]?.label ?? readout.id;
}

function numericReadout(readout: LabReadoutDefinition, value: number): string {
  const transformed = (readout.absolute ? Math.abs(value) : value) * (readout.scale ?? 1);
  const body = readout.digits === undefined ? String(transformed) : transformed.toFixed(readout.digits);
  return `${body}${readout.suffix ?? ''}`;
}

export function formatLabReadout(readout: LabReadoutDefinition, state: ModelState): string {
  if (readout.source.kind === 'signal') {
    const signal = state.signals[readout.source.signal];
    if (signal === undefined) return '—';
    if (signal.type === 'text') return readout.textMap?.[signal.value] ?? signal.value;
    if (signal.type !== 'scalar') return '—';
    return numericReadout(readout, signal.value.value);
  }

  const coordinate = state.coordinates[readout.source.coordinate];
  if (coordinate === undefined) return '—';
  const value = readout.source.kind === 'coordinate-position'
    ? coordinate.position.value
    : coordinate.velocity?.value;
  return value === undefined ? '—' : numericReadout(readout, value);
}
