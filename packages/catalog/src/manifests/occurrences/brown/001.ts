import { CATALOG_SCHEMA_VERSION, defineCollectionOccurrence } from '../../../schema.js';

export const brown001 = defineCollectionOccurrence({
  schemaVersion: CATALOG_SCHEMA_VERSION,
  id: 'brown:001',
  collection: 'brown-507',
  ordinal: 1,
  displayNumber: '001',
  canonicalSubject: 'open-belt-drive',
  implementation: {
    status: 'interactive',
    simulationModelId: 'foundation:belt-drive:open',
  },
  source: {
    referenceUrl: 'https://507movements.com/mm_001.html',
    referenceLabel: 'View the current 507movements.com reference ↗',
    excerpt:
      'Illustrates the transmission of power by simple pulleys and an open belt. In this case both of the pulleys rotate in the same direction.',
  },
  editorial: {
    heading: 'Brown begins with the basic idea.',
  },
});
