import type { SimulationModel } from '@atlasmechanica/model';
import { buildBrown003ProjectionScene } from './brown003Projection.js';
import {
  buildMechanismScene as buildSchematicMechanismScene,
  type SceneBuildOptions,
} from './buildMechanismScene.js';
import { buildMechanismScene as buildProductionMechanismScene } from './index.js';
import type { MechanismScene } from './types.js';

export interface MechanismSceneCompiler {
  readonly id: string;
  supports(model: SimulationModel): boolean;
  build(options: SceneBuildOptions): MechanismScene;
}

function assertSubject(model: SimulationModel, expected: string, compilerId: string): void {
  if (model.subject !== expected) {
    throw new TypeError(`${compilerId} does not support model subject ${model.subject}`);
  }
}

export const brownBeltSceneCompiler: MechanismSceneCompiler = {
  id: 'atlas.scene.brown-belt.v0',
  supports(model): boolean {
    return model.subject === 'belt-drive';
  },
  build(options): MechanismScene {
    assertSubject(options.model, 'belt-drive', this.id);
    return buildProductionMechanismScene(options);
  },
};

export const brown003SpatialSceneCompiler: MechanismSceneCompiler = {
  id: 'atlas.scene.brown-003-spatial.v0',
  supports(model): boolean {
    return model.id === 'foundation:belt-drive:quarter-turn-guided';
  },
  build(options): MechanismScene {
    if (!this.supports(options.model)) {
      throw new TypeError(`${this.id} does not support model ${options.model.id}`);
    }
    return buildBrown003ProjectionScene(options);
  },
};

export const fourBarSceneCompiler: MechanismSceneCompiler = {
  id: 'atlas.scene.four-bar.v0',
  supports(model): boolean {
    return model.subject === 'four-bar-linkage';
  },
  build(options): MechanismScene {
    assertSubject(options.model, 'four-bar-linkage', this.id);
    return buildSchematicMechanismScene(options);
  },
};
