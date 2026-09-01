import { createCatalog } from './schema.js';
import { brown507Collection } from './manifests/collections/brown507.js';
import { brown001 } from './manifests/occurrences/brown/001.js';
import { brown002 } from './manifests/occurrences/brown/002.js';
import { crossedBeltDrive } from './manifests/subjects/crossedBeltDrive.js';
import { openBeltDrive } from './manifests/subjects/openBeltDrive.js';

export const collections = [brown507Collection] as const;
export const subjects = [openBeltDrive, crossedBeltDrive] as const;
export const occurrences = [brown001, brown002] as const;

export const catalog = createCatalog({ collections, subjects, occurrences });
