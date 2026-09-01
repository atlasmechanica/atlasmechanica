import type { MechanismScene } from '@atlasmechanica/scene';
import { resolveInteractionControl } from './core.js';
import type { MechanismLabDefinition } from './schema.js';

export function assertSceneInteractionBindings(
  definition: MechanismLabDefinition,
  scene: MechanismScene,
): void {
  for (const primitive of scene.primitives) {
    if (primitive.type !== 'handle' || primitive.handle === 'invalid') continue;
    const bindingId = primitive.bindingId;
    if (bindingId === undefined) {
      throw new TypeError(`Scene handle ${primitive.id} is missing a model binding`);
    }
    resolveInteractionControl(definition, primitive.handle, bindingId);
  }
}
