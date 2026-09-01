import { createCatalog } from './schema.js';
import { brown507Collection } from './manifests/collections/brown507.js';
import { brown001 } from './manifests/occurrences/brown/001.js';
import { brown002 } from './manifests/occurrences/brown/002.js';
import { brown003 } from './manifests/occurrences/brown/003.js';
import { crossedBeltDrive } from './manifests/subjects/crossedBeltDrive.js';
import { openBeltDrive } from './manifests/subjects/openBeltDrive.js';
import { quarterTurnBeltDrive } from './manifests/subjects/quarterTurnBeltDrive.js';

export const collections = Object.freeze([brown507Collection] as const);
export const subjects = Object.freeze([
  openBeltDrive,
  crossedBeltDrive,
  quarterTurnBeltDrive,
] as const);
export const occurrences = Object.freeze([brown001, brown002, brown003] as const);

export const catalog = createCatalog({ collections, subjects, occurrences });
