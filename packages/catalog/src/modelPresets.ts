import {
  ParameterValueError,
  resolveParameterValues,
  validateSimulationModel,
  type QuantityValue,
  type ResolvedParameterValues,
  type SimulationModel,
} from '@atlasmechanica/model';
import { CatalogAuthoringError } from './authoringError.js';
import type { CatalogLabTemplate } from './labPresentations.js';

/** A named parameter preset references a physical model; it is not a new model. */
export interface CatalogModelPreset {
  readonly id: string;
  readonly modelId: string;
  readonly configuration?: string;
  readonly parameters?: Readonly<Record<string, QuantityValue>>;
}

export interface CatalogSimulationBinding {
  readonly subject: string;
  readonly preset: string;
}

export interface ResolvedCatalogModelPreset {
  readonly id: string;
  readonly modelId: string;
  readonly configuration: string;
  readonly parameters: ResolvedParameterValues;
}

export interface CatalogCompileOptions {
  /** Supplied by the application/family layer. No hidden fixture registry. */
  readonly models?: readonly SimulationModel[];
  /** Pure data definitions, not loaded engines or renderer modules. */
  readonly labTemplates?: readonly CatalogLabTemplate[];
}

/**
 * Validates a parsed preset against a supplied model definition. This returns
 * initial configuration data only, not a successful solver state or a geometry
 * certificate. The adapter must still evaluate these exact parameters.
 */
export function resolveCatalogModelPreset(
  preset: CatalogModelPreset,
  model: SimulationModel,
  source: string,
  pointer: string,
): ResolvedCatalogModelPreset {
  if (preset.modelId !== model.id) {
    throw new CatalogAuthoringError(source, `${pointer}/modelId`, 'Preset and model identity differ');
  }
  try {
    const diagnostic = validateSimulationModel(model).find((item) => item.severity === 'error');
    if (diagnostic !== undefined) throw new Error(diagnostic.message);
  } catch (error) {
    throw new CatalogAuthoringError(source, `${pointer}/modelId`, `Invalid referenced model: ${error instanceof Error ? error.message : String(error)}`);
  }
  const configurations = Object.keys(model.configurations);
  const configuration = preset.configuration ?? (configurations.length === 1 ? configurations[0] : undefined);
  if (configuration === undefined || !Object.hasOwn(model.configurations, configuration)) {
    throw new CatalogAuthoringError(source, `${pointer}/configuration`, 'Select a known configuration explicitly when the model has multiple configurations');
  }
  let parameters: ResolvedParameterValues;
  try {
    parameters = resolveParameterValues(model.parameters, preset.parameters ?? {});
  } catch (error) {
    if (!(error instanceof ParameterValueError)) throw error;
    const location = error.pointer.startsWith('/overrides/0')
      ? `${pointer}/parameters${error.pointer.slice('/overrides/0'.length)}`
      : `${pointer}/modelId`;
    throw new CatalogAuthoringError(source, location, error.detail);
  }
  return Object.freeze({ id: preset.id, modelId: model.id, configuration, parameters });
}
