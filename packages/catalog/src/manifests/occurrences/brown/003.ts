import { CATALOG_SCHEMA_VERSION, defineCollectionOccurrence } from '../../../schema.js';

export const brown003 = defineCollectionOccurrence({
  schemaVersion: CATALOG_SCHEMA_VERSION,
  id: 'brown:003',
  collection: 'brown-507',
  ordinal: 3,
  displayNumber: '003',
  status: 'mapped',
  canonicalSubject: 'quarter-turn-belt-drive',
  classification: {
    inputMotion: 'continuous-rotary',
    outputMotion: 'perpendicular-continuous-rotary',
    components: ['belt', 'pulley', 'guide pulley', 'shaft'],
    tags: ['quarter-turn', 'right-angle-shafts', 'guide-pulleys'],
  },
  source: {
    referenceUrl: 'https://507movements.com/mm_003.html',
    referenceLabel: 'View the current 507movements.com reference ↗',
    excerpt: 'A method of transmitting motion from a shaft at right angles to another, by means of guide-pulleys.',
  },
  editorial: {
    heading: 'Brown turns the belt through a right angle.',
  },
});
