import {
  array, at, child, compare, enumeration, fail, freeze, id, object, record,
  referenceUrl, slug, text, unique, type Check, type Located,
} from './authoringChecks.js';

/** Rights are authored metadata, not a license verification result. */
export interface CatalogContentRights {
  readonly status: 'public-domain' | 'copyrighted' | 'unknown';
  readonly attribution: string;
  readonly note?: string;
}

export interface CatalogSourceReference {
  readonly id: string;
  readonly title: string;
  /** Page, figure, movement, or other locator within the cited work. */
  readonly locator: string;
  readonly rights: CatalogContentRights;
  readonly author?: string;
  readonly edition?: string;
  /** A link is optional so offline/print-only sources remain representable. */
  readonly url?: string;
}

export interface CatalogAsset {
  readonly id: string;
  /** Root-relative raster image under /assets/catalog/, never a module or URL. */
  readonly path: string;
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Asset rights are separate from the source's rights; never inferred. */
  readonly rights: CatalogContentRights;
  readonly provenance:
    | { readonly kind: 'source-reproduction'; readonly reference: string }
    | { readonly kind: 'atlas-illustration'; readonly note: string; readonly reference?: string };
}

/** Nonrecursive inline vocabulary. Text is always text, never HTML/Markdown. */
export type CatalogInline =
  | { readonly type: 'text' | 'emphasis' | 'strong' | 'code'; readonly text: string }
  | { readonly type: 'reference-link'; readonly reference: string; readonly text: string }
  | { readonly type: 'subject-link'; readonly subject: string; readonly text: string };

export type CatalogEditorialBlock =
  | { readonly type: 'paragraph'; readonly content: readonly CatalogInline[] }
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'list'; readonly items: readonly (readonly CatalogInline[])[]; readonly style?: 'ordered' | 'unordered' }
  | { readonly type: 'formula'; readonly expression: string; readonly caption: readonly CatalogInline[] }
  | { readonly type: 'quote'; readonly reference: string; readonly text: string }
  | { readonly type: 'note'; readonly kind: 'assumption' | 'limitation' | 'reference-geometry'; readonly content: readonly CatalogInline[] }
  | { readonly type: 'image'; readonly asset: string; readonly alt: string; readonly caption?: readonly CatalogInline[] }
  | { readonly type: 'related'; readonly subject: string; readonly label: string; readonly description?: string };

export interface CatalogEditorialSection {
  readonly id: string;
  readonly title: string;
  readonly eyebrow?: string;
  readonly blocks: readonly CatalogEditorialBlock[];
}

export interface CatalogSubjectContent {
  readonly subject: string;
  readonly sections: readonly CatalogEditorialSection[];
}

export interface CompiledCatalogContent {
  readonly referenceSources: readonly CatalogSourceReference[];
  readonly assets: readonly CatalogAsset[];
  readonly subjectContent: readonly CatalogSubjectContent[];
}

const rights = object({
  status: enumeration('public-domain', 'copyrighted', 'unknown'), attribution: text,
}, { note: text });
export const sourceReferenceCheck = object({ id, title: text, locator: text, rights }, {
  author: text, edition: text, url: referenceUrl,
});

function nonemptyArray(check: Check): Check {
  return (value, source, pointer) => {
    array(check)(value, source, pointer);
    if ((value as unknown[]).length === 0) fail(source, pointer, 'Expected a nonempty array');
  };
}

function tagged(checks: ReadonlyMap<string, Check>, field = 'type'): Check {
  return (value, source, pointer) => {
    const tag = record(value, source, pointer)[field];
    const check = typeof tag === 'string' ? checks.get(tag) : undefined;
    if (check === undefined) fail(source, child(pointer, field), `Unknown ${field}; expected ${[...checks.keys()].join(', ')}`);
    check(value, source, pointer);
  };
}

const provenanceCheck = tagged(new Map([
  ['source-reproduction', object({ kind: enumeration('source-reproduction'), reference: id })],
  ['atlas-illustration', object({ kind: enumeration('atlas-illustration'), note: text }, { reference: id })],
]), 'kind');

export const assetCheck: Check = (value, source, pointer) => {
  object({
    id, path: text, mediaType: enumeration('image/png', 'image/jpeg', 'image/webp'),
    rights, provenance: provenanceCheck,
  })(value, source, pointer);
  const asset = value as CatalogAsset;
  const suffixes = new Map<string, readonly string[]>([
    ['image/png', ['.png']], ['image/jpeg', ['.jpg', '.jpeg']], ['image/webp', ['.webp']],
  ]);
  // Deliberately excludes percent-encoding, traversal, dotfiles, queries,
  // fragments, backslashes, remote hosts and executable/vector formats.
  if (!/^\/assets\/catalog\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(asset.path)) {
    fail(source, child(pointer, 'path'), 'Expected a safe root-relative /assets/catalog/ image path');
  }
  if (!suffixes.get(asset.mediaType)?.some((suffix) => asset.path.endsWith(suffix))) {
    fail(source, child(pointer, 'path'), 'Image extension must match its declared raster mediaType');
  }
};

const inlineCheck = tagged(new Map<string, Check>([
  ...(['text', 'emphasis', 'strong', 'code'] as const).map((type): [string, Check] => [type, object({ type: enumeration(type), text })]),
  ['reference-link', object({ type: enumeration('reference-link'), reference: id, text })],
  ['subject-link', object({ type: enumeration('subject-link'), subject: id, text })],
]));
const inlines = nonemptyArray(inlineCheck);
const blockCheck = tagged(new Map<string, Check>([
  ['paragraph', object({ type: enumeration('paragraph'), content: inlines })],
  ['heading', object({ type: enumeration('heading'), text })],
  ['list', object({ type: enumeration('list'), items: nonemptyArray(inlines) }, { style: enumeration('ordered', 'unordered') })],
  ['formula', object({ type: enumeration('formula'), expression: text, caption: inlines })],
  ['quote', object({ type: enumeration('quote'), reference: id, text })],
  ['note', object({ type: enumeration('note'), kind: enumeration('assumption', 'limitation', 'reference-geometry'), content: inlines })],
  ['image', object({ type: enumeration('image'), asset: id, alt: text }, { caption: inlines })],
  ['related', object({ type: enumeration('related'), subject: id, label: text }, { description: text })],
]));
export const subjectContentCheck = object({
  subject: id,
  sections: nonemptyArray(object({ id: slug, title: text, blocks: nonemptyArray(blockCheck) }, { eyebrow: text })),
});

/** Cross-file resolution only. No fetching, asset copying, HTML or physics evaluation. */
export function compileCatalogContent(
  references: readonly Located<CatalogSourceReference>[],
  assets: readonly Located<CatalogAsset>[],
  content: readonly Located<CatalogSubjectContent>[],
  subjectIds: ReadonlySet<string>,
): CompiledCatalogContent {
  unique(references, 'id', (value) => value.id);
  unique(assets, 'id', (value) => value.id);
  unique(assets, 'path', (value) => value.path);
  unique(content, 'subject', (value) => value.subject);
  const referenceById = new Map(references.map(({ value }) => [value.id, value]));
  const assetIds = new Set(assets.map(({ value }) => value.id));

  function reference(key: string, source: string, pointer: string, needsUrl = false): void {
    const value = referenceById.get(key);
    if (value === undefined) fail(source, pointer, `Unknown source reference ${key}`);
    if (needsUrl && value.url === undefined) fail(source, pointer, `Source reference ${key} has no link URL`);
  }
  function subject(key: string, source: string, pointer: string): void {
    if (!subjectIds.has(key)) fail(source, pointer, `Unknown canonical subject ${key}`);
  }
  function checkInlines(values: readonly CatalogInline[], source: string, pointer: string): void {
    values.forEach((value, index) => {
      const location = child(pointer, index);
      if (value.type === 'reference-link') reference(value.reference, source, child(location, 'reference'), true);
      if (value.type === 'subject-link') subject(value.subject, source, child(location, 'subject'));
    });
  }
  for (const item of assets) {
    const provenance = item.value.provenance;
    if (provenance.reference !== undefined) reference(provenance.reference, item.source, child(child(item.pointer, 'provenance'), 'reference'));
  }
  for (const item of content) {
    if (!subjectIds.has(item.value.subject)) at(item, 'subject', `Unknown canonical subject ${item.value.subject}`);
    const sections = item.value.sections.map((value, index) => ({ value, source: item.source, pointer: child(child(item.pointer, 'sections'), index) }));
    unique(sections, 'id', (value) => value.id);
    for (const section of sections) {
      section.value.blocks.forEach((block, index) => {
        const pointer = child(child(section.pointer, 'blocks'), index);
        switch (block.type) {
          case 'paragraph': case 'note':
            checkInlines(block.content, item.source, child(pointer, 'content'));
            break;
          case 'list':
            block.items.forEach((values, i) => checkInlines(values, item.source, child(child(pointer, 'items'), i)));
            break;
          case 'formula':
            checkInlines(block.caption, item.source, child(pointer, 'caption'));
            break;
          case 'quote':
            reference(block.reference, item.source, child(pointer, 'reference'));
            break;
          case 'image':
            if (!assetIds.has(block.asset)) fail(item.source, child(pointer, 'asset'), `Unknown image asset ${block.asset}`);
            if (block.caption !== undefined) checkInlines(block.caption, item.source, child(pointer, 'caption'));
            break;
          case 'related':
            subject(block.subject, item.source, child(pointer, 'subject'));
            break;
          case 'heading': break;
        }
      });
    }
  }
  const ordered = <T extends { readonly id: string }>(items: readonly Located<T>[]): readonly T[] =>
    items.map(({ value }) => value).sort((a, b) => compare(a.id, b.id));
  return freeze({
    referenceSources: ordered(references), assets: ordered(assets),
    subjectContent: content.map(({ value }) => value).sort((a, b) => compare(a.subject, b.subject)),
  });
}
