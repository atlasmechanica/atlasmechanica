import {
  analyticFourBarAdapter,
  canonicalFourBarModel,
} from '@atlasmechanica/kinematics';
import { fourBarSceneCompiler } from '@atlasmechanica/scene/compilers';
import { canonicalFourBarLab } from '../definitions/fourBar.js';
import type { MechanismLabRuntimeProvider } from '../provider.js';

export const fourBarLabProvider: MechanismLabRuntimeProvider = Object.freeze({
  definitions: Object.freeze([canonicalFourBarLab]),
  models: Object.freeze([canonicalFourBarModel]),
  adapters: Object.freeze([analyticFourBarAdapter]),
  sceneCompilers: Object.freeze([fourBarSceneCompiler]),
});
