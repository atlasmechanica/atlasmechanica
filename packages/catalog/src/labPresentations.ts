import type { MechanismLabDefinition } from '@atlasmechanica/lab';
import {
  LabPresentationError, resolveLabPresentation, validateLabPresentationSettings,
  type LabPresentationSettings,
} from '@atlasmechanica/lab/presentation';
import type { SimulationModel } from '@atlasmechanica/model';
import { at, compare, fail, freeze, id, object, unique, type Check, type Located } from './authoringChecks.js';
import type { CanonicalSubjectManifest } from './schema.js';
import type { CatalogSimulationBinding, ResolvedCatalogModelPreset } from './modelPresets.js';

/** The application supplies trusted definitions; JSON cannot supply module paths. */
export interface CatalogLabTemplate {
  readonly id: string;
  readonly adapterId: string;
  readonly definition: MechanismLabDefinition;
}
export interface CatalogLabPresentation {
  readonly id: string;
  readonly subject: string;
  readonly template: string;
  readonly settings?: LabPresentationSettings;
}
export interface ResolvedCatalogLabPresentation {
  readonly id: string;
  readonly subject: string;
  readonly template: string;
  readonly preset: string;
  /** Runtime family definition behind the authoring-template alias. */
  readonly templateLabId: string;
  readonly definition: MechanismLabDefinition;
}
const settingsCheck: Check = (value, source, pointer) => {
  try { validateLabPresentationSettings(value); }
  catch (error) {
    if (!(error instanceof LabPresentationError)) throw error;
    fail(source, `${pointer}${error.pointer}`, error.detail);
  }
};
export const labPresentationCheck = object({ id, subject: id, template: id }, { settings: settingsCheck });

export function compileCatalogLabPresentations(
  presentations: readonly Located<CatalogLabPresentation>[],
  templates: readonly CatalogLabTemplate[],
  models: ReadonlyMap<string, SimulationModel>,
  subjects: ReadonlyMap<string, CanonicalSubjectManifest>,
  presets: ReadonlyMap<string, ResolvedCatalogModelPreset>,
  bindings: readonly CatalogSimulationBinding[],
): readonly ResolvedCatalogLabPresentation[] {
  unique(presentations, 'id', (value) => value.id);
  unique(presentations, 'subject', (value) => value.subject);
  const byTemplate = new Map<string, CatalogLabTemplate>();
  for (const template of templates) {
    if (byTemplate.has(template.id)) fail('<labTemplates>', '', `Duplicate supplied lab template ${template.id}`);
    byTemplate.set(template.id, template);
  }
  const bySubject = new Map(bindings.map((binding) => [binding.subject, binding.preset]));
  return freeze(presentations.map((item): ResolvedCatalogLabPresentation => {
    const canonical = subjects.get(item.value.subject);
    if (canonical?.simulation === undefined) at(item, 'subject', 'Lab presentation requires a known subject with a simulation');
    const presetId = bySubject.get(item.value.subject);
    const preset = presetId === undefined ? undefined : presets.get(presetId);
    if (preset === undefined) at(item, 'subject', 'Lab presentation requires a resolved subject simulation binding');
    const model = models.get(preset.modelId);
    if (model === undefined) at(item, 'subject', 'Bound preset requires a supplied model');
    const template = byTemplate.get(item.value.template);
    if (template === undefined) at(item, 'template', `Unknown supplied lab template ${item.value.template}`);
    if (template.adapterId !== canonical.simulation.adapter) at(item, 'template', 'Template adapter must match the canonical simulation');
    try {
      const definition = resolveLabPresentation(item.value.id, item.value.settings ?? {}, template.definition, model, preset);
      return {
        id: item.value.id, subject: item.value.subject, template: item.value.template,
        preset: preset.id, templateLabId: template.definition.id, definition,
      };
    } catch (error) {
      if (!(error instanceof LabPresentationError)) {
        at(item, 'subject', `Invalid bound preset: ${error instanceof Error ? error.message : String(error)}`);
      }
      const pointer = error.pointer === '/template' || error.pointer === '/id' ? error.pointer
        : error.pointer === '/preset' ? '/subject' : `/settings${error.pointer}`;
      fail(item.source, `${item.pointer}${pointer}`, error.detail);
    }
  }).sort((a, b) => compare(a.id, b.id)));
}
