import { describe, expect, it } from 'vitest';

import {
  advancePeriodicAnimation,
  wrapPeriodicValue,
} from './animationPhase.js';

describe('periodic animation phase', () => {
  it('keeps the model evaluation unwrapped while the presentation crosses 360 degrees', () => {
    const step = advancePeriodicAnimation(359, 2, 0, 360);

    expect(step.evaluationValue).toBe(361);
    expect(step.presentationValue).toBe(1);
  });

  it('preserves accumulated turns across repeated display wraps', () => {
    const first = advancePeriodicAnimation(719, 2, 0, 360);
    const second = advancePeriodicAnimation(first.evaluationValue, 360, 0, 360);

    expect(first).toEqual({ evaluationValue: 721, presentationValue: 1 });
    expect(second).toEqual({ evaluationValue: 1081, presentationValue: 1 });
  });

  it('wraps negative presentation values without changing their continuous source', () => {
    expect(wrapPeriodicValue(-1, 0, 360)).toBe(359);
    expect(advancePeriodicAnimation(1, -2, 0, 360)).toEqual({
      evaluationValue: -1,
      presentationValue: 359,
    });
  });
});
