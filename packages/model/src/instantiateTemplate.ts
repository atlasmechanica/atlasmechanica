import type { SimulationModel } from './model.js';
import { validateSimulationModel } from './validation.js';

/** Serializable witness: the runtime must match this against its trusted template. */
export interface SimulationModelInstance {
  readonly id: string;
  readonly templateModelId: string;
  readonly model: SimulationModel;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * Instantiate a trusted, plain-data physical template with a new identity only.
 * Dimensions still come from the existing validated preset/session parameters.
 * No arbitrary topology patches, code, metadata rebinding or solver output.
 * Validation here is structural; the selected adapter must still evaluate it.
 */
export function instantiateSimulationModel(
  template: SimulationModel,
  id: string,
): SimulationModelInstance {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/.test(id)) {
    throw new TypeError('Model instance requires a stable lowercase id');
  }
  if (id === template.id) throw new TypeError('Model instance must have a new identity');
  // Own the data before freezing: never freeze or modify a caller's template.
  const model: SimulationModel = { ...structuredClone(template), id };
  const errors = validateSimulationModel(model).filter((item) => item.severity === 'error');
  if (errors.length > 0) throw new TypeError(`Invalid model template: ${errors.map((item) => item.message).join('; ')}`);
  return freeze({ id, templateModelId: template.id, model });
}
