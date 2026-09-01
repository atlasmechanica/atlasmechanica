import { CATALOG_SCHEMA_VERSION, defineCollectionOccurrence } from '../../../schema.js';

export const brown002 = defineCollectionOccurrence({
  schemaVersion: CATALOG_SCHEMA_VERSION,
  id: 'brown:002',
  collection: 'brown-507',
  ordinal: 2,
  displayNumber: '002',
  status: 'interactive',
  canonicalSubject: 'crossed-belt-drive',
  simulation: {
    modelId: 'foundation:belt-drive:crossed',
  },
  source: {
    referenceUrl: 'https://507movements.com/mm_002.html',
    referenceLabel: 'View the current 507movements.com reference ↗',
    excerpt: 'Differs from 1 in the substitution of a crossed belt for the open one.',
  },
  editorial: {
    heading: 'Brown turns reversal into a control system.',
  },
});
