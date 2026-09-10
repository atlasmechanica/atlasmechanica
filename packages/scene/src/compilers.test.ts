import { describe, expect, it } from 'vitest';

import {
  canonicalFourBarModel,
  canonicalQuarterTurnBeltModel,
  crossedBeltDriveModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import {
  brown003SpatialSceneCompiler,
  brownBeltSceneCompiler,
  fourBarSceneCompiler,
} from './compilers.js';

describe('registered mechanism scene compilers', () => {
  it('keeps planar and spatial belt presentation contracts disjoint', () => {
    expect(brownBeltSceneCompiler.supports(openBeltDriveModel)).toBe(true);
    expect(brownBeltSceneCompiler.supports(crossedBeltDriveModel)).toBe(true);
    expect(brownBeltSceneCompiler.supports(canonicalQuarterTurnBeltModel)).toBe(false);
    expect(brownBeltSceneCompiler.supports(canonicalFourBarModel)).toBe(false);

    expect(brown003SpatialSceneCompiler.supports(canonicalQuarterTurnBeltModel)).toBe(true);
    expect(brown003SpatialSceneCompiler.supports(openBeltDriveModel)).toBe(false);
    expect(brown003SpatialSceneCompiler.supports(crossedBeltDriveModel)).toBe(false);

    expect(fourBarSceneCompiler.supports(canonicalFourBarModel)).toBe(true);
    expect(fourBarSceneCompiler.supports(openBeltDriveModel)).toBe(false);
  });
});
