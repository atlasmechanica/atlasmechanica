import { describe, expect, it } from 'vitest';

import {
  CatalogAuthoringError,
  compileCatalogDocuments,
  parseCatalogDocument,
  type CatalogDocumentSource,
} from './authoring.js';
import { collections, occurrences, subjects } from './catalog.js';
import { readCatalogDocuments } from './discoverDocuments.js';
import { createCatalog, type CatalogManifestSet } from './schema.js';

const sources = await readCatalogDocuments(new URL('../fixtures/authoring/', import.meta.url));

function source(body: Record<string, unknown>, path = 'input.json'): CatalogDocumentSource {
  return {
    path,
    text: JSON.stringify({ format: 'atlas.catalog-document', schemaVersion: '0.1', ...body }),
  };
}

function baseline(body: Record<string, unknown> = {}): CatalogDocumentSource {
  return source({ collections, subjects, occurrences, ...body });
}

function errorFrom(run: () => unknown): CatalogAuthoringError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogAuthoringError);
    return error as CatalogAuthoringError;
  }
  throw new Error('Expected an authoring error');
}

describe('catalog JSON documents', () => {
  it.each(sources.map((item) => [item.path, item] as const))('round-trips %s without data loss', (_path, item) => {
    const parsed = parseCatalogDocument(item);
    expect(parsed).toEqual(JSON.parse(item.text));
    expect(parseCatalogDocument({ path: item.path, text: JSON.stringify(parsed) })).toEqual(parsed);
  });

  it('normalizes all three Brown examples to the existing catalog without changing content or status', () => {
    expect(sources.map((item) => item.path)).toEqual([
      'brown/001.json', 'brown/002.json', 'brown/003.json', 'brown/collection.json',
    ]);
    const compiled = compileCatalogDocuments(sources);
    const ordered = <T extends { readonly id: string }>(items: readonly T[]): T[] =>
      [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    expect(compiled.manifests).toEqual({
      collections: ordered(collections), subjects: ordered(subjects), occurrences: ordered(occurrences),
    });
    expect(compiled.catalog.occurrences.get('brown:003')?.status).toBe('mapped');
    expect(compiled.catalog.subjects.get('quarter-turn-belt-drive')?.simulation?.status).toBe('planned');
  });

  it('resolves forward references independently of document order', () => {
    const normal = compileCatalogDocuments(sources).manifests;
    expect(compileCatalogDocuments([...sources].reverse()).manifests).toEqual(normal);
    const reordered = baseline({ collections: [...collections].reverse(), subjects: [...subjects].reverse(), occurrences: [...occurrences].reverse() });
    expect(compileCatalogDocuments([reordered]).manifests).toEqual(normal);
  });

  it('produces JSON-serializable normalized records usable without the discovery layer', () => {
    const compiled = compileCatalogDocuments(sources);
    const transferred = JSON.parse(JSON.stringify(compiled.manifests)) as CatalogManifestSet;
    const catalog = createCatalog(transferred);
    expect([...catalog.subjects]).toEqual([...compiled.catalog.subjects]);
    expect([...catalog.occurrences]).toEqual([...compiled.catalog.occurrences]);
  });

  it('adds an occurrence-only file without duplicating a canonical subject or simulation', () => {
    // Synthetic test attribution, not a new historical Brown movement.
    const duplicateView = source({
      collections: [{ ...collections[0], id: 'test-sources', sequence: 2, title: 'Synthetic test sources' }],
      occurrences: [{
        schemaVersion: '0.1', id: 'test:open-belt', collection: 'test-sources',
        ordinal: 1, displayNumber: 'test', status: 'interactive',
        canonicalSubject: 'open-belt-drive', simulation: { modelId: 'foundation:belt-drive:open' },
        source: { excerpt: 'Synthetic canonical-reuse test; no historical attribution.' },
      }],
    }, 'test/reuse.json');
    const before = compileCatalogDocuments(sources);
    const after = compileCatalogDocuments([...sources, duplicateView]);
    expect(after.catalog.subjects.size).toBe(before.catalog.subjects.size);
    expect(after.catalog.occurrences.size).toBe(before.catalog.occurrences.size + 1);
    expect(after.catalog.occurrences.get('test:open-belt')?.simulation?.modelId)
      .toBe(after.catalog.subjects.get('open-belt-drive')?.simulation?.modelId);
  });

  it('deep-freezes parsed documents and normalized records', () => {
    const parsed = parseCatalogDocument(baseline());
    const compiled = compileCatalogDocuments([baseline()]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.subjects?.[0]?.classification.components)).toBe(true);
    expect(Object.isFrozen(compiled.manifests.subjects)).toBe(true);
    expect(() => {
      (compiled.manifests.subjects as unknown[]).push({});
    }).toThrow();
  });

  it.each([
    { input: '{', pointer: '' },
    { input: 'null', pointer: '' },
    { input: '[]', pointer: '' },
    { input: '{}', pointer: '/format' },
    { input: baseline({ schemaVersion: '999' }).text, pointer: '/schemaVersion' },
    { input: baseline({ subjects: null }).text, pointer: '/subjects' },
    { input: baseline({ unknown: true }).text, pointer: '/unknown' },
    { input: source({}).text, pointer: '' },
    { input: source({ subjects: [], occurrences: [], collections: [] }).text, pointer: '' },
    { input: baseline({ subjects: [{ ...subjects[0], slug: '../escape' }] }).text, pointer: '/subjects/0/slug' },
    { input: baseline({ subjects: [{ ...subjects[0], id: 'UPPERCASE' }] }).text, pointer: '/subjects/0/id' },
    { input: baseline({ subjects: [{ ...subjects[0], title: ' ' }] }).text, pointer: '/subjects/0/title' },
    { input: baseline({ subjects: [{ ...subjects[0], classification: { inputMotion: 'rotary' } }] }).text, pointer: '/subjects/0/classification/outputMotion' },
    { input: baseline({ subjects: [{ ...subjects[0], facts: [{ label: 'Ambiguous', value: 'x', tags: ['x'] }] }] }).text, pointer: '/subjects/0/facts/0' },
    { input: baseline({ subjects: [{ ...subjects[0], facts: [{ label: 'Empty' }] }] }).text, pointer: '/subjects/0/facts/0' },
    { input: baseline({ subjects: [{ ...subjects[0], facts: [{ label: 'Tags', tags: [42] }] }] }).text, pointer: '/subjects/0/facts/0/tags/0' },
    { input: baseline({ subjects: [{ ...subjects[0], simulation: { status: 'interactive', modelId: 'model', adapter: 'adapter', module: './arbitrary.js' } }] }).text, pointer: '/subjects/0/simulation/module' },
    { input: baseline({ occurrences: [{ ...occurrences[0], ordinal: 1.5 }] }).text, pointer: '/occurrences/0/ordinal' },
    { input: baseline({ occurrences: [{ ...occurrences[0], ordinal: 0 }] }).text, pointer: '/occurrences/0/ordinal' },
    { input: baseline({ occurrences: [{ ...occurrences[0], ordinal: Number.MAX_SAFE_INTEGER + 1 }] }).text, pointer: '/occurrences/0/ordinal' },
    { input: baseline({ occurrences: [{ ...occurrences[0], status: 'done' }] }).text, pointer: '/occurrences/0/status' },
    { input: baseline({ collections: [{ ...collections[0], rights: { status: 'invented' } }] }).text, pointer: '/collections/0/rights/status' },
  ])('rejects malformed fields at $pointer', ({ input, pointer }) => {
    const error = errorFrom(() => parseCatalogDocument({ path: 'bad.json', text: input }));
    expect(error.source).toBe('bad.json');
    expect(error.pointer).toBe(pointer);
  });

  it('rejects numeric overflow instead of accepting JSON-parsed Infinity', () => {
    const input = baseline().text.replace('"ordinal":1', '"ordinal":1e999');
    expect(errorFrom(() => parseCatalogDocument({ path: 'overflow.json', text: input })).pointer)
      .toBe('/occurrences/0/ordinal');
  });

  it.each(['__proto__', 'constructor', 'prototype', 'strange/key~name'])('rejects unknown key %s without prototype lookup', (key) => {
    const input = baseline().text.replace('{', `{${JSON.stringify(key)}:{"polluted":true},`);
    const error = errorFrom(() => parseCatalogDocument({ path: 'unsafe.json', text: input }));
    expect(error.pointer).toBe(`/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it.each([
    'javascript:alert(1)', 'data:text/html,x', 'file:///tmp/source', '//example.org/source',
    'https://user:password@example.org/source', 'https://example.org/has space',
    'https://example.org/has\nnewline', 'https:\\example.org/source',
  ])('rejects unsafe source URL %s', (url) => {
    const input = baseline({ occurrences: [{ ...occurrences[0], source: { referenceUrl: url } }] });
    expect(errorFrom(() => parseCatalogDocument(input)).pointer).toBe('/occurrences/0/source/referenceUrl');
  });

  it('retains editorial strings as data, not evaluated or silently rewritten HTML', () => {
    const excerpt = '<script>throw new Error("not executable")</script>';
    const parsed = parseCatalogDocument(baseline({ occurrences: [{ ...occurrences[0], source: { excerpt } }] }));
    expect(parsed.occurrences?.[0]?.source.excerpt).toBe(excerpt);
    // Rendering/escaping is a separate consumer responsibility, not an HTML sanitizer claim.
  });

  it.each([
    { body: { collections: [...collections, collections[0]] }, pointer: '/collections/1/id' },
    { body: { collections: [...collections, { ...collections[0], id: 'other' }] }, pointer: '/collections/1/sequence' },
    { body: { subjects: [...subjects, subjects[0]] }, pointer: '/subjects/3/id' },
    { body: { subjects: [...subjects, { ...subjects[0], id: 'other' }] }, pointer: '/subjects/3/slug' },
    { body: { occurrences: [...occurrences, occurrences[0]] }, pointer: '/occurrences/3/id' },
    { body: { occurrences: [...occurrences, { ...occurrences[0], id: 'test:duplicate' }] }, pointer: '/occurrences/3/ordinal' },
    { body: { occurrences: [{ ...occurrences[0], collection: 'missing' }] }, pointer: '/occurrences/0/collection' },
    { body: { occurrences: [{ ...occurrences[0], canonicalSubject: 'missing' }] }, pointer: '/occurrences/0/canonicalSubject' },
    { body: { occurrences: [{ ...occurrences[0], status: 'cataloged' }] }, pointer: '/occurrences/0/canonicalSubject' },
    { body: { occurrences: [{ ...occurrences[0], status: 'classified', classification: {} }] }, pointer: '/occurrences/0/classification' },
    { body: { occurrences: [{ ...occurrences[0], status: 'mapped' }] }, pointer: '/occurrences/0/simulation' },
    { body: { occurrences: [{ ...occurrences[0], simulation: { modelId: 'foreign' } }] }, pointer: '/occurrences/0/simulation' },
    { body: { occurrences: [{ ...occurrences[0], canonicalSubject: 'quarter-turn-belt-drive' }] }, pointer: '/occurrences/0/canonicalSubject' },
  ])('reports catalog relationship errors at $pointer', ({ body, pointer }) => {
    const error = errorFrom(() => compileCatalogDocuments([baseline(body)]));
    expect(error.source).toBe('input.json');
    expect(error.pointer).toBe(pointer);
  });

  it('reports both filenames for cross-document collisions', () => {
    const extra = source({ subjects: [subjects[0]] }, 'z-duplicate.json');
    const error = errorFrom(() => compileCatalogDocuments([...sources, extra]));
    expect(error.source).toBe('z-duplicate.json');
    expect(error.message).toContain('brown/001.json#/subjects/0');
  });

  it('rejects duplicate source paths even when record identities differ', () => {
    expect(() => compileCatalogDocuments([baseline(), source({ collections: [{ ...collections[0], id: 'other' }] })]))
      .toThrow('Duplicate document path');
  });
});
