import { describe, expect, it } from 'vitest';

import {
  analyticBeltAdapter,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import { quantity } from '@atlasmechanica/model';
import { brownBeltSceneCompiler } from './compilers.js';

function compiledBeltScene() {
  const parameters = {
    'driver-radius': quantity(45, 'mm'),
    'driven-radius': quantity(45, 'mm'),
    'center-distance': quantity(180, 'mm'),
  } as const;
  const state = analyticBeltAdapter.compile(openBeltDriveModel).createSession().evaluate({
    coordinates: { 'driver-angle': quantity(0, 'deg') },
    rates: { 'driver-angle': quantity(30 * Math.PI * 2 / 60, 'rad/s') },
    parameters,
  });
  return brownBeltSceneCompiler.build({
    model: openBeltDriveModel,
    state,
    parameters,
  });
}

describe('registered mechanism scene compilers', () => {
  it('tags belt and pulley entities without making renderers parse primitive ids', () => {
    const scene = compiledBeltScene();
    const driver = scene.primitives.find((primitive) => primitive.id === 'belt-driver');
    const driven = scene.primitives.find((primitive) => primitive.id === 'belt-driven');
    const belt = scene.primitives.find((primitive) => primitive.id === 'belt-band-underlay');

    expect(driver?.entity).toEqual({ kind: 'pulley', id: 'driver.pulley', role: 'driver' });
    expect(driven?.entity).toEqual({ kind: 'pulley', id: 'driven.pulley', role: 'driven' });
    expect(belt?.entity).toEqual({ kind: 'belt', id: 'belt', role: 'transmission' });
  });
});
