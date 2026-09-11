import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Ajv, type AnySchemaObject } from 'ajv';
import { normalizeParameterQuantity, quantity, type UnitCode } from '@atlasmechanica/model';
import {
  CATALOG_DOCUMENT_SCHEMA_VERSION, CatalogAuthoringError, compileCatalogDocuments,
  parseCatalogDocument, type CatalogDocumentSource, type CatalogLabTemplate,
} from './authoring.js';
import { CATALOG_SCHEMA_VERSION } from './schema.js';
import { readCatalogDocuments } from './discoverDocuments.js';
import { beltLabFamily, openBeltDriveLab, crossedBeltDriveLab, brown003QuarterTurnLab } from '../../lab/src/families/belt.js';
import { buildLabEvaluationRequest, defaultLabValues, assertValidInitialLabState } from '../../lab/src/core.js';
import { resolveMechanismLabFromFamily } from '../../lab/src/family.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Document = { [key: string]: Json };
const schema = JSON.parse(await readFile(new URL('../schema/catalog-document.schema.json', import.meta.url), 'utf8')) as AnySchemaObject;
const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
const validate = ajv.compile(schema);
const fixtureSources = await readCatalogDocuments(new URL('../fixtures/', import.meta.url));
const recordFields = ['collections', 'subjects', 'occurrences', 'modelPresets', 'simulationBindings', 'referenceSources', 'assets', 'subjectContent', 'labPresentations'] as const;
const templates: readonly CatalogLabTemplate[] = [
  { id: 'belt:open-classic', adapterId: 'atlas.analytic-belt.v0', definition: openBeltDriveLab },
  { id: 'belt:crossed-classic', adapterId: 'atlas.analytic-belt.v0', definition: crossedBeltDriveLab },
  { id: 'belt:guided-classic', adapterId: 'atlas.spatial-belt.v0', definition: brown003QuarterTurnLab },
];
const options = { models: beltLabFamily.models, labTemplates: templates };
function source(value: Json, path = 'schema-test.json'): CatalogDocumentSource {
  return { path, text: JSON.stringify(value) };
}
function acceptsParser(input: CatalogDocumentSource): boolean {
  try { parseCatalogDocument(input); return true; }
  catch (error) { if (!(error instanceof CatalogAuthoringError)) throw error; return false; }
}
function assertBoth(value: Json, expected: boolean): void {
  const input = source(value);
  const parsed = JSON.parse(input.text) as Json;
  expect(validate(parsed), ajv.errorsText(validate.errors)).toBe(expected);
  expect(acceptsParser(input), input.text).toBe(expected);
}
function combined(): Document {
  const document: Document = { format: 'atlas.catalog-document', schemaVersion: CATALOG_DOCUMENT_SCHEMA_VERSION };
  for (const field of recordFields) document[field] = [];
  for (const item of fixtureSources) {
    const value = JSON.parse(item.text) as Document;
    for (const field of recordFields) (document[field] as Json[]).push(...(value[field] as Json[] | undefined ?? []));
  }
  return document;
}
function row(document: Document, field: typeof recordFields[number], key: string, value: string): Document {
  const item = (document[field] as Document[]).find((candidate) => candidate[key] === value);
  if (item === undefined) throw new Error(`Missing fixture ${field}.${key}=${value}`);
  return item;
}
const text = (value = 'Literal synthetic text') => ({ type: 'text', text: value });
const rights = { status: 'unknown', attribution: 'Synthetic schema test; no historical or rights assertion.' };
// Exercise every grammar alternative even when the production-migration examples
// do not need it yet. This is not another source of historical product content.
const grammar: Document = {
  format: 'atlas.catalog-document', schemaVersion: '0.4',
  collections: [{ schemaVersion: '0.1', id: 'synthetic:collection', shortTitle: 'Test', title: 'Synthetic', rights: { status: 'unknown', note: 'Test only' }, author: 'Test', sequence: 1 }],
  subjects: [{ schemaVersion: '0.1', id: 'synthetic:subject', slug: 'synthetic-subject', title: 'Test', seoDescription: 'Test', summary: 'Test', classification: { inputMotion: 'rotation', outputMotion: 'rotation', functionalSignature: 'Test', components: ['pulley'] }, facts: [{ label: 'Value', value: 'x' }, { label: 'Tags', tags: ['x'] }], simulation: { status: 'planned', modelId: 'foundation:belt-drive:open', adapter: 'atlas.analytic-belt.v0' } }],
  occurrences: [{ schemaVersion: '0.1', id: 'synthetic:001', collection: 'synthetic:collection', ordinal: 1, displayNumber: '001', status: 'cataloged', source: { referenceUrl: 'https://example.org/test', referenceLabel: 'Test', excerpt: 'Test' }, classification: { inputMotion: 'rotation', outputMotion: 'rotation', components: ['pulley'], tags: ['synthetic'] }, editorial: { heading: 'Synthetic' } }],
  modelPresets: [{ id: 'synthetic:preset', modelId: 'foundation:belt-drive:open', configuration: 'reference', parameters: { 'driver-radius': { value: 40, unit: 'mm' } } }],
  simulationBindings: [{ subject: 'synthetic:subject', preset: 'synthetic:preset' }],
  referenceSources: [{ id: 'synthetic:print', title: 'Synthetic print source', locator: 'Test figure', rights, author: 'Test', edition: 'Test' }, { id: 'synthetic:online', title: 'Synthetic online source', locator: 'Test figure', rights, url: 'HTTPS://example.org/test?x=1#figure' }],
  assets: [
    { id: 'synthetic:png', path: '/assets/catalog/tests/image.png', mediaType: 'image/png', rights, provenance: { kind: 'source-reproduction', reference: 'synthetic:print' } },
    { id: 'synthetic:jpeg', path: '/assets/catalog/tests/image.jpeg', mediaType: 'image/jpeg', rights, provenance: { kind: 'atlas-illustration', note: 'Synthetic', reference: 'synthetic:online' } },
    { id: 'synthetic:webp', path: '/assets/catalog/tests/image.webp', mediaType: 'image/webp', rights, provenance: { kind: 'atlas-illustration', note: 'Synthetic' } },
  ],
  subjectContent: [{ subject: 'synthetic:subject', sections: [{ id: 'all-blocks', title: 'Every block', eyebrow: 'Synthetic', blocks: [
    { type: 'paragraph', content: [text(), { type: 'emphasis', text: 'x' }, { type: 'strong', text: 'x' }, { type: 'code', text: '<b>literal</b>' }, { type: 'reference-link', reference: 'synthetic:online', text: 'Source' }, { type: 'subject-link', subject: 'synthetic:subject', text: 'Subject' }] },
    { type: 'heading', text: 'Heading' },
    { type: 'list', style: 'ordered', items: [[text()], [text()]] },
    { type: 'formula', expression: 'v = rω', caption: [text('Display text only')] },
    { type: 'quote', reference: 'synthetic:print', text: 'Synthetic quotation' },
    { type: 'note', kind: 'assumption', content: [text()] },
    { type: 'note', kind: 'limitation', content: [text()] },
    { type: 'note', kind: 'reference-geometry', content: [text()] },
    { type: 'image', asset: 'synthetic:png', alt: 'Synthetic image', caption: [text()] },
    { type: 'related', subject: 'synthetic:subject', label: 'Test', description: 'Test' },
  ] }] }],
  labPresentations: [{ id: 'synthetic:lab', subject: 'synthetic:subject', template: 'belt:open-classic', settings: { subtitle: 'Test', views: ['2d', '3d'], controls: [{ id: 'driver-speed', label: 'Speed', min: 10, max: 120, step: 1, initial: 30 }], readouts: [{ id: 'speed-ratio', label: 'Ratio', digits: 4 }] } }],
};
const corpus = [...fixtureSources, source(grammar, 'synthetic-grammar.json')];
function* nodes(value: Json, path: string[] = []): Generator<{ path: string[]; value: Json }> {
  yield { path, value };
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) yield* nodes(nested, [...path, key]);
  }
}
function edit(value: Json, path: readonly string[], replacement: Json, remove = false): Json {
  if (path.length === 0) return replacement;
  const copy = structuredClone(value);
  let parent = copy as Document;
  for (const key of path.slice(0, -1)) parent = parent[key] as Document;
  const key = path.at(-1)!;
  if (remove) delete parent[key]; else parent[key] = replacement;
  return copy;
}

describe('portable editor JSON Schema', () => {
  it('is a valid strict draft-07 schema, with local refs and no execution extensions', () => {
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.properties.schemaVersion.enum.at(-1)).toBe(CATALOG_DOCUMENT_SCHEMA_VERSION);
    expect(schema.definitions.recordVersion.const).toBe(CATALOG_SCHEMA_VERSION);
    for (const { value } of nodes(schema as Json)) {
      if (value !== null && !Array.isArray(value) && typeof value === 'object') {
        if ('$ref' in value) expect(String(value.$ref)).toMatch(/^#\/definitions\//);
        expect('$data' in value).toBe(false);
      }
    }
  });
  it('associates new files by glob with the local schema, not per-item registrations', async () => {
    const settings = JSON.parse(await readFile(new URL('../../../.vscode/settings.json', import.meta.url), 'utf8'));
    const association = settings['json.schemas'][0];
    expect(association.url).toBe('./packages/catalog/schema/catalog-document.schema.json');
    expect(association.fileMatch).toContain('**/*.atlas.json');
    expect(association.fileMatch.every((pattern: string) => pattern.includes('*'))).toBe(true);
  });
  it.each(corpus.map((item) => [item.path, item] as const))('accepts and round-trips the discovered %s example without mutation', (_path, item) => {
    const value = JSON.parse(item.text) as Json;
    const before = JSON.stringify(value);
    expect(validate(value), ajv.errorsText(validate.errors)).toBe(true);
    const parsed = parseCatalogDocument(item);
    expect(JSON.stringify(value)).toBe(before);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(value);
  });
  it.each(corpus.map((item) => [item.path, item] as const))('matches decoder structure for generated mutations of %s', (name, item) => {
    const document = JSON.parse(item.text) as Json;
    let checked = 0;
    const check = (mutated: Json, label: string) => {
      const input = source(mutated, name);
      const value = JSON.parse(input.text) as Json;
      expect(validate(value), `${name} ${label}: ${ajv.errorsText(validate.errors)}`).toBe(acceptsParser(input));
      checked += 1;
    };
    for (const { path, value } of nodes(document)) {
      const pointer = '/' + path.join('/');
      check(edit(document, path, null), `${pointer} null`);
      if (typeof value === 'string') check(edit(document, path, ''), `${pointer} empty`);
      if (typeof value === 'number') check(edit(document, path, 'not a number'), `${pointer} wrong numeric type`);
      if (Array.isArray(value)) check(edit(document, path, []), `${pointer} empty array`);
      else if (value !== null && typeof value === 'object') {
        check(edit(document, [...path, '__unexpected__'], true), `${pointer} unknown field`);
        for (const key of Object.keys(value)) check(edit(document, [...path, key], null, true), `${pointer} missing ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
  it.each(['0.1', '0.2', '0.3', '0.4'])('enforces every field gate in envelope %s, including empty new fields', (version) => {
    const introduced = [0, 0, 0, 1, 1, 2, 2, 2, 3];
    recordFields.forEach((field, index) => {
      const value = { format: 'atlas.catalog-document', schemaVersion: version, collections: grammar.collections!, [field]: [] };
      if (field === 'collections') value.collections = grammar.collections!;
      assertBoth(value, Number(version.slice(2)) - 1 >= introduced[index]!);
    });
  });
  it.each([{}, { collections: [] }, { modelPresets: [], labPresentations: [] }])('rejects an empty envelope %j', (body) => {
    assertBoth({ format: 'atlas.catalog-document', schemaVersion: '0.4', ...body }, false);
  });
  it.each(['0.0', '0.5', '1.0'])('rejects unsupported version %s', (schemaVersion) => assertBoth({ ...grammar, schemaVersion }, false));
  it('does not loosen JSON parsing for editor comments, trailing commas or a document $schema field', () => {
    expect(acceptsParser({ path: 'comments.json', text: '{/* comment */}' })).toBe(false);
    expect(acceptsParser({ path: 'comma.json', text: '{"format":"atlas.catalog-document",}' })).toBe(false);
    assertBoth({ ...grammar, $schema: './arbitrary-schema.json' }, false);
  });
  it('keeps the complete existing unit vocabulary and finite numeric boundary', () => {
    const units: Record<UnitCode, true> = { '1': true, m: true, mm: true, rad: true, deg: true, 'rad/s': true, 'deg/s': true, 'rad/s^2': true, 'deg/s^2': true, 'm/s': true, 'mm/s': true, 'm/s^2': true, 'mm/s^2': true };
    expect([...schema.definitions.quantity.properties.unit.enum].sort()).toEqual(Object.keys(units).sort());
    for (const unit of Object.keys(units)) {
      expect(() => normalizeParameterQuantity({ value: 1, unit })).not.toThrow();
      assertBoth({ ...grammar, modelPresets: [{ id: 'test:preset', modelId: 'test:model', parameters: { x: { value: 1, unit } } }] }, true);
    }
    for (const unit of ['rpm', 'cm', 'constructor']) assertBoth({ ...grammar, modelPresets: [{ id: 'test:preset', modelId: 'test:model', parameters: { x: { value: 1, unit } } }] }, false);
    const input = source({ ...grammar, modelPresets: [{ id: 'test:preset', modelId: 'test:model', parameters: { x: { value: 1234567, unit: 'm' } } }] });
    input.text = input.text.replace('1234567', '1e999');
    expect(validate(JSON.parse(input.text))).toBe(false);
    expect(acceptsParser(input)).toBe(false);
  });
  it.each(['', ' ', '\n\t', '\u00a0', '\ufeff'])('rejects whitespace-only literal text %j', (title) => {
    assertBoth({ ...grammar, referenceSources: [{ id: 'test:ref', title, locator: 'Test', rights }] }, false);
  });
  it.each([
    ['/assets/catalog/test.png', 'image/png', true], ['/assets/catalog/test.jpg', 'image/jpeg', true],
    ['/assets/catalog/test.jpeg', 'image/jpeg', true], ['/assets/catalog/test.webp', 'image/webp', true],
    ['/assets/catalog/test.png\n', 'image/png', false], ['/assets/catalog/test.PNG', 'image/png', false],
    ['/assets/catalog/test.png', 'image/jpeg', false], ['/assets/catalog/test.svg', 'image/png', false],
    ['/assets/catalog/../test.png', 'image/png', false], ['/assets/catalog/%2e%2e/test.png', 'image/png', false],
    ['/assets/catalog/.hidden/test.png', 'image/png', false], ['/assets/catalog/test.png?x=1', 'image/png', false],
  ] as const)('matches raster path/media validation for %s / %s', (path, mediaType, expected) => {
    assertBoth({ ...grammar, assets: [{ ...(grammar.assets as Document[])[0]!, path, mediaType }] }, expected);
  });
  it.each(['javascript:alert(1)', 'data:text/plain,x', '//example.org', 'https://example.org/space here', 'https://example.org/a\nb', 'https:\\example.org'])('rejects lexically unsafe source URL %j', (url) => {
    assertBoth({ ...grammar, referenceSources: [{ id: 'test:ref', title: 'Test', locator: 'Test', rights, url }] }, false);
  });
});

// These are executable, named limits of portable editor validation, not a blanket
// exception to the differential corpus. They must continue failing at the stated
// compiler/decoder/solver stage even though their JSON structure is well formed.
describe('editor validity is not runtime validity', () => {
  it('compiles all mixed-version fixtures in either order with unchanged statuses', () => {
    const normal = compileCatalogDocuments(fixtureSources, options);
    const reverse = compileCatalogDocuments([...fixtureSources].reverse(), options);
    expect(reverse.manifests).toEqual(normal.manifests);
    expect(reverse.labPresentations).toEqual(normal.labPresentations);
    expect(normal.labPresentations).toHaveLength(3);
    expect(normal.catalog.occurrences.get('brown:003')?.status).toBe('mapped');
    expect(validate(combined())).toBe(true);
    expect(compileCatalogDocuments([source(combined())], options).manifests).toEqual(normal.manifests);
  });
  const semanticCases: readonly { name: string; mutate: (document: Document) => void; error: RegExp }[] = [
    { name: 'duplicate subject IDs', mutate: (d) => (d.subjects as Json[]).push(structuredClone((d.subjects as Json[])[0]!)), error: /Duplicate id/ },
    { name: 'duplicate slugs', mutate: (d) => { (d.subjects as Document[])[1]!.slug = (d.subjects as Document[])[0]!.slug!; }, error: /Duplicate slug/ },
    { name: 'dangling canonical reference', mutate: (d) => { row(d, 'occurrences', 'id', 'brown:003').canonicalSubject = 'missing'; }, error: /known canonical subject/ },
    { name: 'unknown model', mutate: (d) => { row(d, 'modelPresets', 'id', 'example:open-ratio').modelId = 'missing'; }, error: /Unknown supplied model/ },
    { name: 'wrong physical unit', mutate: (d) => { row(d, 'modelPresets', 'id', 'example:open-ratio').parameters = { 'driver-radius': { value: 45, unit: 'rad' } }; }, error: /incompatible unit/ },
    { name: 'out-of-domain parameter', mutate: (d) => { row(d, 'modelPresets', 'id', 'example:open-ratio').parameters = { 'driver-radius': { value: 0, unit: 'mm' } }; }, error: /outside the declared domain/ },
    { name: 'unknown parameter', mutate: (d) => { row(d, 'modelPresets', 'id', 'example:open-ratio').parameters = { missing: { value: 1, unit: 'mm' } }; }, error: /Unknown parameter/ },
    { name: 'unknown configuration', mutate: (d) => { row(d, 'modelPresets', 'id', 'example:open-ratio').configuration = 'missing'; }, error: /known configuration/ },
    { name: 'unknown template', mutate: (d) => { row(d, 'labPresentations', 'subject', 'open-belt-drive').template = 'missing'; }, error: /Unknown supplied lab template/ },
    { name: 'unreachable slider maximum', mutate: (d) => { row(d, 'labPresentations', 'subject', 'open-belt-drive').settings = { controls: [{ id: 'driver-speed', min: 10, max: 20, step: 3, initial: 13 }] }; }, error: /Maximum value.*align/ },
    { name: 'narrowed animated period', mutate: (d) => { row(d, 'labPresentations', 'subject', 'open-belt-drive').settings = { controls: [{ id: 'driver-angle', max: 180 }] }; }, error: /periodic coordinates must preserve/ },
    { name: 'duplicate override IDs with distinct labels', mutate: (d) => { row(d, 'labPresentations', 'subject', 'open-belt-drive').settings = { controls: [{ id: 'driver-speed', label: 'A' }, { id: 'driver-speed', label: 'B' }] }; }, error: /Duplicate controls override/ },
    { name: 'dangling editorial link', mutate: (d) => { d.subjectContent = [{ subject: 'open-belt-drive', sections: [{ id: 'test', title: 'Test', blocks: [{ type: 'paragraph', content: [{ type: 'reference-link', reference: 'missing', text: 'Test' }] }] }] }]; }, error: /Unknown source reference/ },
  ];
  it.each(semanticCases)('still rejects $name after the editor accepts its structure', ({ mutate, error }) => {
    const document = combined();
    mutate(document);
    expect(validate(document), ajv.errorsText(validate.errors)).toBe(true);
    expect(() => compileCatalogDocuments([source(document)], options)).toThrow(error);
  });
  it.each(['https://user:password@example.org/test', 'https://[invalid-host]/', 'https://'])('retains full URL parsing and credential rejection for %s', (url) => {
    const document = { ...grammar, referenceSources: [{ id: 'test:ref', title: 'Test', locator: 'Test', rights, url }] };
    expect(validate(document)).toBe(true);
    expect(() => parseCatalogDocument(source(document))).toThrow(/source URL/);
  });
  it('retains canonical-unit underflow rejection beyond the schema numeric range', () => {
    const document = { ...grammar, modelPresets: [{ id: 'test:preset', modelId: 'test:model', parameters: { x: { value: Number.MIN_VALUE, unit: 'mm' } } }] };
    expect(validate(document)).toBe(true);
    expect(() => parseCatalogDocument(source(document))).toThrow(/underflows/);
  });
  it('still rejects impossible spatial geometry after schema and catalog compilation pass', () => {
    const document = combined();
    row(document, 'modelPresets', 'id', 'example:guided-ratio').parameters = { 'driver-radius': { value: 30, unit: 'mm' } };
    expect(validate(document)).toBe(true);
    const compiled = compileCatalogDocuments([source(document)], options);
    const definition = compiled.labPresentations.find((item) => item.subject === 'quarter-turn-belt-drive')!.definition;
    const resolved = resolveMechanismLabFromFamily({ ...beltLabFamily, definitions: [definition] }, definition.modelId, 'atlas.spatial-belt.v0', definition.id);
    const session = resolved.adapter.compile(resolved.model).createSession({ configuration: definition.sessionConfiguration! });
    const state = session.evaluate(buildLabEvaluationRequest(definition, defaultLabValues(definition)));
    expect(state.diagnostics[0]?.code).toBe('invalid-geometry');
    expect(() => assertValidInitialLabState(definition, state)).toThrow(/invalid initial state/);
  });
});
