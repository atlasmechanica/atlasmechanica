import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CATALOG_DOCUMENT_SCHEMA_VERSION, CatalogAuthoringError, compileCatalogDocuments,
  parseCatalogDocument, type CatalogDocumentSource,
} from './authoring.js';
import { collections, subjects, occurrences } from './catalog.js';
import { discoverCatalogDocuments, readCatalogDocuments } from './discoverDocuments.js';

const catalogSources = await readCatalogDocuments(new URL('../fixtures/authoring/', import.meta.url));
const editorialSources = await readCatalogDocuments(new URL('../fixtures/editorial/', import.meta.url));
const run = (text: string) => ({ type: 'text', text });
const rights = { status: 'unknown', attribution: 'Synthetic test attribution; not a historical source.' };
const reference = {
  id: 'test:source', title: 'Synthetic source', locator: 'Test figure 1', rights,
  url: 'https://example.org/reference',
};
const asset = {
  id: 'test:figure', path: '/assets/catalog/test/figure.png', mediaType: 'image/png',
  rights, provenance: { kind: 'source-reproduction', reference: reference.id },
};
function content(blocks: unknown[] = [{ type: 'paragraph', content: [run('An Atlas explanation.')] }]) {
  return { subject: 'open-belt-drive', sections: [{ id: 'principle', title: 'Principle', blocks }] };
}
function source(body: Record<string, unknown>, path = 'content.json'): CatalogDocumentSource {
  return { path, text: JSON.stringify({ format: 'atlas.catalog-document', schemaVersion: '0.3', ...body }) };
}
function body(blocks?: unknown[]) {
  return { referenceSources: [reference], assets: [asset], subjectContent: [content(blocks)] };
}
function compile(value: Record<string, unknown> = body()) {
  return compileCatalogDocuments([...catalogSources, source(value)]);
}
function errorFrom(run: () => unknown): CatalogAuthoringError {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(CatalogAuthoringError);
    return error as CatalogAuthoringError;
  }
  throw new Error('Expected an authoring error');
}
const blockPointer = '/subjectContent/0/sections/0/blocks/0';

describe('source-aware JSON editorial authoring', () => {
  it('preserves existing catalog semantics through the 0.5 model-instance envelope', () => {
    expect(CATALOG_DOCUMENT_SCHEMA_VERSION).toBe('0.5');
    for (const schemaVersion of ['0.1', '0.2', '0.3', '0.4', '0.5']) {
      const parsed = parseCatalogDocument(source({ schemaVersion, collections }));
      expect(parsed.collections).toEqual(collections);
    }
    const old = compileCatalogDocuments(catalogSources);
    expect(old.referenceSources).toEqual([]);
    expect(old.assets).toEqual([]);
    expect(old.subjectContent).toEqual([]);
  });

  it.each(['0.1', '0.2'].flatMap((schemaVersion) =>
    ['referenceSources', 'assets', 'subjectContent'].map((field) => ({ schemaVersion, field }))))(
    'rejects $field in envelope $schemaVersion, even when empty', ({ schemaVersion, field }) => {
      const error = errorFrom(() => parseCatalogDocument(source({ schemaVersion, collections, [field]: [] })));
      expect(error.pointer).toBe(`/${field}`);
      expect(error.message).toContain('requires catalog-document version 0.3');
    },
  );

  it.each(editorialSources.map((item) => [item.path, item] as const))('round-trips the discovered %s example', (_name, item) => {
    const parsed = parseCatalogDocument(item);
    expect(parsed).toEqual(JSON.parse(item.text));
    expect(parseCatalogDocument({ path: 'roundtrip.json', text: JSON.stringify(parsed) })).toEqual(parsed);
  });

  it('covers open, crossed and quarter-turn explanations without changing production catalog records or status', () => {
    const compiled = compileCatalogDocuments([...catalogSources, ...editorialSources]);
    expect(compiled.subjectContent.map((value) => value.subject)).toEqual([
      'crossed-belt-drive', 'open-belt-drive', 'quarter-turn-belt-drive',
    ]);
    expect(compiled.manifests).toEqual(compileCatalogDocuments(catalogSources).manifests);
    expect(compiled.catalog.occurrences.get('brown:003')?.status).toBe('mapped');
    const quarter = compiled.subjectContent.find((value) => value.subject === 'quarter-turn-belt-drive')!;
    expect(quarter.sections[0]?.blocks).toContainEqual({
      type: 'note', kind: 'reference-geometry',
      content: [run('These are Atlas reference dimensions, not measurements inferred from Brown.')],
    });
    const open = compiled.subjectContent.find((value) => value.subject === 'open-belt-drive')!;
    const quote = open.sections.flatMap((section) => section.blocks).find((block) => block.type === 'quote');
    expect(quote?.type === 'quote' && quote.text).toBe(compiled.catalog.occurrences.get('brown:001')?.source.excerpt);
  });

  it('resolves every bounded block and inline kind without interpreting text or formulas', () => {
    const result = compile(body([
      { type: 'paragraph', content: [run(' Text '), { type: 'emphasis', text: 'emphasis' }, { type: 'strong', text: 'strong' }, { type: 'code', text: '<x>' }, { type: 'reference-link', reference: reference.id, text: 'Read source' }, { type: 'subject-link', subject: 'crossed-belt-drive', text: 'Compare' }] },
      { type: 'heading', text: 'Subheading' },
      { type: 'list', style: 'ordered', items: [[run('First')], [run('Second')]] },
      { type: 'formula', expression: 'v = rω', caption: [run('Display text, not executable mathematics.')] },
      { type: 'quote', reference: reference.id, text: 'A synthetic quotation.' },
      { type: 'note', kind: 'assumption', content: [run('An explicitly authored assumption.')] },
      { type: 'note', kind: 'limitation', content: [run('A model limitation.')] },
      { type: 'image', asset: asset.id, alt: 'Synthetic test image', caption: [run('Caption')] },
      { type: 'related', subject: 'crossed-belt-drive', label: 'Compare crossed routing', description: 'Related subject, not a hard-coded URL.' },
    ]));
    expect(result.subjectContent[0]?.sections[0]?.blocks).toHaveLength(9);
    expect(JSON.parse(JSON.stringify(result.subjectContent))).toEqual(result.subjectContent);
    expect(JSON.parse(JSON.stringify(result.referenceSources))).toEqual(result.referenceSources);
    expect(JSON.parse(JSON.stringify(result.assets))).toEqual(result.assets);
  });

  it('preserves exact text including markup-looking strings for escaping by the shared page renderer', () => {
    const text = '  <script>throw new Error("not executed")</script> & <b>literal</b>  ';
    const parsed = parseCatalogDocument(source(body([
      { type: 'paragraph', content: [run(text)] },
      { type: 'formula', expression: text, caption: [run('Literal display text')] },
      { type: 'quote', reference: reference.id, text },
    ])));
    expect(parsed.subjectContent?.[0]?.sections[0]?.blocks[0]).toEqual({ type: 'paragraph', content: [run(text)] });
    // Parsing is not sanitization. No consumer may use these strings as HTML.
  });

  it('keeps source rights separate from image rights and labels Atlas-authored illustrations', () => {
    const result = compile({ ...body(), referenceSources: [{ ...reference, rights: { ...rights, status: 'public-domain' } }], assets: [
      asset,
      { ...asset, id: 'test:atlas', path: '/assets/catalog/atlas.webp', mediaType: 'image/webp', provenance: { kind: 'atlas-illustration', note: 'Authored reference geometry, not historical measurements.' } },
    ] });
    expect(result.referenceSources[0]?.rights.status).toBe('public-domain');
    expect(result.assets.every((value) => value.rights.status === 'unknown')).toBe(true);
    expect(result.assets.find((value) => value.id === 'test:atlas')?.provenance.kind).toBe('atlas-illustration');
  });

  it('permits print-only citations for quotations, but not broken clickable links', () => {
    const { url: _url, ...printReference } = reference;
    expect(() => compile({ ...body([{ type: 'quote', reference: reference.id, text: 'Synthetic quote.' }]), referenceSources: [printReference] })).not.toThrow();
    expect(errorFrom(() => compile({ ...body([{ type: 'paragraph', content: [{ type: 'reference-link', reference: reference.id, text: 'Click' }] }]), referenceSources: [printReference] })).pointer)
      .toBe(`${blockPointer}/content/0/reference`);
  });

  it('owns and deeply freezes normalized content, references and asset metadata', () => {
    const compiled = compile();
    expect(Object.isFrozen(compiled.subjectContent)).toBe(true);
    expect(Object.isFrozen(compiled.subjectContent[0]?.sections[0]?.blocks)).toBe(true);
    expect(Object.isFrozen(compiled.assets[0]?.provenance)).toBe(true);
    expect(Object.isFrozen(compiled.referenceSources[0]?.rights)).toBe(true);
    expect(() => (compiled.subjectContent as unknown[]).push({})).toThrow();
  });

  it('resolves forward references and preserves editorial order independent of document order', () => {
    const section = content().sections[0]!;
    const documents = [
      source({ subjectContent: [{ ...content(), sections: [{ ...section, id: 'z-first' }, { ...section, id: 'a-second' }] }] }, 'a-content.json'),
      source({ assets: [asset] }, 'm-assets.json'), source({ referenceSources: [reference] }, 'z-source.json'),
    ];
    const normal = compileCatalogDocuments([...catalogSources, ...documents]);
    const reverse = compileCatalogDocuments([...documents, ...catalogSources].reverse());
    expect(reverse.subjectContent).toEqual(normal.subjectContent);
    expect(reverse.assets).toEqual(normal.assets);
    expect(normal.subjectContent[0]?.sections.map((value) => value.id)).toEqual(['z-first', 'a-second']);
  });

  it.each([
    ['javascript:alert(1)'], ['data:text/html,x'], ['//example.org/source'],
    ['https://name:password@example.org/source'], ['https://example.org/space here'],
    ['https://example.org/line\nbreak'], ['https:\\example.org/source'],
  ])('rejects unsafe reference URL %s', (url) => {
    expect(errorFrom(() => compile({ ...body(), referenceSources: [{ ...reference, url }] })).pointer).toBe('/referenceSources/0/url');
  });

  it.each([
    '/assets/catalog/../private.png', '/assets/catalog/%2e%2e/private.png',
    '/assets/catalog/a\\b.png', '/assets/catalog/.hidden/image.png',
    '/assets/catalog/image.png?script=x', '/assets/catalog/image.png#fragment',
    '//example.org/image.png', 'https://example.org/image.png', './image.png',
    '/other/image.png', '/assets/catalog/image.svg', '/assets/catalog/image.js',
  ])('rejects unsafe or mismatched image path %s', (path) => {
    expect(errorFrom(() => compile({ ...body(), assets: [{ ...asset, path }] })).pointer).toBe('/assets/0/path');
  });

  it.each([
    ['image/png', 'figure.png'], ['image/jpeg', 'figure.jpg'], ['image/jpeg', 'figure.jpeg'], ['image/webp', 'figure.webp'],
  ])('accepts the declared raster type %s with %s', (mediaType, filename) => {
    expect(() => compile({ ...body(), assets: [{ ...asset, path: `/assets/catalog/${filename}`, mediaType }] })).not.toThrow();
  });

  it.each([
    { value: { type: 'html', html: '<script/>' }, field: 'type' },
    { value: { type: 'constructor' }, field: 'type' },
    { value: { type: 'paragraph', content: [], html: '<b/>' }, field: 'content' },
    { value: { type: 'paragraph', content: [run('Valid')], html: '<b/>' }, field: 'html' },
    { value: { type: 'paragraph', content: [{ type: 'text', text: 'x', onClick: 'eval()' }] }, field: 'content/0/onClick' },
    { value: { type: 'paragraph', content: [{ type: 'reference-link', reference: reference.id, text: 'x', href: 'javascript:x' }] }, field: 'content/0/href' },
    { value: { type: 'paragraph', content: [{ type: 'emphasis', children: [run('recursive')] }] }, field: 'content/0/text' },
    { value: { type: 'list', items: [[]] }, field: 'items/0' },
    { value: { type: 'list', items: [[run('x')]], style: 'arbitrary' }, field: 'style' },
    { value: { type: 'formula', expression: { evaluate: 'callback' }, caption: [run('x')] }, field: 'expression' },
    { value: { type: 'formula', expression: 'x', caption: [] }, field: 'caption' },
    { value: { type: 'quote', text: 'x' }, field: 'reference' },
    { value: { type: 'image', asset: asset.id, alt: ' ' }, field: 'alt' },
    { value: { type: 'image', asset: asset.id, alt: 'x', caption: null }, field: 'caption' },
    { value: { type: 'note', kind: 'historical-measurement', content: [run('x')] }, field: 'kind' },
  ])('rejects unchecked editorial data at $field', ({ value, field }) => {
    const error = errorFrom(() => compile(body([value])));
    expect(error.source).toBe('content.json');
    expect(error.pointer).toBe(`${blockPointer}/${field}`);
  });

  it.each([
    { value: { type: 'paragraph', content: [{ type: 'reference-link', reference: 'missing', text: 'x' }] }, field: 'content/0/reference' },
    { value: { type: 'paragraph', content: [{ type: 'subject-link', subject: 'missing', text: 'x' }] }, field: 'content/0/subject' },
    { value: { type: 'list', items: [[{ type: 'subject-link', subject: 'missing', text: 'x' }]] }, field: 'items/0/0/subject' },
    { value: { type: 'formula', expression: 'x', caption: [{ type: 'reference-link', reference: 'missing', text: 'x' }] }, field: 'caption/0/reference' },
    { value: { type: 'quote', reference: 'missing', text: 'x' }, field: 'reference' },
    { value: { type: 'note', kind: 'limitation', content: [{ type: 'subject-link', subject: 'missing', text: 'x' }] }, field: 'content/0/subject' },
    { value: { type: 'image', asset: 'missing', alt: 'x' }, field: 'asset' },
    { value: { type: 'image', asset: asset.id, alt: 'x', caption: [{ type: 'reference-link', reference: 'missing', text: 'x' }] }, field: 'caption/0/reference' },
    { value: { type: 'related', subject: 'missing', label: 'x' }, field: 'subject' },
  ])('rejects a dangling reference at $field', ({ value, field }) => {
    expect(errorFrom(() => compile(body([value]))).pointer).toBe(`${blockPointer}/${field}`);
  });

  it.each([
    { patch: { referenceSources: [{ ...reference, locator: ' ' }] }, pointer: '/referenceSources/0/locator' },
    { patch: { referenceSources: [{ ...reference, rights: { status: 'unknown' } }] }, pointer: '/referenceSources/0/rights/attribution' },
    { patch: { referenceSources: [reference, reference] }, pointer: '/referenceSources/1/id' },
    { patch: { assets: [asset, asset] }, pointer: '/assets/1/id' },
    { patch: { assets: [asset, { ...asset, id: 'test:other' }] }, pointer: '/assets/1/path' },
    { patch: { assets: [{ ...asset, provenance: { kind: 'source-reproduction' } }] }, pointer: '/assets/0/provenance/reference' },
    { patch: { assets: [{ ...asset, provenance: { kind: 'atlas-illustration' } }] }, pointer: '/assets/0/provenance/note' },
    { patch: { assets: [{ ...asset, provenance: { kind: 'source-reproduction', reference: 'missing' } }] }, pointer: '/assets/0/provenance/reference' },
    { patch: { assets: [{ ...asset, provenance: { kind: 'atlas-illustration', note: 'test', reference: 'missing' } }] }, pointer: '/assets/0/provenance/reference' },
    { patch: { assets: [{ ...asset, mediaType: 'image/svg+xml' }] }, pointer: '/assets/0/mediaType' },
    { patch: { subjectContent: [{ ...content(), subject: 'missing' }] }, pointer: '/subjectContent/0/subject' },
    { patch: { subjectContent: [content(), content()] }, pointer: '/subjectContent/1/subject' },
    { patch: { subjectContent: [{ ...content(), sections: [] }] }, pointer: '/subjectContent/0/sections' },
    { patch: { subjectContent: [{ ...content(), sections: [content().sections[0], content().sections[0]] }] }, pointer: '/subjectContent/0/sections/1/id' },
    { patch: { subjectContent: [{ ...content(), sections: [{ ...content().sections[0], id: '../unsafe' }] }] }, pointer: '/subjectContent/0/sections/0/id' },
  ])('reports metadata errors at $pointer', ({ patch, pointer }) => {
    expect(errorFrom(() => compile({ ...body(), ...patch })).pointer).toBe(pointer);
  });

  it('reports both source locations for cross-file collisions rather than last-file-wins', () => {
    const error = errorFrom(() => compileCatalogDocuments([
      ...catalogSources, source(body(), 'a.json'), source({ referenceSources: [reference] }, 'z.json'),
    ]));
    expect(error.source).toBe('z.json');
    expect(error.pointer).toBe('/referenceSources/0/id');
    expect(error.message).toContain('a.json#/referenceSources/0');
  });

  it('handles prototype-like reference identifiers through map lookups', () => {
    const compiled = compile({ ...body([{ type: 'quote', reference: 'constructor', text: 'Synthetic quote.' }]), assets: [], referenceSources: [{ ...reference, id: 'constructor' }] });
    expect(compiled.referenceSources[0]?.id).toBe('constructor');
    expect(errorFrom(() => compile(body([{ type: 'quote', reference: 'constructor', text: 'Unknown unless declared.' }]))).pointer).toBe(`${blockPointer}/reference`);
  });

  it('discovers and removes content-only files without imports, model registration or stale output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-content-'));
    try {
      await writeFile(join(root, 'catalog.json'), source({ schemaVersion: '0.1', collections, subjects, occurrences }).text);
      expect((await discoverCatalogDocuments(root)).subjectContent).toEqual([]);
      await writeFile(join(root, 'entry.json'), source(body()).text);
      const added = await discoverCatalogDocuments(root);
      expect(added.subjectContent[0]?.subject).toBe('open-belt-drive');
      expect(added.catalog.subjects.size).toBe(subjects.length);
      expect(added.modelPresets).toEqual([]);
      await rm(join(root, 'entry.json'));
      const removed = await discoverCatalogDocuments(root);
      expect(removed.subjectContent).toEqual([]);
      expect(removed.referenceSources).toEqual([]);
      expect(removed.assets).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});