import { describe, expect, it } from 'vitest';
import { hasErrors } from '@atlasmechanica/model';
import { buildLabEvaluationRequest, defaultLabValues } from '../core.js';
import { resolveMechanismLabFromFamily } from '../family.js';
import { canonicalFourBarLab, fourBarLabFamily } from './fourBar.js';

describe('canonical four-bar lab', () => {
  it('keeps the advertised crank-rocker range valid for a full revolution', () => {
    const ground = canonicalFourBarLab.controls.find(
      (control) => control.kind === 'parameter' && control.parameter === 'ground-length',
    );
    if (ground?.kind !== 'parameter') throw new Error('Missing ground-length control');

    // 120 mm is the Grashof change-point for the 30/80/70 mm moving links.
    // The integer-step lab stays strictly inside that singular boundary.
    expect(ground.max).toBe(119);

    const resolved = resolveMechanismLabFromFamily(
      fourBarLabFamily,
      canonicalFourBarLab.modelId,
      'atlas.analytic-four-bar.v0',
      canonicalFourBarLab.id,
    );
    const session = resolved.adapter
      .compile(resolved.model)
      .createSession({ configuration: 'open' });
    const values = defaultLabValues(canonicalFourBarLab);
    values[ground.id] = ground.max;

    for (let angle = 0; angle <= 360; angle += 1) {
      values['driver-angle'] = angle;
      const state = session.evaluate(buildLabEvaluationRequest(canonicalFourBarLab, values));
      expect(hasErrors(state), `four-bar failed at ${angle}°`).toBe(false);
    }
  });
});
