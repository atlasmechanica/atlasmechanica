import { describe, expect, it } from 'vitest';
import type { MechanismScene } from '@atlasmechanica/scene';
import { MECHANISM_LAB_SCHEMA_VERSION, defineMechanismLab } from './schema.js';
import { assertSceneInteractionBindings } from './interactionScene.js';

const definition = defineMechanismLab({
  schemaVersion: MECHANISM_LAB_SCHEMA_VERSION,
  id: 'lab:test:bindings',
  modelId: 'test:model',
  sceneCompilerId: 'test.scene',
  views: ['2d'],
  controls: [
    {
      id: 'angle',
      kind: 'coordinate',
      coordinate: 'driver-angle',
      unit: 'deg',
      min: 0,
      max: 360,
      step: 1,
      initial: 0,
      interaction: {
        handle: 'input',
        mapping: { type: 'polar-angle', origin: [0, 0] },
      },
    },
    {
      id: 'length',
      kind: 'parameter',
      parameter: 'ground-length',
      unit: 'mm',
      min: 1,
      max: 10,
      step: 1,
      initial: 5,
      interaction: {
        handle: 'parameter',
        mapping: { type: 'axis-value', axis: 'x', scale: 1 },
      },
    },
  ],
  readouts: [],
});

const scene: MechanismScene = {
  id: 'scene:test',
  title: 'Binding test',
  viewport: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
  primitives: [
    {
      id: 'angle-handle',
      type: 'handle',
      layer: 'interaction',
      styles: ['handle'],
      at: { x: 1, y: 1 },
      handle: 'input',
      bindingId: 'driver-angle',
    },
    {
      id: 'length-handle',
      type: 'handle',
      layer: 'interaction',
      styles: ['handle'],
      at: { x: 2, y: 1 },
      handle: 'parameter',
      bindingId: 'ground-length',
    },
  ],
};

describe('scene interaction bindings', () => {
  it('accepts handles bound to model inputs exposed by the lab', () => {
    expect(() => assertSceneInteractionBindings(definition, scene)).not.toThrow();
  });

  it('rejects a scene compiler that emits an unknown model binding', () => {
    const invalid: MechanismScene = {
      ...scene,
      primitives: scene.primitives.map((primitive) => (
        primitive.type === 'handle' && primitive.handle === 'input'
          ? { ...primitive, bindingId: 'missing-coordinate' }
          : primitive
      )),
    };

    expect(() => assertSceneInteractionBindings(definition, invalid)).toThrow(
      'No input control binds model input missing-coordinate',
    );
  });
});
