import { describe, expect, it } from 'vitest';

import { hasErrors } from '@atlasmechanica/model';
import {
  buildLabEvaluationRequest,
  defaultLabValues,
  selectMechanismLabDefinition,
  validateMechanismLabDefinition,
} from './index.js';
import {
  canonicalFourBarLab,
  crossedBeltDriveLab,
  openBeltDriveLab,
} from './definitions.js';
import { loadMechanismLab } from './lazyRuntime.js';
import { resolveMechanismLab } from './runtime.js';

const cases = [
  [openBeltDriveLab, 'atlas.analytic-belt.v0'],
  [crossedBeltDriveLab, 'atlas.analytic-belt.v0'],
  [canonicalFourBarLab, 'atlas.analytic-four-bar.v0'],
] as const;

describe('mechanism lab foundation', () => {
  it.each(cases)('resolves, evaluates, and builds %s through the same generic path', (definition, adapterId) => {
    const resolved = resolveMechanismLab(definition.modelId, adapterId, definition.id);
    const values = defaultLabValues(definition);
    const request = buildLabEvaluationRequest(definition, values);
    const session = resolved.adapter
      .compile(resolved.model)
      .createSession(definition.sessionConfiguration === undefined
        ? undefined
        : { configuration: definition.sessionConfiguration });
    const state = session.evaluate(request);

    expect(hasErrors(state)).toBe(false);
    const scene = resolved.sceneCompiler.build({
      model: resolved.model,
      state,
      parameters: request.parameters,
    });
    expect(scene.primitives.length).toBeGreaterThan(0);
  });

  it.each(cases)('lazy-loads only the runtime provider needed by %s', async (definition, adapterId) => {
    const resolved = await loadMechanismLab(definition.modelId, adapterId, definition.id);
    expect(resolved.definition.id).toBe(definition.id);
    expect(resolved.model.id).toBe(definition.modelId);
    expect(resolved.adapter.id).toBe(adapterId);
  });

  it('allows multiple presentation profiles to share one physical model', () => {
    const alternate = {
      ...openBeltDriveLab,
      id: 'lab:foundation:belt-drive:open:alternate',
      defaultForModel: false,
      subtitle: 'alternate presentation',
    };
    const definitions = [openBeltDriveLab, alternate];

    expect(selectMechanismLabDefinition(definitions, openBeltDriveLab.modelId).id).toBe(openBeltDriveLab.id);
    expect(
      selectMechanismLabDefinition(definitions, openBeltDriveLab.modelId, alternate.id).id,
    ).toBe(alternate.id);
  });

  it('keeps Brown presentation choices in the lab definition instead of the physical model', () => {
    expect(openBeltDriveLab.parameterOverrides?.['driver-radius']).toEqual({ value: 45, unit: 'mm' });
    expect(openBeltDriveLab.parameterOverrides?.['driven-radius']).toEqual({ value: 45, unit: 'mm' });
    expect(openBeltDriveLab.modelTransformId).toBe('atlas.lab.vertical-belt.v0');
    expect(openBeltDriveLab.sceneCompilerId).toBe('atlas.scene.brown-belt.v0');
  });

  it('proves the generic definition does not require a belt model', () => {
    const resolved = resolveMechanismLab(
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );
    expect(resolved.model.subject).toBe('four-bar-linkage');
    expect(resolved.sceneCompiler.id).toBe('atlas.scene.four-bar.v0');
    expect(canonicalFourBarLab.views).toEqual(['2d']);
  });

  it('rejects definitions that point controls at missing model data', () => {
    const resolved = resolveMechanismLab(
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );
    const invalid = {
      ...canonicalFourBarLab,
      controls: [
        {
          ...canonicalFourBarLab.controls[0],
          coordinate: 'missing-coordinate',
        },
      ],
    } as unknown as typeof canonicalFourBarLab;

    expect(() => validateMechanismLabDefinition(invalid, resolved.model)).toThrow(
      'unknown coordinate missing-coordinate',
    );
  });
});
