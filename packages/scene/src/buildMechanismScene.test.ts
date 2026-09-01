import { describe, expect, it } from 'vitest';
import { quantity } from '@atlasmechanica/model';
import {
  analyticBeltAdapter,
  analyticFourBarAdapter,
  canonicalFourBarModel,
  crossedBeltDriveModel,
  openBeltDriveModel,
} from '@atlasmechanica/kinematics';
import { buildMechanismScene } from './buildMechanismScene.js';

function fourBarScene() {
  const state = analyticFourBarAdapter
    .compile(canonicalFourBarModel)
    .createSession({ configuration: 'open' })
    .evaluate({
      coordinates: { 'driver-angle': quantity(45, 'deg') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
    });
  return buildMechanismScene({ model: canonicalFourBarModel, state });
}

function beltScene(model: typeof openBeltDriveModel | typeof crossedBeltDriveModel) {
  const state = analyticBeltAdapter
    .compile(model)
    .createSession()
    .evaluate({
      coordinates: { 'driver-angle': quantity(30, 'deg') },
      rates: { 'driver-angle': quantity(1, 'rad/s') },
      parameters: { 'center-distance': quantity(180, 'mm') },
    });
  return buildMechanismScene({
    model,
    state,
    parameters: { 'center-distance': quantity(180, 'mm') },
  });
}

describe('production mechanism scenes', () => {
  it('builds a deterministic four-bar scene with semantic layers and styles', () => {
    const first = fourBarScene();
    const second = fourBarScene();

    expect(first).toEqual(second);
    expect(new Set(first.primitives.map((primitive) => primitive.id)).size).toBe(first.primitives.length);
    expect(first.primitives.find((primitive) => primitive.id === 'fourbar-crank')).toMatchObject({
      layer: 'mechanism',
      styles: ['body'],
      selectId: 'crank',
    });
    expect(first.primitives.find((primitive) => primitive.id === 'fourbar-input-handle')).toMatchObject({
      layer: 'interaction',
      type: 'handle',
      handle: 'input',
      bindingId: 'driver-angle',
    });
  });

  it('builds open and crossed belt scenes from solver-owned tangent geometry', () => {
    const open = beltScene(openBeltDriveModel);
    const crossed = beltScene(crossedBeltDriveModel);

    expect(open.title).toBe('Open belt drive');
    expect(crossed.title).toBe('Crossed belt drive');
    expect(open.primitives.find((primitive) => primitive.id === 'belt-path')?.type).toBe('polyline');
    expect(crossed.primitives.find((primitive) => primitive.id === 'belt-path')?.type).toBe('polyline');
    expect(open.primitives.find((primitive) => primitive.id === 'belt-input-handle')).toMatchObject({
      type: 'handle',
      handle: 'input',
      bindingId: 'driver-angle',
    });
    expect(open.primitives.find((primitive) => primitive.id === 'belt-distance-handle')).toMatchObject({
      type: 'handle',
      handle: 'parameter',
      bindingId: 'center-distance',
      shape: 'square',
    });
  });

  it('represents an invalid proposal as feedback without mutating the physical scene', () => {
    const base = beltScene(crossedBeltDriveModel);
    const state = analyticBeltAdapter
      .compile(crossedBeltDriveModel)
      .createSession()
      .evaluate({
        coordinates: { 'driver-angle': quantity(30, 'deg') },
        parameters: { 'center-distance': quantity(180, 'mm') },
      });
    const withFeedback = buildMechanismScene({
      model: crossedBeltDriveModel,
      state,
      parameters: { 'center-distance': quantity(180, 'mm') },
      invalidParameterHandle: { x: 0.08, y: 0 },
    });

    expect(withFeedback.primitives.find((primitive) => primitive.id === 'belt-path')).toEqual(
      base.primitives.find((primitive) => primitive.id === 'belt-path'),
    );
    expect(withFeedback.primitives.find((primitive) => primitive.id === 'belt-invalid-handle')).toMatchObject({
      layer: 'feedback',
      styles: ['invalid'],
      handle: 'invalid',
    });
  });
});
