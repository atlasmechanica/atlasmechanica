export type QuantityKind =
  | 'dimensionless'
  | 'length'
  | 'angle'
  | 'angular-velocity'
  | 'angular-acceleration'
  | 'velocity'
  | 'acceleration';

export type UnitCode =
  | '1'
  | 'm'
  | 'mm'
  | 'rad'
  | 'deg'
  | 'rad/s'
  | 'deg/s'
  | 'rad/s^2'
  | 'deg/s^2'
  | 'm/s'
  | 'mm/s'
  | 'm/s^2'
  | 'mm/s^2';

export type CanonicalUnitCode =
  | '1'
  | 'm'
  | 'rad'
  | 'rad/s'
  | 'rad/s^2'
  | 'm/s'
  | 'm/s^2';

export interface QuantityValue {
  value: number;
  unit: UnitCode;
}

export interface CanonicalQuantityValue {
  value: number;
  unit: CanonicalUnitCode;
}

interface UnitDefinition {
  kind: QuantityKind;
  canonical: CanonicalUnitCode;
  scale: number;
}

const UNIT_DEFINITIONS: Record<UnitCode, UnitDefinition> = {
  '1': { kind: 'dimensionless', canonical: '1', scale: 1 },
  m: { kind: 'length', canonical: 'm', scale: 1 },
  mm: { kind: 'length', canonical: 'm', scale: 1e-3 },
  rad: { kind: 'angle', canonical: 'rad', scale: 1 },
  deg: { kind: 'angle', canonical: 'rad', scale: Math.PI / 180 },
  'rad/s': { kind: 'angular-velocity', canonical: 'rad/s', scale: 1 },
  'deg/s': {
    kind: 'angular-velocity',
    canonical: 'rad/s',
    scale: Math.PI / 180,
  },
  'rad/s^2': {
    kind: 'angular-acceleration',
    canonical: 'rad/s^2',
    scale: 1,
  },
  'deg/s^2': {
    kind: 'angular-acceleration',
    canonical: 'rad/s^2',
    scale: Math.PI / 180,
  },
  'm/s': { kind: 'velocity', canonical: 'm/s', scale: 1 },
  'mm/s': { kind: 'velocity', canonical: 'm/s', scale: 1e-3 },
  'm/s^2': { kind: 'acceleration', canonical: 'm/s^2', scale: 1 },
  'mm/s^2': { kind: 'acceleration', canonical: 'm/s^2', scale: 1e-3 },
};

export function quantity(value: number, unit: UnitCode): QuantityValue {
  return { value, unit };
}

export function quantityKind(value: QuantityValue): QuantityKind {
  return UNIT_DEFINITIONS[value.unit].kind;
}

export function toCanonicalQuantity(
  value: QuantityValue,
  expectedKind?: QuantityKind,
): CanonicalQuantityValue {
  const definition = UNIT_DEFINITIONS[value.unit];

  if (expectedKind !== undefined && definition.kind !== expectedKind) {
    throw new TypeError(
      `Expected ${expectedKind}, received ${definition.kind} (${value.unit})`,
    );
  }

  return {
    value: value.value * definition.scale,
    unit: definition.canonical,
  };
}

export function canonicalNumber(
  value: QuantityValue,
  expectedKind: QuantityKind,
): number {
  return toCanonicalQuantity(value, expectedKind).value;
}
