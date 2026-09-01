import type { MechanismLabDefinition } from './schema.js';
import {
  beltLabDefinitions,
  crossedBeltDriveLab,
  openBeltDriveLab,
} from './definitions/belt.js';
import {
  canonicalFourBarLab,
  fourBarLabDefinitions,
} from './definitions/fourBar.js';

export {
  openBeltDriveLab,
  crossedBeltDriveLab,
  canonicalFourBarLab,
};

export const mechanismLabDefinitions: readonly MechanismLabDefinition[] = Object.freeze([
  ...beltLabDefinitions,
  ...fourBarLabDefinitions,
]);
