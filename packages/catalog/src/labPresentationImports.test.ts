import { expect, it, vi } from 'vitest';

vi.mock('@atlasmechanica/kinematics', () => { throw new Error('Catalog decoding must not load engines'); });
vi.mock('@atlasmechanica/scene/compilers', () => { throw new Error('Catalog decoding must not load scene compilers'); });
vi.mock('@atlasmechanica/renderer-three', () => { throw new Error('Catalog decoding must not load WebGL'); });

it('loads the catalog authoring boundary without engines, scene compilers or Three.js', async () => {
  const { compileCatalogDocuments } = await import('./authoring.js');
  const compiled = compileCatalogDocuments([{ path: 'source.json', text: JSON.stringify({
    format: 'atlas.catalog-document', schemaVersion: '0.4', collections: [{
      schemaVersion: '0.1', id: 'test', shortTitle: 'Test', title: 'Synthetic test', rights: { status: 'unknown' },
    }],
  }) }]);
  expect(compiled.catalog.collections.size).toBe(1);
  expect(compiled.labPresentations).toEqual([]);
});
