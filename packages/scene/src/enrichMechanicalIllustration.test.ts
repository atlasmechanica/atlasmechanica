import { describe, expect, it } from 'vitest';
import { quantity } from '@atlasmechanica/model';
import {
  analyticBeltAdapter,
  crossedBeltDriveModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import { buildMechanismScene } from './buildMechanismScene.js';
import { enrichMechanicalIllustration } from './enrichMechanicalIllustration.js';

function illustrated(model: typeof openBeltDriveModel | typeof crossedBeltDriveModel) {
  const state = analyticBeltAdapter
    .compile(model)
    .createSession()
    .evaluate({
      coordinates: { 'driver-angle': quantity(30, 'deg') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
      parameters: { 'center-distance': quantity(180, 'mm') },
    });

  return enrichMechanicalIllustration(buildMechanismScene({
    model,
    state,
    parameters: { 'center-distance': quantity(180, 'mm') },
  }));
}

describe('mechanical illustration enrichment', () => {
  it('keeps stable primary IDs while adding belt and pulley detail', () => {
    const scene = illustrated(openBeltDriveModel);
    const ids = new Set(scene.primitives.map((primitive) => primitive.id));

    expect(ids.has('belt-path')).toBe(true);
    expect(ids.has('belt-driver')).toBe(true);
    expect(ids.has('belt-driven')).toBe(true);
    expect(ids.has('belt-band-underlay')).toBe(true);
    expect(ids.has('belt-driver-hub')).toBe(true);
    expect(ids.has('belt-driven-hub')).toBe(true);
    expect([...ids].filter((id) => id.startsWith('belt-driver-spoke-'))).toHaveLength(4);
    expect([...ids].filter((id) => id.startsWith('belt-driven-spoke-'))).toHaveLength(4);
    expect(ids.has('belt-driver-mark')).toBe(false);
    expect(ids.has('belt-driven-mark')).toBe(false);
  });

  it('rotates spokes from the solver-owned pulley phase', () => {
    const scene = illustrated(crossedBeltDriveModel);
    const spoke = scene.primitives.find((primitive) => primitive.id === 'belt-driver-spoke-0');
    expect(spoke).toMatchObject({ type: 'segment' });
    if (spoke?.type !== 'segment') throw new TypeError('Missing illustrated spoke');

    const angle = Math.atan2(spoke.b.y - spoke.a.y, spoke.b.x - spoke.a.x);
    expect(angle).toBeCloseTo(Math.PI / 6, 10);
  });

  it('is deterministic and does not change the physical scene identity', () => {
    const first = illustrated(openBeltDriveModel);
    const second = illustrated(openBeltDriveModel);
    expect(first).toEqual(second);
    expect(first.id).toBe('belt-same');
  });
});
