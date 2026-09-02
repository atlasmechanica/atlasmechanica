import { describe, expect, it } from 'vitest';

import {
  quantity,
  validateSimulationModel,
  type SimulationModel,
} from '@atlasmechanica/model';
import { canonicalQuarterTurnBeltModel } from './fixtures/quarterTurnBelt.js';
import { spatialBeltAdapter } from './spatialBeltAdapter.js';

function fixedAxisSystem() {
  const system = canonicalQuarterTurnBeltModel.systems.fixedAxisBelt;
  if (system === undefined) throw new Error('Missing fixed-axis system');
  return system;
}

describe('spatial belt third-pass review hardening', () => {
  it('does not treat slightly skewed guide planes as safely parallel', () => {
    const system = fixedAxisSystem();
    const guideA = system.pulleys['guide-a'];
    const guideB = system.pulleys['guide-b'];
    const driven = system.pulleys.driven;
    const guideRadius = canonicalQuarterTurnBeltModel.parameters['guide-radius'];
    if (
      guideA === undefined
      || guideB === undefined
      || driven === undefined
      || guideRadius === undefined
    ) {
      throw new Error('Missing Brown 003 guide geometry');
    }

    const tilt = 2e-5;
    const sin = Math.sin(tilt);
    const cos = Math.cos(tilt);
    const skewed: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      parameters: {
        ...canonicalQuarterTurnBeltModel.parameters,
        'guide-radius': {
          ...guideRadius,
          default: quantity(700, 'm'),
        },
      },
      systems: {
        fixedAxisBelt: {
          ...system,
          pulleys: {
            ...system.pulleys,
            'guide-a': {
              ...guideA,
              center: {
                x: quantity(0, 'm'),
                y: quantity(1000, 'm'),
                z: quantity(-0.012, 'm'),
              },
              axis: [sin, 0, cos],
            },
            driven: {
              ...driven,
              center: {
                x: quantity(800, 'm'),
                y: quantity(1000, 'm'),
                z: quantity(0, 'm'),
              },
            },
            'guide-b': {
              ...guideB,
              center: {
                x: quantity(0, 'm'),
                y: quantity(1000, 'm'),
                z: quantity(0.012, 'm'),
              },
              axis: [-sin, 0, cos],
            },
          },
        },
      },
    };

    expect(validateSimulationModel(skewed)).toEqual([]);
    expect(spatialBeltAdapter.supports(skewed)).toBe(false);
    expect(() => spatialBeltAdapter.compile(skewed)).toThrow(
      'restricted to the validated Brown 003',
    );
  });

  it('requires at least one reference configuration before compilation', () => {
    const invalid: SimulationModel = {
      ...canonicalQuarterTurnBeltModel,
      configurations: {},
    };

    expect(validateSimulationModel(invalid).map((item) => item.message)).toContain(
      'SimulationModel requires at least one reference configuration',
    );
    expect(spatialBeltAdapter.supports(invalid)).toBe(false);
    expect(() => spatialBeltAdapter.compile(invalid)).toThrow(
      'SimulationModel requires at least one reference configuration',
    );
  });
});
