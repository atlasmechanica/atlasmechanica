import { instantiateSimulationModel, type SimulationModel, type SimulationModelInstance } from '@atlasmechanica/model';
import { validateMechanismLabDefinition } from './core.js';
import { resolveLabPresentation, type LabPresentationSettings } from './presentation.js';
import type { MechanismLabDefinition } from './schema.js';

/** Runtime selection plus an optional physical-template compatibility witness. */
export interface LabPresentationSelection {
  /** Registered family definition, not the catalog's authoring-template alias. */
  readonly templateLabId: string;
  readonly definition: MechanismLabDefinition;
  readonly modelInstance?: SimulationModelInstance;
}
export type MechanismLabSelection = string | LabPresentationSelection;

type Data = null | boolean | number | string | Data[] | { [key: string]: Data };

/** Copy plain serialized data without invoking getters, iterators or toJSON. */
function copyData(value: unknown, ancestors = new Set<object>(), depth = 0): Data {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null) throw new TypeError('Lab selection requires finite JSON data');
  if (depth > 64 || ancestors.has(value)) throw new TypeError('Lab selection is cyclic or too deeply nested');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Lab selection requires plain data objects and arrays');
  }
  ancestors.add(value);
  const result: Data[] | { [key: string]: Data } = array ? [] : {};
  let indexes = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError('Lab selection does not accept symbol keys');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Lab selection does not accept accessors');
    }
    if (array && key === 'length') continue;
    if (!descriptor.enumerable) throw new TypeError('Lab selection requires enumerable data properties');
    if (array) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
        throw new TypeError('Lab selection array has a custom property');
      }
      indexes += 1;
    }
    Object.defineProperty(result, key, {
      value: copyData(descriptor.value, ancestors, depth + 1), enumerable: true,
      writable: true, configurable: true,
    });
  }
  if (array && indexes !== value.length) throw new TypeError('Lab selection does not accept sparse arrays');
  ancestors.delete(value);
  return Object.freeze(result) as Data;
}

/** Snapshot before lazy imports yield; a caller cannot change an in-flight request. */
export function snapshotLabSelection(selection: MechanismLabSelection | undefined): MechanismLabSelection | undefined {
  if (selection === undefined || typeof selection === 'string') return selection;
  const copy = copyData(selection);
  if (copy === null || typeof copy !== 'object' || Array.isArray(copy)
    || typeof copy.templateLabId !== 'string' || copy.templateLabId.trim() === ''
    || copy.definition === null || typeof copy.definition !== 'object' || Array.isArray(copy.definition)) {
    throw new TypeError('Lab selection requires templateLabId and a compiled definition');
  }
  if (Object.hasOwn(copy, 'modelInstance')) {
    const instance = copy.modelInstance;
    if (instance === null || typeof instance !== 'object' || Array.isArray(instance)
      || Object.keys(instance).some((key) => !['id', 'templateModelId', 'model'].includes(key))
      || typeof instance.id !== 'string' || instance.id.trim() === ''
      || typeof instance.templateModelId !== 'string' || instance.templateModelId.trim() === ''
      || instance.model === null || typeof instance.model !== 'object' || Array.isArray(instance.model)) {
      throw new TypeError('Lab model instance requires an id, trusted templateModelId and model data');
    }
  }
  // Only the selected template, definition and physical-instance witness cross
  // this boundary; catalog graph/reference checks remain with its compiler.
  return Object.freeze({
    templateLabId: copy.templateLabId,
    definition: copy.definition as unknown as MechanismLabDefinition,
    ...(Object.hasOwn(copy, 'modelInstance') ? { modelInstance: copy.modelInstance as unknown as SimulationModelInstance } : {}),
  });
}

/** Data equality is independent of object-key order, but preserves array order. */
function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return keys.every((key) => Object.hasOwn(b, key) && sameData(a[key], b[key]));
}

/** A template ID alone is not proof that build-time and runtime physical data agree. */
export function restoreModelInstance(
  selection: SimulationModelInstance, template: SimulationModel, modelId: string,
): SimulationModelInstance {
  const expected = instantiateSimulationModel(template, modelId);
  if (!sameData(selection, expected)) {
    throw new TypeError(`Model instance ${modelId} is incompatible with loaded template ${template.id}`);
  }
  return expected;
}

/**
 * Reconstruct only supported presentation choices against the loaded template,
 * then compare the entire result. A compiled-looking object cannot inject a
 * renderer, transform, physical binding, new control, or changed readout formula.
 * The normal presentation validator remains the sole override-policy authority.
 */
export function restoreLabPresentation(
  selection: LabPresentationSelection,
  template: MechanismLabDefinition,
  model: SimulationModel,
): MechanismLabDefinition {
  const candidate = selection.definition;
  validateMechanismLabDefinition(candidate, model);
  if (typeof candidate.sessionConfiguration !== 'string' || candidate.parameterOverrides === undefined) {
    throw new TypeError('Compiled lab presentation requires its complete physical preset');
  }
  const settings: LabPresentationSettings = {
    ...(candidate.subtitle === undefined ? {} : { subtitle: candidate.subtitle }),
    views: candidate.views,
    controls: candidate.controls.map((control) => ({
      id: control.id,
      ...(control.label === undefined ? {} : { label: control.label }),
      min: control.min, max: control.max, step: control.step,
      ...(control.kind === 'parameter' ? {} : { initial: control.initial }),
    })),
    readouts: candidate.readouts.map((readout) => ({
      id: readout.id,
      ...(readout.label === undefined ? {} : { label: readout.label }),
      ...(readout.digits === undefined ? {} : { digits: readout.digits }),
    })),
  };
  const restored = resolveLabPresentation(candidate.id, settings, template, model, {
    modelId: candidate.modelId,
    configuration: candidate.sessionConfiguration,
    parameters: candidate.parameterOverrides,
  });
  if (!sameData(candidate, restored)) {
    throw new TypeError(`Compiled lab presentation ${candidate.id} is incompatible with registered template ${selection.templateLabId}`);
  }
  return restored;
}
