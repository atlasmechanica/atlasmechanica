import {
  quantity,
  quantityKind,
  type EvaluationRequest,
  type ModelId,
  type ModelState,
  type ParameterId,
  type QuantityValue,
  type SimulationModel,
  type UnitCode,
} from '@atlasmechanica/model';
import {
  MECHANISM_LAB_SCHEMA_VERSION,
  type LabControlDefinition,
  type LabReadoutDefinition,
  type MechanismLabDefinition,
} from './schema.js';

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

export function selectMechanismLabDefinition(
  definitions: readonly MechanismLabDefinition[],
  modelId: ModelId,
  labId?: string,
): MechanismLabDefinition {
  const ids = new Set<string>();
  const candidates: MechanismLabDefinition[] = [];
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new TypeError(`Duplicate mechanism lab id ${definition.id}`);
    ids.add(definition.id);
    if (definition.modelId === modelId) candidates.push(definition);
  }

  if (labId !== undefined) {
    const exact = candidates.find((definition) => definition.id === labId);
    if (exact === undefined) {
      throw new TypeError(`No mechanism lab ${labId} for model ${modelId}`);
    }
    return exact;
  }

  const defaults = candidates.filter((definition) => definition.defaultForModel === true);
  if (defaults.length > 1) {
    throw new TypeError(`Multiple default mechanism labs for model ${modelId}`);
  }
  if (defaults.length === 1) return defaults[0] as MechanismLabDefinition;
  if (candidates.length === 1) return candidates[0] as MechanismLabDefinition;
  if (candidates.length === 0) throw new TypeError(`No mechanism lab definition for model ${modelId}`);
  throw new TypeError(`Model ${modelId} has multiple labs but no default presentation`);
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
  if (definition.views.includes('3d') && definition.threeRendererId === undefined) {
    throw new TypeError(`Mechanism lab ${definition.id} advertises 3D without a renderer binding`);
  }
  if (definition.sessionConfiguration !== undefined && model.configurations[definition.sessionConfiguration] === undefined) {
    throw new TypeError(
      `Mechanism lab ${definition.id} references unknown configuration ${definition.sessionConfiguration}`,
    );
  }

  for (const [parameter, override] of Object.entries(definition.parameterOverrides ?? {})) {
    const modelParameter = model.parameters[parameter];
    if (modelParameter === undefined) {
      throw new TypeError(`Mechanism lab ${definition.id} overrides unknown parameter ${parameter}`);
    }
    if (quantityKind(override) !== modelParameter.kind) {
      throw new TypeError(
        `Mechanism lab ${definition.id} override ${parameter} has incompatible unit ${override.unit}`,
      );
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
      const parameter = model.parameters[control.parameter];
      if (parameter === undefined) {
        throw new TypeError(`Mechanism lab control ${control.id} references unknown parameter ${control.parameter}`);
      }
      if (control.unit === 'rpm' || quantityKind(quantity(1, control.unit)) !== parameter.kind) {
        throw new TypeError(
          `Mechanism lab parameter control ${control.id} unit ${control.unit} is incompatible with ${parameter.kind}`,
        );
      }
    } else {
      if (model.coordinates[control.coordinate] === undefined) {
        throw new TypeError(`Mechanism lab control ${control.id} references unknown coordinate ${control.coordinate}`);
      }
      if (control.kind === 'coordinate') {
        if (control.unit !== 'rad' && control.unit !== 'deg') {
          throw new TypeError(
            `Mechanism lab coordinate control ${control.id} requires rad or deg units`,
          );
        }
      } else if (
        control.unit !== 'rpm'
        && control.unit !== 'rad/s'
        && control.unit !== 'deg/s'
      ) {
        throw new TypeError(
          `Mechanism lab rate control ${control.id} requires rpm, rad/s, or deg/s units`,
        );
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
      const signal = model.signals[readout.source.signal];
      if (signal === undefined) {
        throw new TypeError(`Mechanism lab readout ${readout.id} references unknown signal ${readout.source.signal}`);
      }
      if (signal.valueType !== 'scalar' && signal.valueType !== 'text') {
        throw new TypeError(
          `Mechanism lab readout ${readout.id} cannot format ${signal.valueType} signal ${readout.source.signal}`,
        );
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
