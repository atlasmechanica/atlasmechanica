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

export interface MechanismLabRuntimeProvider {
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

export function resolveMechanismLabFromProvider(
  provider: MechanismLabRuntimeProvider,
  modelId: ModelId,
  adapterId: string,
  labId?: string,
): ResolvedMechanismLab {
  const definition = selectMechanismLabDefinition(provider.definitions, modelId, labId);
  const baseModel = provider.models.find((candidate) => candidate.id === modelId);
  if (baseModel === undefined) throw new TypeError(`No registered simulation model ${modelId}`);
  validateMechanismLabDefinition(definition, baseModel);

  const transform = definition.modelTransformId === undefined
    ? undefined
    : provider.modelTransforms?.[definition.modelTransformId];
  if (definition.modelTransformId !== undefined && transform === undefined) {
    throw new TypeError(`No registered lab model transform ${definition.modelTransformId}`);
  }
  const model = transform?.(baseModel) ?? baseModel;

  const adapter = provider.adapters.find((candidate) => candidate.id === adapterId);
  if (adapter === undefined) throw new TypeError(`No registered simulation adapter ${adapterId}`);
  if (!adapter.supports(model)) {
    throw new TypeError(`Simulation adapter ${adapterId} does not support ${modelId}`);
  }

  const sceneCompiler = provider.sceneCompilers.find(
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
