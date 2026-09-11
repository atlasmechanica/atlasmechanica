import { normalizeParameterQuantity, ParameterValueError, type SimulationModel } from '@atlasmechanica/model';
import {
  CATALOG_SCHEMA_VERSION,
  createCatalog,
  type CanonicalSubjectManifest,
  type CatalogIndex,
  type CatalogManifestSet,
  type CollectionManifest,
  type CollectionOccurrenceManifest,
} from './schema.js';
import {
  array, at, child, compare, enumeration, fail, freeze, id, object, positiveInteger,
  record, referenceUrl, slug, text, unique, type Check, type Located,
} from './authoringChecks.js';
import {
  resolveCatalogModelPreset,
  type CatalogCompileOptions,
  type CatalogModelPreset,
  type CatalogSimulationBinding,
  type ResolvedCatalogModelPreset,
} from './modelPresets.js';
import {
  assetCheck, compileCatalogContent, sourceReferenceCheck, subjectContentCheck,
  type CatalogAsset, type CatalogSourceReference, type CatalogSubjectContent, type CompiledCatalogContent,
} from './editorialContent.js';
import {
  compileCatalogLabPresentations, labPresentationCheck,
  type CatalogLabPresentation, type ResolvedCatalogLabPresentation,
} from './labPresentations.js';
export { CatalogAuthoringError } from './authoringError.js';
export type { CatalogCompileOptions, CatalogModelPreset, CatalogSimulationBinding, ResolvedCatalogModelPreset } from './modelPresets.js';
export type {
  CatalogAsset, CatalogContentRights, CatalogEditorialBlock, CatalogEditorialSection,
  CatalogInline, CatalogSourceReference, CatalogSubjectContent, CompiledCatalogContent,
} from './editorialContent.js';
export type { CatalogLabPresentation, CatalogLabTemplate, ResolvedCatalogLabPresentation } from './labPresentations.js';

export const CATALOG_DOCUMENT_SCHEMA_VERSION = '0.4' as const;

/** Envelope versions are independent of the enclosed catalog/model schemas. */
export interface CatalogDocument {
  readonly format: 'atlas.catalog-document';
  readonly schemaVersion: '0.1' | '0.2' | '0.3' | typeof CATALOG_DOCUMENT_SCHEMA_VERSION;
  readonly collections?: readonly CollectionManifest[];
  readonly subjects?: readonly CanonicalSubjectManifest[];
  readonly occurrences?: readonly CollectionOccurrenceManifest[];
  readonly modelPresets?: readonly CatalogModelPreset[];
  readonly simulationBindings?: readonly CatalogSimulationBinding[];
  readonly referenceSources?: readonly CatalogSourceReference[];
  readonly assets?: readonly CatalogAsset[];
  readonly subjectContent?: readonly CatalogSubjectContent[];
  readonly labPresentations?: readonly CatalogLabPresentation[];
}

export interface CatalogDocumentSource {
  /** Stable relative filename for deterministic ordering and diagnostics. */
  readonly path: string;
  readonly text: string;
}

export interface CompiledCatalogDocuments extends CompiledCatalogContent {
  /** Serializable build output. Browser consumers do not need filesystem access. */
  readonly manifests: CatalogManifestSet;
  readonly catalog: CatalogIndex;
  readonly modelPresets: readonly ResolvedCatalogModelPreset[];
  readonly simulationBindings: readonly CatalogSimulationBinding[];
  readonly labPresentations: readonly ResolvedCatalogLabPresentation[];
}

const version = enumeration(CATALOG_SCHEMA_VERSION);
const classification = object({}, {
  inputMotion: text, outputMotion: text, components: array(text), tags: array(text),
});
const fact: Check = (value, source, pointer) => {
  const fields = record(value, source, pointer);
  if (Object.hasOwn(fields, 'value') === Object.hasOwn(fields, 'tags')) {
    fail(source, pointer, 'A fact must have exactly one of value or tags');
  }
  object({ label: text }, { value: text, tags: array(text) })(value, source, pointer);
};
const collection = object({
  schemaVersion: version, id, shortTitle: text, title: text,
  rights: object({ status: enumeration('public-domain', 'copyrighted', 'unknown') }, { note: text }),
}, { sequence: positiveInteger, author: text });
const subject = object({
  schemaVersion: version, id, slug, title: text, seoDescription: text, summary: text,
  classification: object({ inputMotion: text, outputMotion: text, functionalSignature: text, components: array(text) }),
  facts: array(fact),
}, { simulation: object({ status: enumeration('planned', 'interactive'), modelId: id, adapter: id }) });
const occurrence = object({
  schemaVersion: version, id, collection: id, ordinal: positiveInteger, displayNumber: text,
  status: enumeration('cataloged', 'classified', 'mapped', 'interactive'),
  source: object({}, { referenceUrl, referenceLabel: text, excerpt: text }),
}, {
  classification, canonicalSubject: id, simulation: object({ modelId: id }), editorial: object({ heading: text }),
});

const parameterMap: Check = (value, source, pointer) => {
  const parameters = record(value, source, pointer);
  for (const key of Object.keys(parameters).sort()) {
    const location = child(pointer, key);
    id(key, source, location);
    try {
      normalizeParameterQuantity(parameters[key], undefined, location);
    } catch (error) {
      if (!(error instanceof ParameterValueError)) throw error;
      fail(source, error.pointer, error.detail);
    }
  }
};
const preset = object({ id, modelId: id }, { configuration: id, parameters: parameterMap });
const simulationBinding = object({ subject: id, preset: id });
const catalogFields = { collections: array(collection), subjects: array(subject), occurrences: array(occurrence) };
const contentFields = {
  referenceSources: array(sourceReferenceCheck), assets: array(assetCheck), subjectContent: array(subjectContentCheck),
};
const documentCheck = object({
  format: enumeration('atlas.catalog-document'), schemaVersion: enumeration('0.1', '0.2', '0.3', CATALOG_DOCUMENT_SCHEMA_VERSION),
}, {
  ...catalogFields, modelPresets: array(preset), simulationBindings: array(simulationBinding),
  ...contentFields, labPresentations: array(labPresentationCheck),
});

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
  if (document.schemaVersion === '0.1') {
    for (const key of ['modelPresets', 'simulationBindings'] as const) {
      if (Object.hasOwn(document, key)) fail(source.path, child('', key), 'Field requires catalog-document version 0.2');
    }
  }
  if (document.schemaVersion === '0.1' || document.schemaVersion === '0.2') {
    for (const key of ['referenceSources', 'assets', 'subjectContent'] as const) {
      if (Object.hasOwn(document, key)) fail(source.path, child('', key), 'Field requires catalog-document version 0.3');
    }
  }
  if (document.schemaVersion !== '0.4' && Object.hasOwn(document, 'labPresentations')) {
    fail(source.path, '/labPresentations', 'Field requires catalog-document version 0.4');
  }
  if (
    (document.collections?.length ?? 0) + (document.subjects?.length ?? 0)
    + (document.occurrences?.length ?? 0) + (document.modelPresets?.length ?? 0)
    + (document.simulationBindings?.length ?? 0) + (document.referenceSources?.length ?? 0)
    + (document.assets?.length ?? 0) + (document.subjectContent?.length ?? 0)
    + (document.labPresentations?.length ?? 0) === 0
  ) {
    fail(source.path, '', 'Document must contain at least one catalog, preset, source, asset, content or lab record');
  }
  return freeze(document);
}

/** Pure compilation. The caller supplies known models/templates; no engine is loaded here. */
export function compileCatalogDocuments(
  sources: readonly CatalogDocumentSource[],
  options: CatalogCompileOptions = {},
): CompiledCatalogDocuments {
  const collections: Located<CollectionManifest>[] = [];
  const subjects: Located<CanonicalSubjectManifest>[] = [];
  const occurrences: Located<CollectionOccurrenceManifest>[] = [];
  const presets: Located<CatalogModelPreset>[] = [];
  const bindings: Located<CatalogSimulationBinding>[] = [];
  const references: Located<CatalogSourceReference>[] = [];
  const assets: Located<CatalogAsset>[] = [];
  const content: Located<CatalogSubjectContent>[] = [];
  const presentations: Located<CatalogLabPresentation>[] = [];
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
    presets.push(...locate(document.modelPresets ?? [], 'modelPresets'));
    bindings.push(...locate(document.simulationBindings ?? [], 'simulationBindings'));
    references.push(...locate(document.referenceSources ?? [], 'referenceSources'));
    assets.push(...locate(document.assets ?? [], 'assets'));
    content.push(...locate(document.subjectContent ?? [], 'subjectContent'));
    presentations.push(...locate(document.labPresentations ?? [], 'labPresentations'));
  }
  unique(collections, 'id', (value) => value.id);
  unique(collections, 'sequence', (value) => value.sequence?.toString());
  unique(subjects, 'id', (value) => value.id);
  unique(subjects, 'slug', (value) => value.slug);
  unique(occurrences, 'id', (value) => value.id);
  unique(occurrences, 'ordinal', (value) => JSON.stringify([value.collection, value.ordinal]));
  unique(presets, 'id', (value) => value.id);
  unique(bindings, 'subject', (value) => value.subject);

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
      if (canonical.simulation?.status !== 'interactive') at(item, 'canonicalSubject', 'Interactive occurrence needs an interactive canonical simulation');
      if (value.simulation?.modelId !== canonical.simulation.modelId) at(item, 'simulation', `Expected canonical model ${canonical.simulation.modelId}`);
    }
  }

  const models = new Map<string, SimulationModel>();
  for (const model of options.models ?? []) {
    if (models.has(model.id)) fail('<models>', '', `Duplicate supplied model ${model.id}`);
    models.set(model.id, model);
  }
  const resolvedPresets = presets.map((item) => {
    const model = models.get(item.value.modelId);
    if (model === undefined) at(item, 'modelId', `Unknown supplied model ${item.value.modelId}`);
    return resolveCatalogModelPreset(item.value, model, item.source, item.pointer);
  }).sort((a, b) => compare(a.id, b.id));
  const presetById = new Map(resolvedPresets.map((value) => [value.id, value]));
  for (const item of bindings) {
    const canonical = subjectById.get(item.value.subject);
    if (canonical?.simulation === undefined) at(item, 'subject', 'Binding requires a known subject with a simulation');
    const resolved = presetById.get(item.value.preset);
    if (resolved === undefined) at(item, 'preset', `Unknown preset ${item.value.preset}`);
    if (resolved.modelId !== canonical.simulation.modelId) at(item, 'preset', 'Preset must reference the subject simulation model');
  }

  const ordered = <T extends { readonly id: string }>(items: readonly Located<T>[]): readonly T[] =>
    items.map(({ value }) => value).sort((a, b) => compare(a.id, b.id));
  const manifests: CatalogManifestSet = freeze({
    collections: ordered(collections), subjects: ordered(subjects), occurrences: ordered(occurrences),
  });
  const catalog = createCatalog(manifests);
  const editorial = compileCatalogContent(references, assets, content, new Set(subjectById.keys()));
  const labPresentations = compileCatalogLabPresentations(
    presentations, options.labTemplates ?? [], models, subjectById, presetById, bindings.map(({ value }) => value),
  );
  return Object.freeze({
    manifests, catalog, ...editorial, labPresentations,
    modelPresets: Object.freeze(resolvedPresets),
    simulationBindings: Object.freeze(bindings.map(({ value }) => value).sort((a, b) => compare(a.subject, b.subject))),
  });
}
