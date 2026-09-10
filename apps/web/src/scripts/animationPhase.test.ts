import { buildLabEvaluationRequest } from '@atlasmechanica/lab';
import { resolveMechanismLab } from '@atlasmechanica/lab/runtime';
import { describe, expect, it } from 'vitest';

import {
  advancePeriodicAnimation,
  wrapPeriodicValue,
} from './animationPhase.js';

function beltTravelAtDriverAngle(angleDeg: number): number {
  const { definition, model, adapter } = resolveMechanismLab(
    'foundation:belt-drive:quarter-turn-guided',
    'atlas.spatial-belt.v0',
    'lab:foundation:belt-drive:quarter-turn-guided:brown-003',
  );
  const session = adapter.compile(model).createSession({ configuration: 'reference' });
  const request = buildLabEvaluationRequest(definition, {
    'driver-angle': angleDeg,
    'driver-speed': 30,
  });
  const state = session.evaluate(request);
  const signal = state.signals['belt-travel'];
  if (signal?.type !== 'scalar') throw new TypeError('Brown 003 belt-travel signal is unavailable');
  return signal.value.value;
}

describe('periodic animation phase', () => {
  it('keeps the model evaluation unwrapped while the presentation crosses 360 degrees', () => {
    const step = advancePeriodicAnimation(359, 2, 0, 360);

    expect(step.evaluationValue).toBe(361);
    expect(step.presentationValue).toBe(1);
  });

  it('keeps Brown 003 model-owned belt travel continuous across the display wrap', () => {
    const step = advancePeriodicAnimation(359, 2, 0, 360);
    const before = beltTravelAtDriverAngle(359);
    const after = beltTravelAtDriverAngle(step.evaluationValue);
    const incorrectlyWrapped = beltTravelAtDriverAngle(step.presentationValue);

    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeCloseTo(0.045 * 2 * Math.PI / 180, 12);
    expect(incorrectlyWrapped).toBeLessThan(before);
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
