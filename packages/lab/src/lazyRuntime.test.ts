import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.unmock('./families/belt.js');
  vi.unmock('./families/fourBar.js');
});

describe('lazy mechanism family runtime', () => {
  it('does not evaluate an unrequested mechanism family', async () => {
    const loaded: string[] = [];

    vi.doMock('./families/belt.js', async () => {
      loaded.push('belt');
      return vi.importActual('./families/belt.js');
    });
    vi.doMock('./families/fourBar.js', async () => {
      loaded.push('four-bar');
      return vi.importActual('./families/fourBar.js');
    });

    const { loadMechanismLab } = await import('./lazyRuntime.js');
    expect(loaded).toEqual([]);

    const resolved = await loadMechanismLab(
      'foundation:belt-drive:open',
      'atlas.analytic-belt.v0',
    );

    expect(resolved.model.id).toBe('foundation:belt-drive:open');
    expect(loaded).toEqual(['belt']);
  });
});
