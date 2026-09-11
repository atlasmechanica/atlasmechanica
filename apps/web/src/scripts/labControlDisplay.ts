import type { LabControlDefinition } from '@atlasmechanica/lab';

type DisplayControl = Pick<LabControlDefinition, 'unit' | 'step'> & Partial<Pick<LabControlDefinition, 'min'>>;
function decimalPlaces(value: number): number {
  const [mantissa = '', exponent = '0'] = String(value).toLowerCase().split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
}

/** Shared by SSR and hydration, including fractional offsets on integer-step grids. */
export function displayControlValue(control: DisplayControl, value: number): string {
  const decimals = Math.max(decimalPlaces(control.step), decimalPlaces(control.min ?? 0));
  // toFixed accepts at most 100 places; preserve smaller representable numbers
  // in exponential notation rather than turning them into a misleading zero.
  const body = decimals > 100 ? String(value) : value.toFixed(decimals);
  if (control.unit === 'deg') return `${body}°`;
  return `${body} ${control.unit}`;
}
