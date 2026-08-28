import { describe, expect, it } from 'vitest';
import snapshot from './fixtures/fourBarConstraintPlan.json';
import { canonicalFourBarModel } from './fixtures/fourBar.js';
import { compileFourBarConstraintPlan } from './fourBarConstraintPlan.js';

describe('four-bar portable constraint plan', () => {
  it('is derived exactly from the canonical SimulationModel fixture', () => {
    expect(compileFourBarConstraintPlan(canonicalFourBarModel)).toEqual(snapshot);
  });
});
