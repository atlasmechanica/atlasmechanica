import type {
  ModelId,
  SimulationAdapter,
  SimulationModel,
  SimulationModelInstance,
} from '@atlasmechanica/model';
import type { MechanismSceneCompiler } from '@atlasmechanica/scene/compilers';
import {
  selectMechanismLabDefinition,
  validateMechanismLabDefinition,
} from './core.js';
import { assertSceneInteractionBindings } from './interactionScene.js';
import {
  restoreLabPresentation, restoreModelInstance, snapshotLabSelection, type MechanismLabSelection,
} from './presentationSelection.js';
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
  readonly modelInstance?: SimulationModelInstance;
}

export function resolveMechanismLabFromFamily(
  family: MechanismLabFamily,
  modelId: ModelId,
  adapterId: string,
  lab?: MechanismLabSelection,
): ResolvedMechanismLab {
  const selection = snapshotLabSelection(lab);
  const presentation = typeof selection === 'object' ? selection : undefined;
  const instanceSelection = presentation?.modelInstance;
  const templateModelId = instanceSelection?.templateModelId ?? modelId;
  if (instanceSelection !== undefined && family.models.some((candidate) => candidate.id === modelId)) {
    throw new TypeError(`Model instance collides with registered simulation model ${modelId}`);
  }
  const registeredTemplate = selectMechanismLabDefinition(
    family.definitions, templateModelId, presentation?.templateLabId ?? (typeof selection === 'string' ? selection : undefined),
  );
  const templateModel = family.models.find((candidate) => candidate.id === templateModelId);
  if (templateModel === undefined) throw new TypeError(`No registered simulation model ${templateModelId}`);
  const modelInstance = instanceSelection === undefined ? undefined
    : restoreModelInstance(instanceSelection, templateModel, modelId);
  const baseModel = modelInstance?.model ?? templateModel;
  const template = modelInstance === undefined ? registeredTemplate : { ...registeredTemplate, modelId };
  const definition = presentation === undefined
    ? template : restoreLabPresentation(presentation, template, baseModel);
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

  const registeredSceneCompiler = family.sceneCompilers.find(
    (candidate) => candidate.id === definition.sceneCompilerId,
  );
  if (registeredSceneCompiler === undefined) {
    throw new TypeError(`No registered scene compiler ${definition.sceneCompilerId}`);
  }
  if (!registeredSceneCompiler.supports(model)) {
    throw new TypeError(`Scene compiler ${registeredSceneCompiler.id} does not support ${modelId}`);
  }

  const sceneCompiler: MechanismSceneCompiler = Object.freeze({
    id: registeredSceneCompiler.id,
    supports(candidate: SimulationModel): boolean {
      return registeredSceneCompiler.supports(candidate);
    },
    build(options: Parameters<MechanismSceneCompiler['build']>[0]) {
      const scene = registeredSceneCompiler.build(options);
      assertSceneInteractionBindings(definition, scene);
      return scene;
    },
  });

  return Object.freeze({ definition, model, adapter, sceneCompiler, ...(modelInstance === undefined ? {} : { modelInstance }) });
}
