import { describe, expect, it } from 'vitest';

import { catalog, occurrences, subjects } from './catalog.js';
import { createCatalog } from './schema.js';
import { brown507Collection } from './manifests/collections/brown507.js';

const [openBeltDrive, crossedBeltDrive] = subjects;
const [brown001, brown002] = occurrences;

describe('catalog manifests', () => {
  it('keeps Brown occurrences separate from canonical subjects', () => {
    expect(brown001.id).toBe('brown:001');
    expect(brown001.canonicalSubject).toBe(openBeltDrive.id);
    expect(brown002.id).toBe('brown:002');
    expect(brown002.canonicalSubject).toBe(crossedBeltDrive.id);
  });

  it('indexes the current catalog with valid cross references', () => {
    expect(catalog.collections.get('brown-507')).toBe(brown507Collection);
    expect(catalog.subjects.get('open-belt-drive')).toBe(openBeltDrive);
    expect(catalog.occurrences.get('brown:002')).toBe(brown002);
  });

  it('rejects unsupported schema versions across manifest kinds', () => {
    const unsupportedVersion = '999' as unknown as typeof brown001.schemaVersion;

    expect(() =>
      createCatalog({
        collections: [{ ...brown507Collection, schemaVersion: unsupportedVersion }],
        subjects: [],
        occurrences: [],
      }),
    ).toThrow('unsupported schema version 999');

    expect(() =>
      createCatalog({
        collections: [],
        subjects: [{ ...openBeltDrive, schemaVersion: unsupportedVersion }],
        occurrences: [],
      }),
    ).toThrow('unsupported schema version 999');

    expect(() =>
      createCatalog({
        collections: [brown507Collection],
        subjects: [openBeltDrive],
        occurrences: [{ ...brown001, schemaVersion: unsupportedVersion }],
      }),
    ).toThrow('unsupported schema version 999');
  });

  it('uses the registered analytic belt adapter id', () => {
    expect(openBeltDrive.simulation.adapter).toBe('atlas.analytic-belt.v0');
    expect(crossedBeltDrive.simulation.adapter).toBe('atlas.analytic-belt.v0');
  });

  it('freezes validated manifest values and their nested data', () => {
    const occurrence = catalog.occurrences.get('brown:001');
    expect(occurrence).toBeDefined();
    expect(Object.isFrozen(occurrence)).toBe(true);
    expect(Object.isFrozen(occurrence?.source)).toBe(true);
    expect(Object.isFrozen(catalog.subjects.get('open-belt-drive'))).toBe(true);
  });

  it('prevents runtime mutation of catalog index maps', () => {
    const mutableOccurrences = catalog.occurrences as unknown as Map<string, typeof brown001>;

    expect(Object.isFrozen(catalog.occurrences)).toBe(true);
    expect(() => mutableOccurrences.set('brown:mutated', brown001)).toThrow(TypeError);
    expect(() => mutableOccurrences.delete('brown:001')).toThrow(TypeError);
    expect(() => mutableOccurrences.clear()).toThrow(TypeError);
    expect(catalog.occurrences.has('brown:001')).toBe(true);
    expect(catalog.occurrences.has('brown:mutated')).toBe(false);
  });

  it('allows source occurrences to be cataloged before canonical mapping', () => {
    const sourceOnly = {
      schemaVersion: brown001.schemaVersion,
      id: 'brown:003',
      collection: 'brown-507',
      ordinal: 3,
      displayNumber: '003',
      status: 'cataloged' as const,
      source: {},
    };

    const sourceOnlyCatalog = createCatalog({
      collections: [brown507Collection],
      subjects: [],
      occurrences: [sourceOnly],
    });

    expect(sourceOnlyCatalog.occurrences.get('brown:003')).toBe(sourceOnly);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5])(
    'rejects invalid occurrence ordinal %s',
    (ordinal) => {
      expect(() =>
        createCatalog({
          collections: [brown507Collection],
          subjects: [],
          occurrences: [
            {
              schemaVersion: brown001.schemaVersion,
              id: 'brown:invalid-ordinal',
              collection: 'brown-507',
              ordinal,
              displayNumber: String(ordinal),
              status: 'cataloged',
              source: {},
            },
          ],
        }),
      ).toThrow('ordinal must be a finite integer');
    },
  );

  it('rejects empty classification metadata at the classified stage', () => {
    expect(() =>
      createCatalog({
        collections: [brown507Collection],
        subjects: [],
        occurrences: [
          {
            schemaVersion: brown001.schemaVersion,
            id: 'brown:classified-empty',
            collection: 'brown-507',
            ordinal: 997,
            displayNumber: '997',
            status: 'classified',
            classification: {},
            source: {},
          },
        ],
      }),
    ).toThrow('must include nonempty classification metadata');
  });

  it('requires mapped occurrences to name a canonical subject', () => {
    expect(() =>
      createCatalog({
        collections: [brown507Collection],
        subjects: [openBeltDrive],
        occurrences: [
          {
            schemaVersion: brown001.schemaVersion,
            id: 'brown:test',
            collection: 'brown-507',
            ordinal: 999,
            displayNumber: '999',
            status: 'mapped',
            source: {},
          },
        ],
      }),
    ).toThrow('must reference a canonical subject');
  });

  it('rejects simulation bindings before the interactive stage', () => {
    expect(() =>
      createCatalog({
        collections: [brown507Collection],
        subjects: [openBeltDrive],
        occurrences: [
          {
            ...brown001,
            id: 'brown:mapped-with-simulation',
            ordinal: 998,
            status: 'mapped',
            simulation: {
              modelId: openBeltDrive.simulation.modelId,
            },
          },
        ],
      }),
    ).toThrow('must not claim a simulation binding');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5])(
    'rejects invalid collection sequence %s',
    (sequence) => {
      expect(() =>
        createCatalog({
          collections: [
            {
              ...brown507Collection,
              id: 'brown-invalid-sequence',
              sequence,
            },
          ],
          subjects: [],
          occurrences: [],
        }),
      ).toThrow('sequence must be a finite integer');
    },
  );

  it('rejects duplicate collection sequence numbers', () => {
    expect(() =>
      createCatalog({
        collections: [
          brown507Collection,
          {
            ...brown507Collection,
            id: 'brown-507-copy',
            shortTitle: 'Brown copy',
          },
        ],
        subjects: [],
        occurrences: [],
      }),
    ).toThrow(`Duplicate collection sequence: ${brown507Collection.sequence}`);
  });

  it('rejects duplicate ordinals within one collection', () => {
    expect(() =>
      createCatalog({
        collections: [brown507Collection],
        subjects: [openBeltDrive, crossedBeltDrive],
        occurrences: [
          brown001,
          {
            ...brown002,
            id: 'brown:duplicate-ordinal',
            ordinal: brown001.ordinal,
          },
        ],
      }),
    ).toThrow('Duplicate ordinal 1 in collection brown-507');
  });

  it('rejects occurrences that point at unknown canonical subjects', () => {
    expect(() =>
      createCatalog({
        collections: [brown507Collection],
        subjects: [openBeltDrive],
        occurrences: [
          {
            ...brown001,
            id: 'brown:test',
            canonicalSubject: 'does-not-exist',
          },
        ],
      }),
    ).toThrow('unknown canonical subject');
  });

  it('rejects interactive occurrences backed by planned simulations', () => {
    const plannedSubject = {
      ...openBeltDrive,
      id: 'planned-open-belt-drive',
      slug: 'planned-open-belt-drive',
      simulation: {
        ...openBeltDrive.simulation,
        status: 'planned' as const,
      },
    };

    expect(() =>
      createCatalog({
        collections: [brown507Collection],
        subjects: [plannedSubject],
        occurrences: [
          {
            ...brown001,
            id: 'brown:test',
            canonicalSubject: plannedSubject.id,
          },
        ],
      }),
    ).toThrow('requires an interactive canonical simulation');
  });

  it('rejects interactive occurrences wired to a different simulation model', () => {
    expect(() =>
      createCatalog({
        collections: [brown507Collection],
        subjects: [openBeltDrive],
        occurrences: [
          {
            ...brown001,
            id: 'brown:test',
            simulation: {
              modelId: 'foundation:belt-drive:crossed',
            },
          },
        ],
      }),
    ).toThrow('must reference canonical simulation');
  });
});
