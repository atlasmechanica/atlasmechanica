import type { ParameterDefinition } from './model.js';
import { toCanonicalQuantity, type CanonicalQuantityValue, type QuantityKind, type QuantityValue } from './units.js';

export class ParameterValueError extends TypeError {
  constructor(readonly pointer: string, readonly detail: string) {
    super(`${pointer}: ${detail}`);
    this.name = 'ParameterValueError';
  }
}

function at(pointer: string, key: string): string {
  return `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

/** Read own data fields without invoking accessors or trusting prototypes. */
function fields(value: unknown, pointer: string): Map<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ParameterValueError(pointer, 'Expected an object');
  }
  const result = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new ParameterValueError(pointer, 'Symbol keys are not allowed');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw new ParameterValueError(at(pointer, key), 'Accessor fields are not allowed');
    }
    result.set(key, descriptor.value as unknown);
  }
  return result;
}

/** Decode a quantity using the model's existing unit conversion authority. */
export function normalizeParameterQuantity(
  value: unknown,
  kind?: QuantityKind,
  pointer = '',
): CanonicalQuantityValue {
  const data = fields(value, pointer);
  for (const key of data.keys()) {
    if (key !== 'value' && key !== 'unit') throw new ParameterValueError(at(pointer, key), 'Unknown quantity field');
  }
  const numeric = data.get('value');
  const unit = data.get('unit');
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    throw new ParameterValueError(at(pointer, 'value'), 'Expected a finite number');
  }
  if (typeof unit !== 'string') throw new ParameterValueError(at(pointer, 'unit'), 'Expected a model unit code');
  let canonical: CanonicalQuantityValue;
  try {
    canonical = toCanonicalQuantity({ value: numeric, unit } as QuantityValue, kind);
  } catch {
    throw new ParameterValueError(at(pointer, 'unit'), `Unknown or incompatible unit ${unit}${kind === undefined ? '' : `; expected ${kind}`}`);
  }
  // Unknown prototype names in the legacy unit table must never produce an
  // accepted quantity, even when no expected kind was supplied by the caller.
  if (typeof canonical.unit !== 'string' || !Number.isFinite(canonical.value)) {
    throw new ParameterValueError(at(pointer, 'unit'), `Unknown or incompatible unit ${unit}`);
  }
  if (numeric !== 0 && canonical.value === 0) {
    throw new ParameterValueError(at(pointer, 'value'), 'Quantity underflows its canonical unit');
  }
  return Object.freeze(canonical);
}

export type ResolvedParameterValues = Readonly<Record<string, Readonly<CanonicalQuantityValue>>>;

/**
 * Defaults < each explicit layer, from left to right. Every layer is validated
 * before applying the next: an invalid earlier value cannot be masked. This
 * checks quantities and declared scalar domains, not coupled route feasibility.
 * Inherited overrides are ignored; all own keys (including non-enumerable ones)
 * are checked. No caller object or model default is mutated/frozen.
 */
export function resolveParameterValues(
  definitions: Readonly<Record<string, ParameterDefinition>>,
  ...layers: readonly unknown[]
): ResolvedParameterValues {
  const declared = fields(definitions, '/definitions');
  const values = new Map<string, CanonicalQuantityValue>();
  const domains = new Map<string, { kind: QuantityKind; min?: number; max?: number }>();
  for (const id of [...declared.keys()].sort()) {
    const definition = declared.get(id) as ParameterDefinition;
    const pointer = at('/definitions', id);
    if (definition === null || typeof definition !== 'object' || definition.id !== id) {
      throw new ParameterValueError(pointer, 'Parameter key and id must agree');
    }
    const initial = normalizeParameterQuantity(definition.default, definition.kind, `${pointer}/default`);
    const bounds = definition.domain === undefined ? new Map<string, unknown>() : fields(definition.domain, `${pointer}/domain`);
    for (const key of bounds.keys()) {
      if (key !== 'min' && key !== 'max') throw new ParameterValueError(at(`${pointer}/domain`, key), 'Unknown domain field');
    }
    const min = bounds.has('min') ? normalizeParameterQuantity(bounds.get('min'), definition.kind, `${pointer}/domain/min`).value : undefined;
    const max = bounds.has('max') ? normalizeParameterQuantity(bounds.get('max'), definition.kind, `${pointer}/domain/max`).value : undefined;
    if (min !== undefined && max !== undefined && min > max) {
      throw new ParameterValueError(`${pointer}/domain`, 'Minimum exceeds maximum');
    }
    if ((min !== undefined && initial.value < min) || (max !== undefined && initial.value > max)) {
      throw new ParameterValueError(`${pointer}/default`, 'Default is outside the declared domain');
    }
    domains.set(id, { kind: definition.kind, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) });
    values.set(id, initial);
  }
  layers.forEach((layer, index) => {
    const pointer = `/overrides/${index}`;
    const overrides = fields(layer, pointer);
    for (const id of [...overrides.keys()].sort()) {
      const domain = domains.get(id);
      if (domain === undefined) throw new ParameterValueError(at(pointer, id), `Unknown parameter ${id}`);
      const value = normalizeParameterQuantity(overrides.get(id), domain.kind, at(pointer, id));
      if ((domain.min !== undefined && value.value < domain.min) || (domain.max !== undefined && value.value > domain.max)) {
        throw new ParameterValueError(at(pointer, id), 'Value is outside the declared domain');
      }
      values.set(id, value);
    }
  });
  return Object.freeze(Object.fromEntries([...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}
