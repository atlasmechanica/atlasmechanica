import { describe, expect, it } from 'vitest';
import {
  analyticBeltAdapter, canonicalQuarterTurnBeltModel, createBeltDriveModel,
} from '@atlasmechanica/kinematics';
import { quantity, type ModelState, type SimulationModel } from '@atlasmechanica/model';
import { brownBeltSceneCompiler } from './compilers.js';
import { buildMechanismScene as schematic, type SceneBuildOptions } from './buildMechanismScene.js';
import { buildMechanismScene as illustrated } from './index.js';
import { resolvePlanarBeltTopology, supportsPlanarBeltScene } from './planarBeltSupport.js';

function input(routing: 'open' | 'crossed' = 'open'): SceneBuildOptions {
  const model = { ...createBeltDriveModel(routing), id: `independent:${routing}` };
  const parameters = { 'driver-radius': quantity(40, 'mm'), 'driven-radius': quantity(60, 'mm'), 'center-distance': quantity(210, 'mm') };
  const state = analyticBeltAdapter.compile(model).createSession().evaluate({
    parameters, coordinates: { 'driver-angle': quantity(721, 'deg') },
    rates: { 'driver-angle': quantity(-2, 'rad/s') }, accelerations: { 'driver-angle': quantity(0.5, 'rad/s^2') },
  });
  return { model, parameters, state };
}
function rejects(options: SceneBuildOptions): void {
  for (const build of [schematic, illustrated, (value: SceneBuildOptions) => brownBeltSceneCompiler.build(value)]) {
    expect(() => build(options)).toThrow();
  }
}
function scalar(state: ModelState, id: string): number {
  const signal = state.signals[id];
  if (signal?.type !== 'scalar') throw new Error(`Missing scalar ${id}`);
  return signal.value.value;
}

describe('planar belt semantic structure, independent of catalog identities', () => {
  it.each(['open', 'crossed'] as const)('accepts %s physical instances and preserves illustration geometry', (routing) => {
    const value = input(routing);
    const template = { ...value.model, id: `foundation:belt-drive:${routing}` };
    expect(brownBeltSceneCompiler.supports(value.model)).toBe(true);
    const scene = illustrated(value);
    const reference = illustrated({ ...value, model: template, state: { ...value.state, model: template.id } });
    expect(scene).toEqual(reference);
    expect(resolvePlanarBeltTopology(value.model).routing).toBe(routing);
  });
  it('derives body, feature, joint, coordinate and parameter roles instead of requiring the fixture names', () => {
    const names: Record<string, string> = { ground: 'base', driver: 'motor', driven: 'wheel', shaft: 'axle', pulley: 'pitch',
      'driver-axis': 'left-support', 'driven-axis': 'right-support', 'driver-bearing': 'left-bearing', 'driven-bearing': 'right-bearing',
      'driver-angle': 'input-turn', 'driven-angle': 'output-turn', 'driver-radius': 'input-radius', 'driven-radius': 'output-radius',
      'center-distance': 'separation', belt: 'transmission' };
    const maps = ['parameters', 'bodies', 'features', 'joints', 'couplings', 'coordinates'];
    const remap = (value: unknown, field = ''): unknown => typeof value === 'string' ? (field === 'type' ? value : names[value] ?? value)
      : Array.isArray(value) ? value.map((child) => remap(child))
      : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [maps.includes(field) ? names[key] ?? key : key, remap(child, key)])) : value;
    const model = remap(createBeltDriveModel('crossed')) as SimulationModel;
    model.id = 'another:physical:model'; model.variant = 'independent-description';
    const state = analyticBeltAdapter.compile(model).createSession().evaluate({ coordinates: { 'input-turn': quantity(40, 'deg') } });
    expect(supportsPlanarBeltScene(model)).toBe(true);
    const scene = illustrated({ model, state });
    expect(scene.primitives.find((item) => item.id === 'belt-input-handle')).toMatchObject({ bindingId: 'input-turn' });
    expect(scene.primitives.find((item) => item.id === 'belt-distance-handle')).toMatchObject({ bindingId: 'separation' });
    expect(scene.primitives.find((item) => item.id === 'belt-driver')).toMatchObject({ selectId: 'motor' });
    expect(scalar(state, 'angular-ratio')).toBe(-0.5);
  });
  it('permits equivalent units/axis magnitudes and ignores descriptive variant/label metadata', () => {
    const model = createBeltDriveModel('open');
    model.id = 'constructor'; model.variant = 'crossed-looking-name';
    model.systems.mechanical!.bodies.driver!.label = 'Historical caption';
    for (const body of Object.values(model.systems.mechanical!.bodies)) {
      body.referencePose.angle = quantity(0, 'deg');
      for (const feature of Object.values(body.features)) if (feature.type === 'axis') feature.direction = [0, 0, 2];
    }
    expect(resolvePlanarBeltTopology(model).routing).toBe('open');
  });
  const mutations: [string, (model: SimulationModel) => void][] = [
    ['spatial system beside the planar one', (m) => { m.systems.fixedAxisBelt = canonicalQuarterTurnBeltModel.systems.fixedAxisBelt!; }],
    ['wrong dimensionality', (m) => { (m.systems.mechanical as unknown as { dimensionality: string }).dimensionality = 'spatial'; }],
    ['extra body', (m) => { m.systems.mechanical!.bodies.extra = { ...m.systems.mechanical!.bodies.ground!, id: 'extra' }; }],
    ['extra coupling', (m) => { m.systems.mechanical!.couplings.extra = { ...m.systems.mechanical!.couplings.belt!, id: 'extra' }; }],
    ['driver is ground', (m) => { m.systems.mechanical!.referenceBody = 'driver'; }],
    ['same driver and driven', (m) => { m.systems.mechanical!.couplings.belt!.driven.body = 'driver'; }],
    ['tilted shaft', (m) => { const f = m.systems.mechanical!.bodies.driver!.features.shaft; if (f?.type === 'axis') f.direction = [1, 0, 1]; }],
    ['reversed shaft', (m) => { const f = m.systems.mechanical!.bodies.driver!.features.shaft; if (f?.type === 'axis') f.direction = [0, 0, -1]; }],
    ['zero shaft', (m) => { const f = m.systems.mechanical!.bodies.driver!.features.shaft; if (f?.type === 'axis') f.direction = [0, 0, 0]; }],
    ['nonfinite shaft', (m) => { const f = m.systems.mechanical!.bodies.driver!.features.shaft; if (f?.type === 'axis') f.direction = [0, 0, Infinity]; }],
    ['eccentric pulley', (m) => { const f = m.systems.mechanical!.bodies.driver!.features.pulley; if (f?.type === 'pulley') f.center.x = quantity(1, 'mm'); }],
    ['disconnected bearing', (m) => { m.systems.mechanical!.joints['driver-bearing']!.parent.body = 'driven'; }],
    ['inconsistent bearing center', (m) => { const f = m.systems.mechanical!.bodies.ground!.features['driven-axis']; if (f?.type === 'axis') f.origin.x = quantity(1, 'mm'); }],
    ['translated ground', (m) => { m.systems.mechanical!.bodies.ground!.referencePose.x = quantity(1, 'mm'); }],
    ['diagonal separation', (m) => { m.systems.mechanical!.bodies.driven!.referencePose.y = { parameter: 'center-distance' }; }],
    ['nonzero reference orientation', (m) => { m.systems.mechanical!.bodies.driver!.referencePose.angle = quantity(1, 'deg'); }],
    ['dependent driver', (m) => { m.coordinates['driver-angle']!.role = 'output'; }],
    ['different coordinate binding', (m) => { m.systems.mechanical!.couplings.belt!.inputCoordinate = 'driven-angle'; }],
    ['nonperiodic input', (m) => { m.coordinates['driver-angle']!.periodic = false; }],
    ['unknown radius parameter', (m) => { const f = m.systems.mechanical!.bodies.driver!.features.pulley; if (f?.type === 'pulley') f.pitchRadius = { parameter: 'missing' }; }],
    ['incompatible radius unit', (m) => { m.parameters['driver-radius']!.default = quantity(30, 'deg'); }],
    ['nonfinite default', (m) => { m.parameters['driver-radius']!.default.value = NaN; }],
    ['extra parameter', (m) => { m.parameters.extra = { ...m.parameters['driver-radius']!, id: 'extra' }; }],
    ['missing output phase', (m) => { delete m.configurations.reference!.coordinates['driven-angle']; }],
    ['ignored configuration modes', (m) => { m.configurations.reference!.modes = { inverted: true }; }],
    ['ignored pose seeds', (m) => { m.configurations.reference!.bodyPoses = { driver: { x: quantity(0, 'm'), y: quantity(0, 'm'), angle: quantity(0, 'rad') } }; }],
    ['missing material signal', (m) => { delete m.signals['belt-travel']; }],
    ['wrong contact unit', (m) => { m.signals['driver-contact-a']!.unit = 'mm'; }],
  ];
  it.each(mutations)('rejects %s even under a formerly allowlisted model ID', (_name, mutate) => {
    const model = createBeltDriveModel('open'); mutate(model);
    expect(supportsPlanarBeltScene(model)).toBe(false);
    expect(brownBeltSceneCompiler.supports(model)).toBe(false);
    rejects({ ...input(), model, state: { ...input().state, model: model.id } });
  });
  it('fails closed for malformed and unsupported models', () => {
    for (const value of [null, {}, { subject: 'belt-drive' }, canonicalQuarterTurnBeltModel]) {
      expect(supportsPlanarBeltScene(value as SimulationModel)).toBe(false);
    }
  });
});

describe('planar state/parameter provenance at both scene entrypoints', () => {
  const mutations: [string, (value: SceneBuildOptions) => void][] = [
    ['different model identity', (o) => { o.state.model = 'unrelated'; }],
    ['missing configuration', (o) => { delete o.state.configuration; }],
    ['unknown configuration', (o) => { o.state.configuration = 'toString'; }],
    ['replayed radii', (o) => { o.parameters!['driver-radius'] = quantity(41, 'mm'); }],
    ['replayed center distance', (o) => { o.parameters!['center-distance'] = quantity(211, 'mm'); }],
    ['changed routing with same model ID', (o) => { o.model.systems.mechanical!.couplings.belt!.routing = 'crossed'; }],
    ['changed reference phase with same model ID', (o) => { o.model.configurations.reference!.coordinates['driver-angle'] = quantity(1, 'deg'); }],
    ['changed dependent phase', (o) => { o.state.coordinates['driven-angle']!.position.value += 0.1; }],
    ['wrong coordinate unit', (o) => { o.state.coordinates['driver-angle']!.position.unit = 'm'; }],
    ['changed body pose', (o) => { o.state.bodies.driven!.pose.y += 0.01; }],
    ['changed body spin', (o) => { o.state.bodies.driver!.angularVelocity = 99; }],
    ['changed angular acceleration', (o) => { o.state.coordinates['driven-angle']!.acceleration!.value += 1; }],
    ['wrapped material travel', (o) => { const f = o.state.signals['belt-travel']; if (f?.type === 'scalar') f.value.value = 0; }],
    ['nonfinite travel', (o) => { const f = o.state.signals['belt-travel']; if (f?.type === 'scalar') f.value.value = Infinity; }],
    ['changed material speed', (o) => { const f = o.state.signals['belt-linear-speed']; if (f?.type === 'scalar') f.value.value += 0.1; }],
    ['missing tangent', (o) => { delete o.state.signals['driver-contact-a']; }],
    ['changed tangent', (o) => { const f = o.state.signals['driver-contact-a']; if (f?.type === 'vector2') f.value.x += 0.01; }],
    ['changed wrap', (o) => { const f = o.state.signals['driver-wrap-angle']; if (f?.type === 'scalar') f.value.value += 0.1; }],
    ['changed mode', (o) => { o.state.modes.fake = 'mode'; }],
    ['failed evaluation', (o) => { o.state.diagnostics.push({ severity: 'error', code: 'invalid-geometry', message: 'not a route' }); }],
    ['unknown own parameter', (o) => { Object.defineProperty(o.parameters, 'toString', { value: quantity(1, 'm'), enumerable: false }); }],
    ['invalid default hidden behind valid override', (o) => { o.model.parameters['driver-radius']!.default.value = -30; }],
    ['canonical underflow', (o) => { o.parameters!['driver-radius'] = quantity(Number.MIN_VALUE, 'mm'); }],
  ];
  it.each(mutations)('rejects %s', (_name, mutate) => { const value = input(); mutate(value); rejects(value); });
  it('preserves real infeasibility rejection rather than trusting valid scalar ranges', () => {
    const value = input('crossed'); value.parameters!['center-distance'] = quantity(90, 'mm');
    value.state = analyticBeltAdapter.compile(value.model).createSession().evaluate({ parameters: value.parameters! });
    expect(value.state.diagnostics[0]!.code).toBe('invalid-geometry');
    rejects(value);
  });
  it('accepts reordered round-tripped state, negative motion and nonzero reference phases', () => {
    const value = input('crossed');
    value.model.configurations.reference!.coordinates = { 'driver-angle': quantity(25, 'deg'), 'driven-angle': quantity(13, 'deg') };
    value.state = analyticBeltAdapter.compile(value.model).createSession().evaluate({ parameters: value.parameters!,
      coordinates: { 'driver-angle': quantity(-721, 'deg') }, rates: { 'driver-angle': quantity(-2, 'rad/s') } });
    const copy = JSON.parse(JSON.stringify(value)) as SceneBuildOptions;
    copy.state.signals = Object.fromEntries(Object.entries(copy.state.signals).reverse());
    expect(illustrated(copy)).toEqual(illustrated(value));
    expect(scalar(copy.state, 'belt-travel')).toBeLessThan(0);
  });
});
