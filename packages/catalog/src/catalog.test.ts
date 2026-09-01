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
