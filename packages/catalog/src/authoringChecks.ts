import { CatalogAuthoringError } from './authoringError.js';

/** Internal JSON-boundary helpers shared by catalog, preset and editorial decoding. */
export type Check = (value: unknown, source: string, pointer: string) => void;
export type Shape = Readonly<Record<string, Check>>;

export function fail(source: string, pointer: string, message: string): never {
  throw new CatalogAuthoringError(source, pointer, message);
}

export function child(pointer: string, key: string | number): string {
  return `${pointer}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

export function record(value: unknown, source: string, pointer: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(source, pointer, 'Expected an object');
  return value as Record<string, unknown>;
}

export const text: Check = (value, source, pointer) => {
  if (typeof value !== 'string' || value.trim().length === 0) fail(source, pointer, 'Expected a nonempty string');
};

function matching(pattern: RegExp, description: string): Check {
  return (value, source, pointer) => {
    text(value, source, pointer);
    if (!pattern.test(value as string)) fail(source, pointer, description);
  };
}

export const id = matching(/^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/, 'Expected a stable lowercase identifier');
export const slug = matching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a lowercase URL slug');
export const positiveInteger: Check = (value, source, pointer) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail(source, pointer, 'Expected a positive safe integer');
};

export function enumeration(...values: readonly string[]): Check {
  return (value, source, pointer) => {
    if (typeof value !== 'string' || !values.includes(value)) fail(source, pointer, `Expected one of: ${values.join(', ')}`);
  };
}

export function array(check: Check): Check {
  return (value, source, pointer) => {
    if (!Array.isArray(value)) fail(source, pointer, 'Expected an array');
    value.forEach((item, index) => check(item, source, child(pointer, index)));
  };
}

export function object(required: Shape, optional: Shape = {}): Check {
  const checks = new Map([...Object.entries(required), ...Object.entries(optional)]);
  return (value, source, pointer) => {
    const fields = record(value, source, pointer);
    for (const key of Object.keys(required)) {
      if (!Object.hasOwn(fields, key)) fail(source, child(pointer, key), 'Required field is missing');
    }
    for (const key of Object.keys(fields).sort()) {
      const check = checks.get(key);
      if (check === undefined) fail(source, child(pointer, key), 'Unknown field');
      check(fields[key], source, child(pointer, key));
    }
  };
}

export const referenceUrl: Check = (value, source, pointer) => {
  text(value, source, pointer);
  const raw = value as string;
  let url: URL;
  try { url = new URL(raw); } catch { fail(source, pointer, 'Expected an absolute HTTP(S) source URL'); }
  if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f\\]/.test(raw)
    || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') {
    fail(source, pointer, 'Expected an absolute HTTP(S) source URL without credentials or whitespace');
  }
};

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

export interface Located<T> {
  readonly value: T;
  readonly source: string;
  readonly pointer: string;
}

export function at<T>(located: Located<T>, field: string, message: string): never {
  return fail(located.source, child(located.pointer, field), message);
}

export function unique<T>(items: readonly Located<T>[], field: string, key: (value: T) => string | undefined): void {
  const seen = new Map<string, Located<T>>();
  for (const item of items) {
    const value = key(item.value);
    if (value === undefined) continue;
    const previous = seen.get(value);
    if (previous !== undefined) at(item, field, `Duplicate ${field} ${value}; first declared in ${previous.source}#${previous.pointer}`);
    seen.set(value, item);
  }
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
