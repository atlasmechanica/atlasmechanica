import {
  instantiateSimulationModel,
  type SimulationModel,
  type SimulationModelInstance,
} from '@atlasmechanica/model';
import { at, compare, freeze, id, object, unique, type Located } from './authoringChecks.js';

/** New identity of a supplied physical template, not a second topology language. */
export interface CatalogModelInstance {
  readonly id: string;
  readonly templateModelId: string;
}
export type ResolvedCatalogModelInstance = SimulationModelInstance;
export const modelInstanceCheck = object({ id, templateModelId: id });

export function compileCatalogModelInstances(
  items: readonly Located<CatalogModelInstance>[],
  suppliedModels: ReadonlyMap<string, SimulationModel>,
): readonly ResolvedCatalogModelInstance[] {
  unique(items, 'id', (value) => value.id);
  return freeze(items.map((item) => {
    if (suppliedModels.has(item.value.id)) at(item, 'id', `Model instance collides with supplied model ${item.value.id}`);
    // Only application-supplied roots can be templates. Instance chains/cycles
    // are deliberately unsupported, so order cannot alter what gets created.
    const template = suppliedModels.get(item.value.templateModelId);
    if (template === undefined) at(item, 'templateModelId', `Unknown supplied model template ${item.value.templateModelId}`);
    try { return instantiateSimulationModel(template, item.value.id); }
    catch (error) {
      at(item, 'templateModelId', error instanceof Error ? error.message : 'Invalid supplied model template');
    }
  }).sort((a, b) => compare(a.id, b.id)));
}
