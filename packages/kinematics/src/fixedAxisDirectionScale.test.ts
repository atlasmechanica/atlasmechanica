import { describe, expect, it } from 'vitest';

import { validateSimulationModel, type SimulationModel } from '@atlasmechanica/model';
import { solveBrown003Route } from './brown003Route.js';
import { evaluateFixedAxisBeltContinuity } from './fixedAxisBeltContinuity.js';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';

function withAxisScale(magnitude: number): SimulationModel {
  const system = canonicalQuarterTurnBeltModel.systems.fixedAxisBelt;
  if (system === undefined) throw new Error('Missing Brown 003 fixed-axis system');
  const driver = system.pulleys.driver;
  const guideA = system.pulleys['guide-a'];
  const driven = system.pulleys.driven;
  const guideB = system.pulleys['guide-b'];
  if (
    driver === undefined
    || guideA === undefined
    || driven === undefined
    || guideB === undefined
  ) {
    throw new Error('Missing Brown 003 pulley');
  }

  return {
    ...canonicalQuarterTurnBeltModel,
    systems: {
      fixedAxisBelt: {
        ...system,
        pulleys: {
          driver: { ...driver, axis: [magnitude, 0, 0] as const },
          'guide-a': { ...guideA, axis: [0, 0, magnitude] as const },
          driven: { ...driven, axis: [0, 0, magnitude] as const },
          'guide-b': { ...guideB, axis: [0, 0, magnitude] as const },
        },
      },
    },
  };
}

describe('fixed-axis direction scale', () => {
  it('accepts every finite nonzero scale while preserving Brown route and continuity', () => {
    for (const magnitude of [1e-13, Number.MIN_VALUE, Number.MAX_VALUE]) {
      const model = withAxisScale(magnitude);
      expect(validateSimulationModel(model)).toEqual([]);
      expect(solveBrown003Route(model).diagnostics).toEqual([]);
      expect(evaluateFixedAxisBeltContinuity(model).diagnostics).toEqual([]);
    }
  });
});
