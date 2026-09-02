import { describe, expect, it } from 'vitest';

import { quantity, type QuantityValue } from '@atlasmechanica/model';
import { solveBrown003Route } from './brown003Route.js';
import { evaluateFixedAxisBeltContinuity } from './fixedAxisBeltContinuity.js';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';

function inheritedNameOverride(): Record<string, QuantityValue> {
  const overrides = Object.create(null) as Record<string, QuantityValue>;
  Object.defineProperty(overrides, 'toString', {
    value: quantity(30, 'mm'),
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return overrides;
}

function inheritedValidOverride(): Record<string, QuantityValue> {
  return Object.create({ 'driver-radius': quantity(30, 'mm') }) as Record<string, QuantityValue>;
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

  it('ignores inherited values for declared parameter ids', () => {
    const baselineRoute = solveBrown003Route(canonicalQuarterTurnBeltModel);
    const inheritedRoute = solveBrown003Route(canonicalQuarterTurnBeltModel, {
      parameters: inheritedValidOverride(),
    });
    expect(inheritedRoute).toEqual(baselineRoute);

    const baselineContinuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
    const inheritedContinuity = evaluateFixedAxisBeltContinuity(canonicalQuarterTurnBeltModel, {
      parameters: inheritedValidOverride(),
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
    expect(inheritedContinuity).toEqual(baselineContinuity);
  });
});
