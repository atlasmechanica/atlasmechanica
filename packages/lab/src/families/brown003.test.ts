import { describe, expect, it } from 'vitest';

import { hasErrors } from '@atlasmechanica/model';
import {
  buildLabEvaluationRequest,
  defaultLabValues,
} from '../core.js';
import { loadMechanismLab } from '../lazyRuntime.js';
import { resolveMechanismLab } from '../runtime.js';
import {
  brown003QuarterTurnLab,
  crossedBeltDriveLab,
  openBeltDriveLab,
} from './belt.js';

const ADAPTER_ID = 'atlas.spatial-belt.v0';

describe('Brown 003 mechanism lab binding', () => {
  it('resolves, evaluates, and builds through the generic family path', () => {
    const resolved = resolveMechanismLab(
      brown003QuarterTurnLab.modelId,
      ADAPTER_ID,
      brown003QuarterTurnLab.id,
    );
    expect(resolved.adapter.id).toBe(ADAPTER_ID);
    expect(resolved.sceneCompiler.id).toBe('atlas.scene.brown-003-spatial.v0');
    expect(resolved.sceneCompiler.id).not.toBe(openBeltDriveLab.sceneCompilerId);

    const values = defaultLabValues(brown003QuarterTurnLab);
    const request = buildLabEvaluationRequest(brown003QuarterTurnLab, values);
    const session = resolved.adapter
      .compile(resolved.model)
      .createSession({ configuration: 'reference' });
    const state = session.evaluate(request);
    expect(hasErrors(state)).toBe(false);

    const scene = resolved.sceneCompiler.build({
      model: resolved.model,
      state,
      parameters: request.parameters,
    });
    expect(scene.id).toBe('brown003-spatial-projection');
    expect(scene.primitives.some((primitive) => primitive.id === 'brown003-pulley-guide-a')).toBe(true);
    expect(scene.primitives.some((primitive) => primitive.id === 'brown003-pulley-guide-b')).toBe(true);
  });

  it('loads the same Brown 003 family lazily', async () => {
    const resolved = await loadMechanismLab(
      brown003QuarterTurnLab.modelId,
      ADAPTER_ID,
      brown003QuarterTurnLab.id,
    );
    expect(resolved.definition.id).toBe(brown003QuarterTurnLab.id);
    expect(resolved.adapter.id).toBe(ADAPTER_ID);
    expect(resolved.sceneCompiler.id).toBe('atlas.scene.brown-003-spatial.v0');
  });

  it('advertises only the truthful 2D projection until a real spatial renderer exists', () => {
    expect(brown003QuarterTurnLab.views).toEqual(['2d']);
    expect(brown003QuarterTurnLab.threeRendererId).toBeUndefined();
    expect(brown003QuarterTurnLab.controls.find(
      (control) => control.id === 'driver-angle',
    )?.interaction).toBeUndefined();
  });

  it('leaves the established open and crossed belt presentations unchanged', () => {
    expect(openBeltDriveLab.views).toEqual(['2d', '3d']);
    expect(crossedBeltDriveLab.views).toEqual(['2d', '3d']);
    expect(openBeltDriveLab.sceneCompilerId).toBe('atlas.scene.brown-belt.v0');
    expect(crossedBeltDriveLab.sceneCompilerId).toBe('atlas.scene.brown-belt.v0');
    expect(openBeltDriveLab.threeRendererId).toBe('atlas.renderer-three.belt.v0');
    expect(crossedBeltDriveLab.threeRendererId).toBe('atlas.renderer-three.belt.v0');
  });
});
