import { CATALOG_SCHEMA_VERSION, defineCollection } from '../../schema.js';

export const brown507Collection = defineCollection({
  schemaVersion: CATALOG_SCHEMA_VERSION,
  id: 'brown-507',
  sequence: 1,
  shortTitle: 'Brown',
  title: '507 Mechanical Movements',
  author: 'Henry T. Brown',
  rights: {
    status: 'public-domain',
    note: 'Historical source material; retain source-specific provenance when importing occurrences.',
  },
});
