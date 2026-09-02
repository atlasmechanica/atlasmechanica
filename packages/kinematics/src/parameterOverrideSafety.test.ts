import { describe, expect, it } from 'vitest';

import { quantity, type QuantityValue } from '@atlasmechanica/model';
import { solveBrown003Route } from './brown003Route.js';
import { evaluateFixedAxisBeltContinuity } from './fixedAxisBeltContinuity.js';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';

function inheritedNameOverride(): Record<string, QuantityValue> {
  const overrides = Object.create(null) as Record<string, QuantityValue>;
  overrides.toString = quantity(30, 'mm');
  return overrides;
}

describe('fixed-axis parameter override safety', () => {
  it('rejects own override keys that collide with Object.prototype names', () => {
    const route = solveBrown003Route(canonicalQuarterTurnBeltModel, {
      parameters: inheritedNameOverride(),
    });
    expect(route.diagnostics[0]?.code).toBe('invalid-input');
    expect(route.diagnostics[0]?.message).toContain('Unknown parameter override toString');
    expect(route.spans).toEqual([]);

    const continuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      parameters: inheritedNameOverride(),
    });
    expect(continuity.diagnostics[0]?.code).toBe('invalid-input');
    expect(continuity.diagnostics[0]?.message).toContain('Unknown parameter override toString');
    expect(continuity.coordinates).toEqual({});
  });
});
