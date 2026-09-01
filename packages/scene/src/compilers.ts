import type { SimulationModel } from '@atlasmechanica/model';
import {
  buildMechanismScene as buildSchematicMechanismScene,
  type SceneBuildOptions,
} from './buildMechanismScene.js';
import { buildMechanismScene as buildProductionMechanismScene } from './index.js';
import type { MechanismScene, ScenePrimitive } from './types.js';

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

function tagLegacyBeltEntity(primitive: ScenePrimitive): ScenePrimitive {
  if (primitive.id === 'belt-driver' && primitive.type === 'circle') {
    return {
      ...primitive,
      entity: { kind: 'pulley', id: 'driver.pulley', role: 'driver' },
    };
  }
  if (primitive.id === 'belt-driven' && primitive.type === 'circle') {
    return {
      ...primitive,
      entity: { kind: 'pulley', id: 'driven.pulley', role: 'driven' },
    };
  }
  if ((primitive.id === 'belt-path' || primitive.id === 'belt-band-underlay') && primitive.type === 'polyline') {
    return {
      ...primitive,
      entity: { kind: 'belt', id: 'belt', role: 'transmission' },
    };
  }
  return primitive;
}

function semanticBrownBeltScene(scene: MechanismScene): MechanismScene {
  return {
    ...scene,
    primitives: scene.primitives.map(tagLegacyBeltEntity),
  };
}

export const brownBeltSceneCompiler: MechanismSceneCompiler = {
  id: 'atlas.scene.brown-belt.v0',
  supports(model): boolean {
    return model.subject === 'belt-drive';
  },
  build(options): MechanismScene {
    assertSubject(options.model, 'belt-drive', this.id);
    return semanticBrownBeltScene(buildProductionMechanismScene(options));
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
