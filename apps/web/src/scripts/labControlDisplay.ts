import type { LabControlDefinition } from '@atlasmechanica/lab';

/** Shared by SSR and hydration; a fractional initial value must not be rounded away. */
export function displayControlValue(control: Pick<LabControlDefinition, 'unit' | 'step'>, value: number): string {
  const [mantissa = '', exponent = '0'] = String(control.step).toLowerCase().split('e');
  const decimals = Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
  // toFixed accepts at most 100 places; keep smaller representable numbers in
  // exponential notation instead of turning them into a misleading zero.
  const body = decimals > 100 ? String(value) : value.toFixed(decimals);
  if (control.unit === 'deg') return `${body}°`;
  return `${body} ${control.unit}`;
}
