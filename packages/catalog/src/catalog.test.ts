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
            implementation: {
              status: 'interactive',
              simulationModelId: 'foundation:belt-drive:crossed',
            },
          },
        ],
      }),
    ).toThrow('must reference canonical simulation');
  });
});
