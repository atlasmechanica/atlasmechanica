import { describe, expect, it } from 'vitest';

import {
  canonicalFourBarModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import {
  brownBeltSceneCompiler,
  fourBarSceneCompiler,
} from './compilers.js';

describe('registered mechanism scene compilers', () => {
  it('declares support by model subject', () => {
    expect(brownBeltSceneCompiler.supports(openBeltDriveModel)).toBe(true);
    expect(brownBeltSceneCompiler.supports(canonicalFourBarModel)).toBe(false);
    expect(fourBarSceneCompiler.supports(canonicalFourBarModel)).toBe(true);
    expect(fourBarSceneCompiler.supports(openBeltDriveModel)).toBe(false);
  });
});
