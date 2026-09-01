export const CATALOG_SCHEMA_VERSION = '0.1' as const;

export type CanonicalSubjectId = string;
export type CollectionId = string;
export type CollectionOccurrenceId = string;

export type CatalogOccurrenceStatus =
  | 'cataloged'
  | 'classified'
  | 'mapped'
  | 'interactive';

export interface OccurrenceClassification {
  readonly inputMotion?: string;
  readonly outputMotion?: string;
  readonly components?: readonly string[];
  readonly tags?: readonly string[];
}

export type SubjectFact =
  | {
      readonly label: string;
      readonly value: string;
      readonly tags?: never;
    }
  | {
      readonly label: string;
      readonly tags: readonly string[];
      readonly value?: never;
    };

export interface CanonicalSubjectManifest {
  readonly schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  readonly id: CanonicalSubjectId;
  readonly slug: string;
  readonly title: string;
  readonly seoDescription: string;
  readonly summary: string;
  readonly classification: {
    readonly inputMotion: string;
    readonly outputMotion: string;
    readonly functionalSignature: string;
    readonly components: readonly string[];
  };
  readonly simulation?: {
    readonly status: 'planned' | 'interactive';
    readonly modelId: string;
    readonly adapter: string;
  };
  readonly facts: readonly SubjectFact[];
}

export interface CollectionManifest {
  readonly schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  readonly id: CollectionId;
  readonly sequence?: number;
  readonly shortTitle: string;
  readonly title: string;
  readonly author?: string;
  readonly rights: {
    readonly status: 'public-domain' | 'copyrighted' | 'unknown';
    readonly note?: string;
  };
}

export interface CollectionOccurrenceManifest {
  readonly schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  readonly id: CollectionOccurrenceId;
  readonly collection: CollectionId;
  readonly ordinal: number;
  readonly displayNumber: string;
  readonly status: CatalogOccurrenceStatus;
  readonly classification?: OccurrenceClassification;
  readonly canonicalSubject?: CanonicalSubjectId;
  readonly simulation?: {
    readonly modelId: string;
  };
  readonly source: {
    readonly referenceUrl?: string;
    readonly referenceLabel?: string;
    readonly excerpt?: string;
  };
  readonly editorial?: {
    readonly heading: string;
  };
}

export interface CatalogManifestSet {
  readonly collections: readonly CollectionManifest[];
  readonly subjects: readonly CanonicalSubjectManifest[];
  readonly occurrences: readonly CollectionOccurrenceManifest[];
}

export interface CatalogIndex {
  readonly collections: ReadonlyMap<CollectionId, CollectionManifest>;
  readonly subjects: ReadonlyMap<CanonicalSubjectId, CanonicalSubjectManifest>;
  readonly occurrences: ReadonlyMap<CollectionOccurrenceId, CollectionOccurrenceManifest>;
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

function indexById<T extends { readonly id: string }>(kind: string, manifests: readonly T[]): ReadonlyMap<string, T> {
  const index = new Map<string, T>();

  for (const manifest of manifests) {
    if (index.has(manifest.id)) {
      throw new Error(`Duplicate ${kind} id: ${manifest.id}`);
    }
    index.set(manifest.id, manifest);
  }

  return index;
}

function hasClassificationMetadata(classification: OccurrenceClassification | undefined): boolean {
  if (!classification) return false;

  return Boolean(
    classification.inputMotion?.trim() ||
      classification.outputMotion?.trim() ||
      classification.components?.some((component) => component.trim().length > 0) ||
      classification.tags?.some((tag) => tag.trim().length > 0),
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;

  for (const nested of Object.values(value as unknown as Record<string, unknown>)) {
    deepFreeze(nested);
  }

  return Object.freeze(value) as T;
}

export function createCatalog(manifests: CatalogManifestSet): CatalogIndex {
  const collections = indexById('collection', manifests.collections);
  const subjects = indexById('canonical subject', manifests.subjects);
  const occurrences = indexById('collection occurrence', manifests.occurrences);

  const collectionSequences = new Set<number>();
  for (const collection of manifests.collections) {
    if (collection.sequence === undefined) continue;
    if (collectionSequences.has(collection.sequence)) {
      throw new Error(`Duplicate collection sequence: ${collection.sequence}`);
    }
    collectionSequences.add(collection.sequence);
  }

  const slugs = new Set<string>();
  for (const subject of manifests.subjects) {
    if (slugs.has(subject.slug)) {
      throw new Error(`Duplicate canonical subject slug: ${subject.slug}`);
    }
    slugs.add(subject.slug);
  }

  const collectionOrdinals = new Set<string>();
  for (const occurrence of manifests.occurrences) {
    if (!collections.has(occurrence.collection)) {
      throw new Error(
        `Collection occurrence ${occurrence.id} references unknown collection ${occurrence.collection}`,
      );
    }

    const ordinalKey = `${occurrence.collection}\u0000${occurrence.ordinal}`;
    if (collectionOrdinals.has(ordinalKey)) {
      throw new Error(
        `Duplicate ordinal ${occurrence.ordinal} in collection ${occurrence.collection}`,
      );
    }
    collectionOrdinals.add(ordinalKey);

    if (occurrence.status === 'classified' && !hasClassificationMetadata(occurrence.classification)) {
      throw new Error(
        `Classified occurrence ${occurrence.id} must include nonempty classification metadata`,
      );
    }

    const requiresCanonicalSubject = occurrence.status === 'mapped' || occurrence.status === 'interactive';
    if (!requiresCanonicalSubject) {
      if (occurrence.canonicalSubject) {
        throw new Error(
          `Occurrence ${occurrence.id} with status ${occurrence.status} must not claim a canonical subject mapping`,
        );
      }
      if (occurrence.simulation) {
        throw new Error(
          `Occurrence ${occurrence.id} with status ${occurrence.status} must not claim a simulation binding`,
        );
      }
      continue;
    }

    if (!occurrence.canonicalSubject) {
      throw new Error(`${occurrence.status} occurrence ${occurrence.id} must reference a canonical subject`);
    }

    const subject = subjects.get(occurrence.canonicalSubject);
    if (!subject) {
      throw new Error(
        `Collection occurrence ${occurrence.id} references unknown canonical subject ${occurrence.canonicalSubject}`,
      );
    }

    if (occurrence.status === 'mapped') {
      if (occurrence.simulation) {
        throw new Error(`Mapped occurrence ${occurrence.id} must not claim a simulation binding`);
      }
      continue;
    }

    if (subject.simulation?.status !== 'interactive') {
      throw new Error(
        `Interactive occurrence ${occurrence.id} requires an interactive canonical simulation`,
      );
    }
    if (occurrence.simulation?.modelId !== subject.simulation.modelId) {
      throw new Error(
        `Interactive occurrence ${occurrence.id} must reference canonical simulation ${subject.simulation.modelId}`,
      );
    }
  }

  for (const manifest of manifests.collections) deepFreeze(manifest);
  for (const manifest of manifests.subjects) deepFreeze(manifest);
  for (const manifest of manifests.occurrences) deepFreeze(manifest);

  return Object.freeze({ collections, subjects, occurrences });
}
