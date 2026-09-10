import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { discoverCatalogDocuments, readCatalogDocuments } from './discoverDocuments.js';

const temporaryRoots: string[] = [];
const fixtures = new URL('../fixtures/authoring/', import.meta.url);

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-catalog-authoring-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('build-time catalog document discovery', () => {
  it('discovers a new occurrence-only file and removes it without any generated registry', async () => {
    const root = await temp();
    await cp(fixtures, root, { recursive: true });
    const original = await discoverCatalogDocuments(root);
    await mkdir(join(root, 'test'));
    const addedFile = join(root, 'test', 'reuse.json');
    await writeFile(addedFile, JSON.stringify({
      format: 'atlas.catalog-document', schemaVersion: '0.1',
      collections: [{
        schemaVersion: '0.1', id: 'test', shortTitle: 'Test', title: 'Synthetic test collection',
        rights: { status: 'unknown', note: 'Test-only fixture; not a historical attribution.' },
      }],
      occurrences: [{
        schemaVersion: '0.1', id: 'test:reuse', collection: 'test', ordinal: 1,
        displayNumber: 'test', status: 'interactive', canonicalSubject: 'open-belt-drive',
        simulation: { modelId: 'foundation:belt-drive:open' }, source: {},
      }],
    }));
    const added = await discoverCatalogDocuments(root);
    expect(added.catalog.occurrences.size).toBe(original.catalog.occurrences.size + 1);
    expect(added.catalog.subjects.size).toBe(original.catalog.subjects.size);
    expect(added.catalog.occurrences.get('test:reuse')?.canonicalSubject).toBe('open-belt-drive');
    await rm(addedFile);
    expect((await discoverCatalogDocuments(root)).manifests).toEqual(original.manifests);
  });

  it('does not execute or discover TypeScript files', async () => {
    const root = await temp();
    await writeFile(join(root, 'not-a-manifest.ts'), 'throw new Error("never execute this");');
    await writeFile(join(root, 'README.md'), 'Authoring notes');
    expect(await readCatalogDocuments(pathToFileURL(root))).toEqual([]);
  });

  it('sorts relative paths deterministically including nested files', async () => {
    const root = await temp();
    await mkdir(join(root, 'z'));
    await mkdir(join(root, 'a'));
    await writeFile(join(root, 'z', 'first.json'), '{}');
    await writeFile(join(root, 'a', 'second.json'), '{}');
    await writeFile(join(root, 'b.json'), '{}');
    const sources = await readCatalogDocuments(root);
    expect(sources.map((source) => source.path)).toEqual(['a/second.json', 'b.json', 'z/first.json']);
    expect(Object.isFrozen(sources)).toBe(true);
    expect(Object.isFrozen(sources[0])).toBe(true);
  });

  it('reports the relative filename for malformed discovered content', async () => {
    const root = await temp();
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'bad.json'), '{');
    await expect(discoverCatalogDocuments(root)).rejects.toThrow('nested/bad.json: Invalid JSON');
  });

  it('does not treat a missing root as an empty successful catalog', async () => {
    const root = await temp();
    await expect(readCatalogDocuments(join(root, 'missing'))).rejects.toThrow();
  });

  it('rejects a file used as a directory root', async () => {
    const root = await temp();
    const file = join(root, 'file.json');
    await writeFile(file, '{}');
    await expect(readCatalogDocuments(file)).rejects.toThrow('Catalog root must be a real directory');
  });

  it('rejects symbolic-link roots', async () => {
    const root = await temp();
    const alias = join(root, 'alias');
    await symlink(root, alias, 'dir');
    await expect(readCatalogDocuments(alias)).rejects.toThrow('Catalog root must be a real directory');
  });

  it('rejects directory symlinks rather than following a loop or escaping the tree', async () => {
    const root = await temp();
    await symlink(root, join(root, 'loop'), 'dir');
    await expect(readCatalogDocuments(root)).rejects.toThrow('loop: Symbolic links are not allowed');
  });

  it('rejects file symlinks', async () => {
    const root = await temp();
    await writeFile(join(root, 'target.txt'), '{}');
    await symlink(join(root, 'target.txt'), join(root, 'alias.json'));
    await expect(readCatalogDocuments(root)).rejects.toThrow('alias.json: Symbolic links are not allowed');
  });

  it('rejects oversized documents and malformed UTF-8 before parsing', async () => {
    const root = await temp();
    const path = join(root, 'bad.json');
    await writeFile(path, ' '.repeat(1024 * 1024 + 1));
    await expect(readCatalogDocuments(root)).rejects.toThrow('bad.json: JSON document exceeds 1 MiB');
    await writeFile(path, new Uint8Array([0xff, 0xfe, 0xfd]));
    await expect(readCatalogDocuments(root)).rejects.toThrow('bad.json: JSON document must be valid UTF-8');
  });

  it('bounds directory nesting', async () => {
    const root = await temp();
    await mkdir(join(root, ...Array.from({ length: 17 }, () => 'nested')), { recursive: true });
    await expect(readCatalogDocuments(root)).rejects.toThrow('Catalog directory nesting exceeds 16 levels');
  });
});
