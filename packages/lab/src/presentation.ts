import {
  normalizeParameterQuantity,
  resolveParameterValues,
  type QuantityValue,
  type SimulationModel,
} from '@atlasmechanica/model';
import { validateMechanismLabDefinition } from './core.js';
import type { LabControlDefinition, LabView, MechanismLabDefinition } from './schema.js';

/** Presentation can narrow a trusted nonperiodic control, but cannot rebind or change its units. */
export interface LabControlOverride {
  readonly id: string;
  readonly label?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Only coordinate/rate controls. Parameter initial values belong to the preset. */
  readonly initial?: number;
}
export interface LabReadoutOverride {
  readonly id: string;
  readonly label?: string;
  readonly digits?: number;
}
export interface LabPresentationSettings {
  readonly subtitle?: string;
  readonly views?: readonly LabView[];
  readonly controls?: readonly LabControlOverride[];
  readonly readouts?: readonly LabReadoutOverride[];
}
export interface LabPresentationPreset {
  readonly modelId: string;
  readonly configuration: string;
  readonly parameters: Readonly<Record<string, QuantityValue>>;
}
export class LabPresentationError extends TypeError {
  constructor(readonly pointer: string, readonly detail: string) {
    super(`${pointer}: ${detail}`);
    this.name = 'LabPresentationError';
  }
}
function fail(pointer: string, detail: string): never {
  throw new LabPresentationError(pointer, detail);
}
function child(pointer: string, key: string): string {
  return `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}
function fields(value: unknown, allowed: readonly string[], pointer: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) {
    fail(pointer, 'Expected a plain data object');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(pointer, 'Symbol keys are not allowed');
    const location = child(pointer, key);
    if (!allowed.includes(key)) fail(location, 'Unknown presentation field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail(location, 'Accessors are not allowed');
    if (descriptor.value === undefined) fail(location, 'Explicit undefined is not allowed');
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, pointer: string): void {
  if (typeof value !== 'string' || value.trim() === '') fail(pointer, 'Expected nonempty text');
}
function finite(value: unknown, pointer: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(pointer, 'Expected a finite number');
}
function items(value: unknown, pointer: string, check: (value: unknown, pointer: string) => void): void {
  if (!Array.isArray(value)) fail(pointer, 'Expected an array');
  // Direct callers must obey the same plain-data boundary as parsed JSON.
  // Reject subclasses/custom prototypes before using any inherited array method.
  if (Object.getPrototypeOf(value) !== Array.prototype) fail(pointer, 'Expected a plain data array');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(pointer, 'Symbol keys are not allowed');
    const location = child(pointer, key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (key !== 'length') {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
        fail(location, 'Unknown presentation array field');
      }
    }
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail(location, 'Accessors are not allowed');
    // structuredClone omits non-enumerable indexes; accepting one could change
    // validated views into a sparse array in the returned definition.
    if (key !== 'length' && !descriptor.enumerable) fail(location, 'Expected an enumerable data array item');
  }
  for (let index = 0; index < value.length; index += 1) {
    const location = `${pointer}/${index}`;
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail(location, 'Expected a data array item');
    check(descriptor.value, location);
  }
}
function own<T extends object, K extends keyof T>(value: T, key: K): T[K] | undefined {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

/** Shared JSON boundary for catalog authoring and direct presentation consumers. */
export function validateLabPresentationSettings(value: unknown): asserts value is LabPresentationSettings {
  const settings = fields(value, ['subtitle', 'views', 'controls', 'readouts'], '');
  if (Object.hasOwn(settings, 'subtitle')) text(settings.subtitle, '/subtitle');
  if (Object.hasOwn(settings, 'views')) {
    const seen = new Set<string>();
    items(settings.views, '/views', (view, pointer) => {
      if (view !== '2d' && view !== '3d') fail(pointer, 'Expected 2d or 3d');
      if (seen.has(view)) fail(pointer, 'Duplicate view');
      seen.add(view);
    });
    if (!seen.has('2d')) fail('/views', 'A 2D view is required');
  }
  for (const kind of ['controls', 'readouts'] as const) {
    if (!Object.hasOwn(settings, kind)) continue;
    const seen = new Set<string>();
    items(settings[kind], `/${kind}`, (item, pointer) => {
      const data = fields(item, kind === 'controls'
        ? ['id', 'label', 'min', 'max', 'step', 'initial'] : ['id', 'label', 'digits'], pointer);
      if (!Object.hasOwn(data, 'id')) fail(`${pointer}/id`, 'Required field is missing');
      text(data.id, `${pointer}/id`);
      const id = data.id as string;
      if (seen.has(id)) fail(`${pointer}/id`, `Duplicate ${kind} override ${id}`);
      seen.add(id);
      if (Object.hasOwn(data, 'label')) text(data.label, `${pointer}/label`);
      for (const key of ['min', 'max', 'step', 'initial', 'digits']) {
        if (Object.hasOwn(data, key)) finite(data[key], `${pointer}/${key}`);
      }
      if (Object.hasOwn(data, 'digits') && (!Number.isInteger(data.digits as number) || (data.digits as number) < 0 || (data.digits as number) > 12)) {
        fail(`${pointer}/digits`, 'Display digits must be an integer from 0 through 12');
      }
    });
  }
}
function ownFreeze<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === 'object') {
      for (const nested of Object.values(item)) freeze(nested);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}
function checkControl(control: LabControlDefinition, model: SimulationModel, pointer: string): void {
  if (control.kind === 'parameter') {
    if (!Object.hasOwn(model.parameters, control.parameter)) fail(pointer, `Unknown parameter ${control.parameter}`);
  } else if (!Object.hasOwn(model.coordinates, control.coordinate) || model.coordinates[control.coordinate]?.role !== 'input') {
    fail(pointer, `Control ${control.id} must target an independent input coordinate`);
  }
  const kind = control.kind === 'parameter' ? model.parameters[control.parameter]!.kind
    : control.kind === 'coordinate' ? 'angle' : 'angular-velocity';
  try {
    for (const field of ['min', 'max', 'step', 'initial'] as const) {
      const value = control[field];
      const quantity = control.unit === 'rpm' ? { value: value * (2 * Math.PI / 60), unit: 'rad/s' }
        : { value, unit: control.unit };
      normalizeParameterQuantity(quantity, kind);
      if (control.kind === 'parameter' && field !== 'step') {
        resolveParameterValues(model.parameters, { [control.parameter]: quantity });
      }
    }
  } catch (error) {
    fail(pointer, `Invalid control ${control.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (control.step > control.max - control.min) fail(pointer, `Control ${control.id} step exceeds its range`);
  const maximumSlot = (control.max - control.min) / control.step;
  if (!Number.isFinite(maximumSlot) || Math.abs(maximumSlot - Math.round(maximumSlot)) > 1e-7) {
    fail(`${pointer}/max`, `Maximum value for ${control.id} must align with the slider step`);
  }
}

/**
 * Models/templates are trusted application definitions; settings are decoded data.
 * A preset is the complete physical baseline. Template parameter overrides are
 * validated but are NOT merged over it. No engine, scene or renderer is loaded.
 */
export function resolveLabPresentation(
  id: string,
  settings: LabPresentationSettings,
  template: MechanismLabDefinition,
  model: SimulationModel,
  preset: LabPresentationPreset,
): MechanismLabDefinition {
  text(id, '/id');
  validateLabPresentationSettings(settings);
  if (model.id !== preset.modelId || model.id !== template.modelId) fail('/template', 'Template, preset and model identities must agree');
  if (!Object.hasOwn(model.configurations, preset.configuration)) fail('/preset', 'Unknown preset configuration');
  try {
    validateMechanismLabDefinition(template, model);
    resolveParameterValues(model.parameters, template.parameterOverrides ?? {});
  } catch (error) {
    fail('/template', `Invalid lab template: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const control of template.controls) checkControl(control, model, '/template');
  if (new Set(template.views).size !== template.views.length
    || template.views.some((view) => view !== '2d' && view !== '3d')) fail('/template', 'Invalid template views');
  for (const readout of template.readouts) {
    if (readout.scale !== undefined && !Number.isFinite(readout.scale)) fail('/template', 'Readout scale must be finite');
  }
  const views = own(settings, 'views') ?? template.views;
  if (views.some((view) => !template.views.includes(view))) fail('/views', 'Presentation cannot enable an unsupported template view');
  let parameters: ReturnType<typeof resolveParameterValues>;
  try { parameters = resolveParameterValues(model.parameters, preset.parameters); }
  catch (error) { fail('/preset', error instanceof Error ? error.message : String(error)); }
  const controlPatches = new Map((own(settings, 'controls') ?? []).map((patch, index) => [patch.id, { patch, index }]));
  for (const [id, { index }] of controlPatches) {
    if (!template.controls.some((control) => control.id === id)) fail(`/controls/${index}/id`, `Unknown template control ${id}`);
  }
  const controls = template.controls.map((base): LabControlDefinition => {
    const entry = controlPatches.get(base.id);
    const patch = entry?.patch;
    const pointer = entry === undefined ? '/preset' : `/controls/${entry.index}`;
    const overrideInitial = patch === undefined ? undefined : own(patch, 'initial');
    const label = patch === undefined ? undefined : own(patch, 'label');
    if (base.kind === 'parameter' && overrideInitial !== undefined) fail(`${pointer}/initial`, 'Parameter initial values belong to the bound model preset');
    let initial = overrideInitial ?? base.initial;
    if (base.kind === 'parameter') {
      const scale = normalizeParameterQuantity({ value: 1, unit: base.unit }, model.parameters[base.parameter]!.kind).value;
      initial = parameters[base.parameter]!.value / scale;
    }
    const control: LabControlDefinition = {
      ...base, initial,
      min: (patch === undefined ? undefined : own(patch, 'min')) ?? base.min,
      max: (patch === undefined ? undefined : own(patch, 'max')) ?? base.max,
      step: (patch === undefined ? undefined : own(patch, 'step')) ?? base.step,
      ...(label === undefined ? {} : { label }),
    };
    if (control.min < base.min) fail(`${pointer}/min`, 'Presentation may only narrow the template range');
    if (control.max > base.max) fail(`${pointer}/max`, 'Presentation may only narrow the template range');
    if (!(control.min < control.max)) fail(pointer, 'Control minimum must be below maximum');
    if (!(control.step > 0)) fail(`${pointer}/step`, 'Control step must be positive');
    // The runtime uses this span to wrap display values while evaluating an
    // unwrapped physical coordinate. A presentation must not shorten its period.
    if (base.kind === 'coordinate' && template.animation?.coordinateControlId === base.id
      && model.coordinates[base.coordinate]?.periodic === true) {
      if (control.min !== base.min) fail(`${pointer}/min`, 'Animated periodic coordinates must preserve the template range');
      if (control.max !== base.max) fail(`${pointer}/max`, 'Animated periodic coordinates must preserve the template range');
    }
    if (!Number.isFinite(initial) || initial < control.min || initial > control.max) fail(pointer, `Initial value for ${base.id} is outside the presentation range`);
    const slot = (initial - control.min) / control.step;
    if (!Number.isFinite(slot) || Math.abs(slot - Math.round(slot)) > 1e-7) fail(pointer, `Initial value for ${base.id} must align with the slider step`);
    checkControl(control, model, pointer);
    return control;
  });
  const readoutPatches = new Map((own(settings, 'readouts') ?? []).map((patch, index) => [patch.id, { patch, index }]));
  for (const [id, { index }] of readoutPatches) {
    if (!template.readouts.some((readout) => readout.id === id)) fail(`/readouts/${index}/id`, `Unknown template readout ${id}`);
  }
  const readouts = template.readouts.map((base) => {
    const entry = readoutPatches.get(base.id);
    const digits = entry === undefined ? undefined : own(entry.patch, 'digits');
    const label = entry === undefined ? undefined : own(entry.patch, 'label');
    if (digits !== undefined && base.source.kind === 'signal'
      && model.signals[base.source.signal]?.valueType === 'text') {
      fail(`/readouts/${entry!.index}/digits`, 'Text readouts do not accept numeric precision');
    }
    return { ...base, ...(digits === undefined ? {} : { digits }), ...(label === undefined ? {} : { label }) };
  });
  const subtitle = own(settings, 'subtitle');
  const definition: MechanismLabDefinition = {
    ...template, id, defaultForModel: false, views, controls, readouts,
    parameterOverrides: parameters, sessionConfiguration: preset.configuration,
    ...(subtitle === undefined ? {} : { subtitle }),
  };
  try { validateMechanismLabDefinition(definition, model); }
  catch (error) { fail('', error instanceof Error ? error.message : String(error)); }
  return ownFreeze(definition);
}
