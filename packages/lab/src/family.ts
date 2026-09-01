import type {
  ModelId,
  SimulationAdapter,
  SimulationModel,
} from '@atlasmechanica/model';
import type { MechanismSceneCompiler } from '@atlasmechanica/scene/compilers';
import {
  selectMechanismLabDefinition,
  validateMechanismLabDefinition,
} from './core.js';
import type { MechanismLabDefinition } from './schema.js';

export type ModelTransform = (model: SimulationModel) => SimulationModel;

/**
 * One independently loadable mechanism family. A family may expose multiple
 * physical variants and multiple lab presentations while sharing adapters,
 * scene compilers, and transforms.
 */
export interface MechanismLabFamily {
  readonly definitions: readonly MechanismLabDefinition[];
  readonly models: readonly SimulationModel[];
  readonly adapters: readonly SimulationAdapter[];
  readonly sceneCompilers: readonly MechanismSceneCompiler[];
  readonly modelTransforms?: Readonly<Record<string, ModelTransform>>;
}

export interface ResolvedMechanismLab {
  readonly definition: MechanismLabDefinition;
  readonly model: SimulationModel;
  readonly adapter: SimulationAdapter;
  readonly sceneCompiler: MechanismSceneCompiler;
}

export function resolveMechanismLabFromFamily(
  family: MechanismLabFamily,
  modelId: ModelId,
  adapterId: string,
  labId?: string,
): ResolvedMechanismLab {
  const definition = selectMechanismLabDefinition(family.definitions, modelId, labId);
  const baseModel = family.models.find((candidate) => candidate.id === modelId);
  if (baseModel === undefined) throw new TypeError(`No registered simulation model ${modelId}`);
  validateMechanismLabDefinition(definition, baseModel);

  const transform = definition.modelTransformId === undefined
    ? undefined
    : family.modelTransforms?.[definition.modelTransformId];
  if (definition.modelTransformId !== undefined && transform === undefined) {
    throw new TypeError(`No registered lab model transform ${definition.modelTransformId}`);
  }
  const model = transform?.(baseModel) ?? baseModel;

  const adapter = family.adapters.find((candidate) => candidate.id === adapterId);
  if (adapter === undefined) throw new TypeError(`No registered simulation adapter ${adapterId}`);
  if (!adapter.supports(model)) {
    throw new TypeError(`Simulation adapter ${adapterId} does not support ${modelId}`);
  }

  const sceneCompiler = family.sceneCompilers.find(
    (candidate) => candidate.id === definition.sceneCompilerId,
  );
  if (sceneCompiler === undefined) {
    throw new TypeError(`No registered scene compiler ${definition.sceneCompilerId}`);
  }
  if (!sceneCompiler.supports(model)) {
    throw new TypeError(`Scene compiler ${sceneCompiler.id} does not support ${modelId}`);
  }

  return Object.freeze({ definition, model, adapter, sceneCompiler });
}
