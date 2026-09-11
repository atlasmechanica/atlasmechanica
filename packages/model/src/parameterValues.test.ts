import { describe, expect, it } from 'vitest';
import { normalizeParameterQuantity, ParameterValueError, resolveParameterValues } from './parameterValues.js';
import { quantity, type ParameterDefinition } from './index.js';

function definitions(): Record<string, ParameterDefinition> {
  return {
    radius: { id: 'radius', label: 'Radius', kind: 'length', default: quantity(30, 'mm'), domain: { min: quantity(1, 'mm'), max: quantity(0.1, 'm') } },
    phase: { id: 'phase', label: 'Phase', kind: 'angle', default: quantity(180, 'deg') },
  };
}

describe('shared parameter quantity resolution', () => {
  it('normalizes units through the existing model conversion rules', () => {
    expect(resolveParameterValues(definitions())).toEqual({ radius: quantity(0.03, 'm'), phase: quantity(Math.PI, 'rad') });
    expect(normalizeParameterQuantity(quantity(90, 'deg/s'), 'angular-velocity')).toEqual(quantity(Math.PI / 2, 'rad/s'));
    expect(normalizeParameterQuantity(quantity(1000, 'mm/s^2'), 'acceleration')).toEqual(quantity(1, 'm/s^2'));
  });

  it('applies default, preset, session, then request values without merging quantities fieldwise', () => {
    const result = resolveParameterValues(definitions(), { radius: quantity(40, 'mm') }, { radius: quantity(0.05, 'm') }, { phase: quantity(90, 'deg') });
    expect(result).toEqual({ radius: quantity(0.05, 'm'), phase: quantity(Math.PI / 2, 'rad') });
    expect(() => resolveParameterValues(definitions(), { radius: { value: 40 } })).toThrow();
  });

  it('does not mutate or freeze caller defaults or override objects', () => {
    const model = definitions();
    const input = { radius: quantity(40, 'mm') };
    const result = resolveParameterValues(model, input);
    input.radius.value = 80;
    expect(result.radius).toEqual(quantity(0.04, 'm'));
    expect(model.radius?.default).toEqual(quantity(30, 'mm'));
    expect(Object.isFrozen(model)).toBe(false);
    expect(Object.isFrozen(input.radius)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.radius)).toBe(true);
    expect(Object.keys(result)).toEqual(['phase', 'radius']);
  });

  it.each([NaN, Infinity, -Infinity, '30', null, undefined])('rejects non-finite/non-numeric value %s', (value) => {
    expect(() => normalizeParameterQuantity({ value, unit: 'mm' })).toThrow(ParameterValueError);
  });

  it.each(['rpm', 'cm', 'constructor', '__proto__', 'toString', '', null, 1])('rejects unsupported unit %s', (unit) => {
    expect(() => normalizeParameterQuantity({ value: 30, unit })).toThrow(ParameterValueError);
  });

  it('rejects wrong dimensions and extra quantity fields', () => {
    expect(() => resolveParameterValues(definitions(), { radius: quantity(30, 'deg') })).toThrow('expected length');
    expect(() => normalizeParameterQuantity({ value: 1, unit: 'm', script: 'no' })).toThrow('Unknown quantity field');
  });

  it.each([0, 0.5, 101])('rejects value %s mm outside a mixed-unit domain', (value) => {
    expect(() => resolveParameterValues(definitions(), { radius: quantity(value, 'mm') })).toThrow('outside the declared domain');
  });

  it('accepts inclusive domain endpoints expressed in different units', () => {
    expect(resolveParameterValues(definitions(), { radius: quantity(0.001, 'm') }).radius).toEqual(quantity(0.001, 'm'));
    expect(resolveParameterValues(definitions(), { radius: quantity(100, 'mm') }).radius).toEqual(quantity(0.1, 'm'));
  });

  it('rejects a bad earlier override even if a later one is valid', () => {
    expect(() => resolveParameterValues(definitions(), { radius: quantity(0, 'mm') }, { radius: quantity(50, 'mm') })).toThrow('/overrides/0/radius');
  });

  it('rejects invalid defaults and reversed domains rather than masking them', () => {
    const invalid = definitions();
    invalid.radius!.default = quantity(0, 'mm');
    expect(() => resolveParameterValues(invalid, { radius: quantity(50, 'mm') })).toThrow('/definitions/radius/default');
    invalid.radius!.default = quantity(30, 'mm');
    invalid.radius!.domain = { min: quantity(0.1, 'm'), max: quantity(1, 'mm') };
    expect(() => resolveParameterValues(invalid)).toThrow('Minimum exceeds maximum');
  });

  it('checks domain units and bounds even when the default is overridden', () => {
    const invalid = definitions();
    invalid.radius!.domain = { min: quantity(NaN, 'mm') };
    expect(() => resolveParameterValues(invalid, { radius: quantity(50, 'mm') })).toThrow('/domain/min/value');
    invalid.radius!.domain = { min: quantity(1, 'deg') };
    expect(() => resolveParameterValues(invalid)).toThrow('expected length');
  });

  it('ignores inherited overrides but checks every own override', () => {
    const inherited = Object.create({ radius: quantity(70, 'mm') }) as Record<string, unknown>;
    expect(resolveParameterValues(definitions(), inherited).radius).toEqual(quantity(0.03, 'm'));
    Object.defineProperty(inherited, 'radius', { value: quantity(40, 'mm'), enumerable: false });
    expect(resolveParameterValues(definitions(), inherited).radius).toEqual(quantity(0.04, 'm'));
    Object.defineProperty(inherited, 'toString', { value: quantity(40, 'mm'), enumerable: false });
    expect(() => resolveParameterValues(definitions(), inherited)).toThrow('Unknown parameter toString');
  });

  it('rejects symbols, explicit undefined, and accessors without calling getters', () => {
    expect(() => resolveParameterValues(definitions(), { [Symbol('x')]: quantity(40, 'mm') })).toThrow('Symbol keys');
    expect(() => resolveParameterValues(definitions(), { radius: undefined })).toThrow();
    let calls = 0;
    const accessor = Object.defineProperty({}, 'radius', { get() { calls++; return quantity(40, 'mm'); } });
    expect(() => resolveParameterValues(definitions(), accessor)).toThrow('Accessor');
    expect(calls).toBe(0);
    const quantityAccessor = Object.defineProperty({ unit: 'mm' }, 'value', { get() { calls++; return 40; } });
    expect(() => normalizeParameterQuantity(quantityAccessor)).toThrow('Accessor');
    expect(calls).toBe(0);
  });
});
