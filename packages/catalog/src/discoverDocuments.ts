/// <reference types="node" />

import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CatalogAuthoringError,
  compileCatalogDocuments,
  type CatalogCompileOptions,
  type CatalogDocumentSource,
  type CompiledCatalogDocuments,
} from './authoring.js';

const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_DIRECTORY_DEPTH = 16;

/**
 * Node/build-only discovery. No generated index is stored, so additions and
 * removals are visible on every invocation. Keep this out of browser imports.
 * The root must exist; an absent directory is not an empty successful catalog.
 */
export async function readCatalogDocuments(root: string | URL): Promise<readonly CatalogDocumentSource[]> {
  const directory = resolve(root instanceof URL ? fileURLToPath(root) : root);
  const rootStat = await lstat(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new CatalogAuthoringError(directory, '', 'Catalog root must be a real directory');
  }
  const sources: CatalogDocumentSource[] = [];

  async function visit(absolute: string, relative: string, depth: number): Promise<void> {
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw new CatalogAuthoringError(relative, '', 'Catalog directory nesting exceeds 16 levels');
    }
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const filename = join(absolute, entry.name);
      if (entry.isSymbolicLink()) {
        throw new CatalogAuthoringError(path, '', 'Symbolic links are not allowed in catalog directories');
      }
      if (entry.isDirectory()) {
        await visit(filename, path, depth + 1);
      } else if (entry.name.endsWith('.json')) {
        if (!entry.isFile()) throw new CatalogAuthoringError(path, '', 'JSON document must be a regular file');
        const stat = await lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new CatalogAuthoringError(path, '', 'JSON document must be a regular file');
        }
        if (stat.size > MAX_DOCUMENT_BYTES) {
          throw new CatalogAuthoringError(path, '', 'JSON document exceeds 1 MiB');
        }
        const bytes = await readFile(filename);
        if (bytes.length > MAX_DOCUMENT_BYTES) {
          throw new CatalogAuthoringError(path, '', 'JSON document exceeds 1 MiB');
        }
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          throw new CatalogAuthoringError(path, '', 'JSON document must be valid UTF-8');
        }
        sources.push(Object.freeze({ path, text }));
      }
    }
  }

  await visit(directory, '', 0);
  sources.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return Object.freeze(sources);
}

/** Pure normalized records can be serialized for an Astro/browser build. */
export async function discoverCatalogDocuments(
  root: string | URL,
  options: CatalogCompileOptions = {},
): Promise<CompiledCatalogDocuments> {
  return compileCatalogDocuments(await readCatalogDocuments(root), options);
}
