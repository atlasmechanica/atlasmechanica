export const CATALOG_SCHEMA_VERSION = '0.1' as const;

export type CanonicalSubjectId = string;
export type CollectionId = string;
export type CollectionOccurrenceId = string;

export type CatalogImplementationStatus =
  | 'cataloged'
  | 'classified'
  | 'mapped'
  | 'interactive';

export interface SubjectFact {
  label: string;
  value?: string;
  tags?: readonly string[];
}

export interface CanonicalSubjectManifest {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  id: CanonicalSubjectId;
  slug: string;
  title: string;
  seoDescription: string;
  summary: string;
  classification: {
    inputMotion: string;
    outputMotion: string;
    functionalSignature: string;
    components: readonly string[];
  };
  simulation?: {
    status: 'planned' | 'interactive';
    modelId: string;
    adapter: string;
  };
  facts: readonly SubjectFact[];
}

export interface CollectionManifest {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  id: CollectionId;
  sequence?: number;
  shortTitle: string;
  title: string;
  author?: string;
  rights: {
    status: 'public-domain' | 'copyrighted' | 'unknown';
    note?: string;
  };
}

export interface CollectionOccurrenceManifest {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  id: CollectionOccurrenceId;
  collection: CollectionId;
  ordinal: number;
  displayNumber: string;
  canonicalSubject: CanonicalSubjectId;
  implementation: {
    status: CatalogImplementationStatus;
    simulationModelId?: string;
  };
  source: {
    referenceUrl?: string;
    referenceLabel?: string;
    excerpt?: string;
  };
  editorial?: {
    heading: string;
  };
}

export interface CatalogManifestSet {
  collections: readonly CollectionManifest[];
  subjects: readonly CanonicalSubjectManifest[];
  occurrences: readonly CollectionOccurrenceManifest[];
}

export interface CatalogIndex {
  collections: ReadonlyMap<CollectionId, CollectionManifest>;
  subjects: ReadonlyMap<CanonicalSubjectId, CanonicalSubjectManifest>;
  occurrences: ReadonlyMap<CollectionOccurrenceId, CollectionOccurrenceManifest>;
}

export function defineCanonicalSubject<const T extends CanonicalSubjectManifest>(manifest: T): T {
  return manifest;
}

export function defineCollection<const T extends CollectionManifest>(manifest: T): T {
  return manifest;
}

export function defineCollectionOccurrence<const T extends CollectionOccurrenceManifest>(manifest: T): T {
  return manifest;
}

function indexById<T extends { id: string }>(kind: string, manifests: readonly T[]): ReadonlyMap<string, T> {
  const index = new Map<string, T>();

  for (const manifest of manifests) {
    if (index.has(manifest.id)) {
      throw new Error(`Duplicate ${kind} id: ${manifest.id}`);
    }
    index.set(manifest.id, manifest);
  }

  return index;
}

export function createCatalog(manifests: CatalogManifestSet): CatalogIndex {
  const collections = indexById('collection', manifests.collections);
  const subjects = indexById('canonical subject', manifests.subjects);
  const occurrences = indexById('collection occurrence', manifests.occurrences);

  const slugs = new Set<string>();
  for (const subject of manifests.subjects) {
    if (slugs.has(subject.slug)) {
      throw new Error(`Duplicate canonical subject slug: ${subject.slug}`);
    }
    slugs.add(subject.slug);
  }

  for (const occurrence of manifests.occurrences) {
    if (!collections.has(occurrence.collection)) {
      throw new Error(
        `Collection occurrence ${occurrence.id} references unknown collection ${occurrence.collection}`,
      );
    }

    const subject = subjects.get(occurrence.canonicalSubject);
    if (!subject) {
      throw new Error(
        `Collection occurrence ${occurrence.id} references unknown canonical subject ${occurrence.canonicalSubject}`,
      );
    }

    if (
      occurrence.implementation.status === 'interactive' &&
      occurrence.implementation.simulationModelId !== subject.simulation?.modelId
    ) {
      throw new Error(
        `Interactive occurrence ${occurrence.id} must reference canonical simulation ${subject.simulation?.modelId ?? '(none)'}`,
      );
    }
  }

  return { collections, subjects, occurrences };
}
