import {
  analyticBeltAdapter,
  crossedBeltDriveModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import { quantity, type SimulationModel } from '@atlasmechanica/model';
import { brownBeltSceneCompiler } from '@atlasmechanica/scene/compilers';
import { crossedBeltDriveLab, openBeltDriveLab } from '../definitions.js';
import type { MechanismLabRuntimeProvider } from '../provider.js';

function verticalBeltReference(model: SimulationModel): SimulationModel {
  const mechanical = model.systems.mechanical;
  const ground = mechanical?.bodies.ground;
  const driven = mechanical?.bodies.driven;
  const drivenAxis = ground?.features['driven-axis'];
  if (mechanical === undefined || ground === undefined || driven === undefined || drivenAxis?.type !== 'axis') {
    throw new TypeError('Vertical belt transform requires driver/driven shaft-center geometry');
  }

  return {
    ...model,
    systems: {
      ...model.systems,
      mechanical: {
        ...mechanical,
        bodies: {
          ...mechanical.bodies,
          ground: {
            ...ground,
            features: {
              ...ground.features,
              'driven-axis': {
                ...drivenAxis,
                origin: {
                  x: quantity(0, 'mm'),
                  y: { parameter: 'center-distance' },
                },
              },
            },
          },
          driven: {
            ...driven,
            referencePose: {
              ...driven.referencePose,
              x: quantity(0, 'mm'),
              y: { parameter: 'center-distance' },
            },
          },
        },
      },
    },
  };
}

export const beltLabProvider: MechanismLabRuntimeProvider = Object.freeze({
  definitions: Object.freeze([openBeltDriveLab, crossedBeltDriveLab]),
  models: Object.freeze([openBeltDriveModel, crossedBeltDriveModel]),
  adapters: Object.freeze([analyticBeltAdapter]),
  sceneCompilers: Object.freeze([brownBeltSceneCompiler]),
  modelTransforms: Object.freeze({
    'atlas.lab.vertical-belt.v0': verticalBeltReference,
  }),
});
