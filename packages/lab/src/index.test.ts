import { describe, expect, it } from 'vitest';

import { hasErrors, quantity } from '@atlasmechanica/model';
import {
  assertValidInitialLabState,
  buildLabEvaluationRequest,
  defaultLabValues,
  resolveInteractionControl,
  selectMechanismLabDefinition,
  validateMechanismLabDefinition,
} from './index.js';
import {
  crossedBeltDriveLab,
  openBeltDriveLab,
} from './families/belt.js';
import { canonicalFourBarLab } from './families/fourBar.js';
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

  it.each(cases)('lazy-loads only the mechanism family needed by %s', async (definition, adapterId) => {
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

  it('rejects duplicate physical input bindings', () => {
    const resolved = resolveMechanismLab(
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );
    const groundControl = canonicalFourBarLab.controls.find(
      (control) => control.kind === 'parameter' && control.parameter === 'ground-length',
    );
    if (groundControl === undefined) throw new Error('Missing ground-length control');

    const duplicateParameter = {
      ...canonicalFourBarLab,
      controls: [
        ...canonicalFourBarLab.controls,
        { ...groundControl, id: 'ground-length-copy' },
      ],
    } as unknown as typeof canonicalFourBarLab;

    expect(() => validateMechanismLabDefinition(duplicateParameter, resolved.model)).toThrow(
      'Duplicate mechanism lab parameter binding ground-length',
    );
  });

  it('rejects control units incompatible with their model quantity', () => {
    const resolved = resolveMechanismLab(
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );

    const badParameter = {
      ...canonicalFourBarLab,
      controls: canonicalFourBarLab.controls.map((control) => (
        control.id === 'ground-length' ? { ...control, unit: 'deg' } : control
      )),
    } as unknown as typeof canonicalFourBarLab;
    expect(() => validateMechanismLabDefinition(badParameter, resolved.model)).toThrow(
      'unit deg is incompatible with length',
    );

    const badCoordinate = {
      ...canonicalFourBarLab,
      controls: canonicalFourBarLab.controls.map((control) => (
        control.id === 'driver-angle' ? { ...control, unit: 'mm' } : control
      )),
    } as unknown as typeof canonicalFourBarLab;
    expect(() => validateMechanismLabDefinition(badCoordinate, resolved.model)).toThrow(
      'requires rad or deg units',
    );

    const badRate = {
      ...canonicalFourBarLab,
      controls: canonicalFourBarLab.controls.map((control) => (
        control.id === 'driver-speed' ? { ...control, unit: 'mm/s' } : control
      )),
    } as unknown as typeof canonicalFourBarLab;
    expect(() => validateMechanismLabDefinition(badRate, resolved.model)).toThrow(
      'requires rpm, rad/s, or deg/s units',
    );
  });

  it('requires a renderer binding whenever a lab advertises 3D', () => {
    const resolved = resolveMechanismLab(
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );
    const invalid = {
      ...canonicalFourBarLab,
      views: ['2d', '3d'],
      threeRendererId: undefined,
    } as unknown as typeof canonicalFourBarLab;

    expect(() => validateMechanismLabDefinition(invalid, resolved.model)).toThrow(
      'advertises 3D without a renderer binding',
    );
  });

  it('rejects signal readouts that the generic formatter cannot display', () => {
    const resolved = resolveMechanismLab(
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );
    const invalid = {
      ...canonicalFourBarLab,
      readouts: [
        {
          id: 'point-a',
          label: 'Joint A',
          source: { kind: 'signal', signal: 'point-a-position' },
        },
      ],
    } as unknown as typeof canonicalFourBarLab;

    expect(() => validateMechanismLabDefinition(invalid, resolved.model)).toThrow(
      'cannot format vector2 signal point-a-position',
    );
  });

  it('rejects invalid numeric readout precision', () => {
    const resolved = resolveMechanismLab(
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );
    const readout = canonicalFourBarLab.readouts[0];
    if (readout === undefined) throw new Error('Missing four-bar readout');

    for (const digits of [-1, 1.5, 101]) {
      const invalid = {
        ...canonicalFourBarLab,
        readouts: [{ ...readout, digits }],
      } as unknown as typeof canonicalFourBarLab;
      expect(() => validateMechanismLabDefinition(invalid, resolved.model)).toThrow(
        `invalid digits ${digits}`,
      );
    }
  });

  it('resolves direct manipulation through model inputs, not presentation control ids', () => {
    const resolved = resolveMechanismLab(
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );
    const alternate = {
      ...canonicalFourBarLab,
      controls: canonicalFourBarLab.controls.map((control) => (
        control.id === 'driver-angle' ? { ...control, id: 'crank-phase' } : control
      )),
      animation: {
        coordinateControlId: 'crank-phase',
        rateControlId: 'driver-speed',
      },
    } as unknown as typeof canonicalFourBarLab;

    validateMechanismLabDefinition(alternate, resolved.model);
    expect(resolveInteractionControl(alternate, 'input', 'driver-angle').id).toBe('crank-phase');
  });

  it('rejects solver-error defaults before scene compilation', () => {
    const resolved = resolveMechanismLab(
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );
    const invalid = {
      ...canonicalFourBarLab,
      parameterOverrides: {
        ...(canonicalFourBarLab.parameterOverrides ?? {}),
        'coupler-length': quantity(20, 'mm'),
        'rocker-length': quantity(20, 'mm'),
      },
    } as unknown as typeof canonicalFourBarLab;

    validateMechanismLabDefinition(invalid, resolved.model);
    const request = buildLabEvaluationRequest(invalid, defaultLabValues(invalid));
    const state = resolved.adapter
      .compile(resolved.model)
      .createSession({ configuration: 'open' })
      .evaluate(request);
    expect(hasErrors(state)).toBe(true);
    expect(() => assertValidInitialLabState(invalid, state)).toThrow('invalid initial state');
  });
});
