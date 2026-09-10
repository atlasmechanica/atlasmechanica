import {
  CATALOG_SCHEMA_VERSION,
  createCatalog,
  type CanonicalSubjectManifest,
  type CatalogIndex,
  type CatalogManifestSet,
  type CollectionManifest,
  type CollectionOccurrenceManifest,
} from './schema.js';

/** A data-only envelope; the enclosed records retain their existing semantics. */
export interface CatalogDocument {
  readonly format: 'atlas.catalog-document';
  readonly schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  readonly collections?: readonly CollectionManifest[];
  readonly subjects?: readonly CanonicalSubjectManifest[];
  readonly occurrences?: readonly CollectionOccurrenceManifest[];
}

export interface CatalogDocumentSource {
  /** Stable relative filename for deterministic ordering and diagnostics. */
  readonly path: string;
  readonly text: string;
}

export interface CompiledCatalogDocuments {
  /** Serializable build output. Browser consumers do not need filesystem access. */
  readonly manifests: CatalogManifestSet;
  readonly catalog: CatalogIndex;
}

export class CatalogAuthoringError extends TypeError {
  constructor(
    readonly source: string,
    readonly pointer: string,
    message: string,
  ) {
    super(`${source}${pointer === '' ? '' : `#${pointer}`}: ${message}`);
    this.name = 'CatalogAuthoringError';
  }
}

type Check = (value: unknown, source: string, pointer: string) => void;
type Shape = Readonly<Record<string, Check>>;

function fail(source: string, pointer: string, message: string): never {
  throw new CatalogAuthoringError(source, pointer, message);
}

function child(pointer: string, key: string | number): string {
  return `${pointer}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function record(value: unknown, source: string, pointer: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(source, pointer, 'Expected an object');
  }
  return value as Record<string, unknown>;
}

const text: Check = (value, source, pointer) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(source, pointer, 'Expected a nonempty string');
  }
};

function matching(pattern: RegExp, description: string): Check {
  return (value, source, pointer) => {
    text(value, source, pointer);
    if (!pattern.test(value as string)) fail(source, pointer, description);
  };
}

const id = matching(/^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/, 'Expected a stable lowercase identifier');
const slug = matching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a lowercase URL slug');
const positiveInteger: Check = (value, source, pointer) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(source, pointer, 'Expected a positive safe integer');
  }
};

function enumeration(...values: readonly string[]): Check {
  return (value, source, pointer) => {
    if (typeof value !== 'string' || !values.includes(value)) {
      fail(source, pointer, `Expected one of: ${values.join(', ')}`);
    }
  };
}

function array(check: Check): Check {
  return (value, source, pointer) => {
    if (!Array.isArray(value)) fail(source, pointer, 'Expected an array');
    value.forEach((item, index) => check(item, source, child(pointer, index)));
  };
}

function object(required: Shape, optional: Shape = {}): Check {
  // Map lookups deliberately do not accept inherited names such as constructor.
  const checks = new Map([...Object.entries(required), ...Object.entries(optional)]);
  return (value, source, pointer) => {
    const fields = record(value, source, pointer);
    for (const key of Object.keys(required)) {
      if (!Object.hasOwn(fields, key)) fail(source, child(pointer, key), 'Required field is missing');
    }
    for (const key of Object.keys(fields).sort()) {
      const check = checks.get(key);
      if (check === undefined) fail(source, child(pointer, key), 'Unknown field');
      check(fields[key], source, child(pointer, key));
    }
  };
}

const referenceUrl: Check = (value, source, pointer) => {
  text(value, source, pointer);
  const raw = value as string;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(source, pointer, 'Expected an absolute HTTP(S) source URL');
  }
  if (
    !/^https?:\/\//i.test(raw)
    || /[\u0000-\u0020\u007f\\]/.test(raw)
    || (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username !== '' || url.password !== ''
  ) {
    fail(source, pointer, 'Expected an absolute HTTP(S) source URL without credentials or whitespace');
  }
};

const version = enumeration(CATALOG_SCHEMA_VERSION);
const classification = object({}, {
  inputMotion: text,
  outputMotion: text,
  components: array(text),
  tags: array(text),
});

const fact: Check = (value, source, pointer) => {
  const fields = record(value, source, pointer);
  if (Object.hasOwn(fields, 'value') === Object.hasOwn(fields, 'tags')) {
    fail(source, pointer, 'A fact must have exactly one of value or tags');
  }
  object({ label: text }, { value: text, tags: array(text) })(value, source, pointer);
};

const collection = object({
  schemaVersion: version,
  id,
  shortTitle: text,
  title: text,
  rights: object({ status: enumeration('public-domain', 'copyrighted', 'unknown') }, { note: text }),
}, { sequence: positiveInteger, author: text });

const subject = object({
  schemaVersion: version,
  id,
  slug,
  title: text,
  seoDescription: text,
  summary: text,
  classification: object({
    inputMotion: text,
    outputMotion: text,
    functionalSignature: text,
    components: array(text),
  }),
  facts: array(fact),
}, {
  simulation: object({ status: enumeration('planned', 'interactive'), modelId: id, adapter: id }),
});

const occurrence = object({
  schemaVersion: version,
  id,
  collection: id,
  ordinal: positiveInteger,
  displayNumber: text,
  status: enumeration('cataloged', 'classified', 'mapped', 'interactive'),
  source: object({}, { referenceUrl, referenceLabel: text, excerpt: text }),
}, {
  classification,
  canonicalSubject: id,
  simulation: object({ modelId: id }),
  editorial: object({ heading: text }),
});

const documentCheck = object({
  format: enumeration('atlas.catalog-document'),
  schemaVersion: version,
}, {
  collections: array(collection),
  subjects: array(subject),
  occurrences: array(occurrence),
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** Parse untrusted JSON text, validate every field, and own/freeze the result. */
export function parseCatalogDocument(source: CatalogDocumentSource): CatalogDocument {
  let value: unknown;
  try {
    value = JSON.parse(source.text) as unknown;
  } catch {
    fail(source.path, '', 'Invalid JSON');
  }
  documentCheck(value, source.path, '');
  const document = value as CatalogDocument;
  if (
    (document.collections?.length ?? 0)
    + (document.subjects?.length ?? 0)
    + (document.occurrences?.length ?? 0) === 0
  ) {
    fail(source.path, '', 'Document must contain at least one catalog record');
  }
  return freeze(document);
}

interface Located<T> {
  readonly value: T;
  readonly source: string;
  readonly pointer: string;
}

function at<T>(located: Located<T>, field: string, message: string): never {
  return fail(located.source, child(located.pointer, field), message);
}

function unique<T>(items: readonly Located<T>[], field: string, key: (value: T) => string | undefined): void {
  const seen = new Map<string, Located<T>>();
  for (const item of items) {
    const value = key(item.value);
    if (value === undefined) continue;
    const previous = seen.get(value);
    if (previous !== undefined) {
      at(item, field, `Duplicate ${field} ${value}; first declared in ${previous.source}#${previous.pointer}`);
    }
    seen.set(value, item);
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pure compilation from text sources. No filesystem, Vite, dynamic imports, or
 * runtime registration. All records are resolved after all documents are read.
 */
export function compileCatalogDocuments(sources: readonly CatalogDocumentSource[]): CompiledCatalogDocuments {
  const collections: Located<CollectionManifest>[] = [];
  const subjects: Located<CanonicalSubjectManifest>[] = [];
  const occurrences: Located<CollectionOccurrenceManifest>[] = [];
  const paths = new Set<string>();
  for (const source of [...sources].sort((a, b) => compare(a.path, b.path))) {
    if (paths.has(source.path)) fail(source.path, '', 'Duplicate document path');
    paths.add(source.path);
    const document = parseCatalogDocument(source);
    const locate = <T>(values: readonly T[], field: string): Located<T>[] => values.map((value, index) => ({
      value, source: source.path, pointer: child(child('', field), index),
    }));
    collections.push(...locate(document.collections ?? [], 'collections'));
    subjects.push(...locate(document.subjects ?? [], 'subjects'));
    occurrences.push(...locate(document.occurrences ?? [], 'occurrences'));
  }

  unique(collections, 'id', (value) => value.id);
  unique(collections, 'sequence', (value) => value.sequence?.toString());
  unique(subjects, 'id', (value) => value.id);
  unique(subjects, 'slug', (value) => value.slug);
  unique(occurrences, 'id', (value) => value.id);
  unique(occurrences, 'ordinal', (value) => JSON.stringify([value.collection, value.ordinal]));

  const collectionIds = new Set(collections.map(({ value }) => value.id));
  const subjectById = new Map(subjects.map(({ value }) => [value.id, value]));
  for (const item of occurrences) {
    const value = item.value;
    if (!collectionIds.has(value.collection)) at(item, 'collection', `Unknown collection ${value.collection}`);
    if (value.status === 'classified') {
      const data = value.classification;
      if (!data || !(data.inputMotion || data.outputMotion || data.components?.length || data.tags?.length)) {
        at(item, 'classification', 'Classified occurrences need nonempty classification');
      }
    }
    if (value.status === 'cataloged' || value.status === 'classified') {
      if (value.canonicalSubject !== undefined) at(item, 'canonicalSubject', 'Unmapped occurrences cannot claim a subject');
      if (value.simulation !== undefined) at(item, 'simulation', 'Unmapped occurrences cannot claim a simulation');
      continue;
    }
    const canonical = value.canonicalSubject === undefined ? undefined : subjectById.get(value.canonicalSubject);
    if (canonical === undefined) at(item, 'canonicalSubject', 'Mapped/interactive occurrence needs a known canonical subject');
    if (value.status === 'mapped') {
      if (value.simulation !== undefined) at(item, 'simulation', 'Mapped occurrences cannot claim a simulation');
    } else {
      if (canonical.simulation?.status !== 'interactive') {
        at(item, 'canonicalSubject', 'Interactive occurrence needs an interactive canonical simulation');
      }
      if (value.simulation?.modelId !== canonical.simulation.modelId) {
        at(item, 'simulation', `Expected canonical model ${canonical.simulation.modelId}`);
      }
    }
  }

  const ordered = <T extends { readonly id: string }>(items: readonly Located<T>[]): readonly T[] =>
    items.map(({ value }) => value).sort((a, b) => compare(a.id, b.id));
  const manifests: CatalogManifestSet = freeze({
    collections: ordered(collections), subjects: ordered(subjects), occurrences: ordered(occurrences),
  });
  // The established catalog validator remains the final semantic authority.
  const catalog = createCatalog(manifests);
  return Object.freeze({ manifests, catalog });
}
