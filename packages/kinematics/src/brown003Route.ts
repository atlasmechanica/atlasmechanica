import {
  canonicalNumber,
  isParameterReference,
  validateSimulationModel,
  type Diagnostic,
  type FixedAxisBeltContactDefinition,
  type FixedAxisPulleyDefinition,
  type FixedAxisPulleyId,
  type ParameterId,
  type QuantityKind,
  type QuantityValue,
  type ScalarSource,
  type SimulationModel,
} from '@atlasmechanica/model';

const BROWN_003_MODEL_ID = 'foundation:belt-drive:quarter-turn-guided';
const BROWN_003_SUBJECT = 'belt-drive';
const BROWN_003_VARIANT = 'quarter-turn-guided';
const BROWN_003_LOOP_ID = 'main-belt';
const GEOMETRY_TOLERANCE = 1e-9;
const DIRECTION_TOLERANCE = 1e-8;

const CONTACT_PROFILE = [
  { pulley: 'driver', role: 'driver', coordinate: 'driver-angle', sense: 1 },
  { pulley: 'guide-a', role: 'guide', coordinate: 'guide-a-angle', sense: 1 },
  { pulley: 'driven', role: 'driven', coordinate: 'driven-angle', sense: 1 },
  { pulley: 'guide-b', role: 'guide', coordinate: 'guide-b-angle', sense: 1 },
] as const;

type Vec3 = readonly [number, number, number];
type Sense = 1 | -1;

interface ResolvedParameter {
  value: number;
  kind: QuantityKind;
}

type ParameterValues = Record<ParameterId, ResolvedParameter>;

interface ResolvedPulley {
  definition: FixedAxisPulleyDefinition;
  center: Vec3;
  axis: Vec3;
  radius: number;
  faceWidth: number;
}

interface TangentSpan {
  start: Vec3;
  end: Vec3;
  direction: Vec3;
}

export interface Brown003RouteRequest {
  parameters?: Partial<Record<ParameterId, QuantityValue>>;
}

export interface Brown003RouteSpan {
  id: 'driver-guide-a' | 'guide-a-driven' | 'driven-guide-b' | 'guide-b-driver';
  from: FixedAxisPulleyId;
  to: FixedAxisPulleyId;
  start: Vec3;
  end: Vec3;
  /** Straight-span centerline length in meters. */
  length: number;
}

export interface Brown003PulleyTrack {
  pulley: FixedAxisPulleyId;
  center: Vec3;
  axis: Vec3;
  radius: number;
  /** Resolved finite pulley-face width used for route containment, in meters. */
  faceWidth: number;
  arrival: Vec3;
  departure: Vec3;
  arrivalAxialOffset: number;
  departureAxialOffset: number;
  /** Signed angular travel about the authored +axis, in radians. */
  signedWrapAngle: number;
  /** Remaining usable half-face margin after accounting for belt width, in meters. */
  faceMargin: number;
  /**
   * Kinematic claim boundary for this routed track. The separate `v = rω`
   * relation is only a lumped system-level transmission-ratio law. Any axial
   * centerline movement here is explicit lateral tracking slip; this route does
   * not certify pointwise circumferential traction or no-slip contact.
   */
  kinematicBoundary: 'lumped-pitch-speed-ratio-with-lateral-tracking-slip';
  /** Absolute axial centerline change across this pulley contact, in meters. */
  lateralSlipDistance: number;
}

export interface Brown003RouteResult {
  model: string;
  beltWidth?: number;
  spans: Brown003RouteSpan[];
  tracks: Brown003PulleyTrack[];
  diagnostics: Diagnostic[];
}

function routeDiagnostic(
  code: Diagnostic['code'],
  message: string,
  context?: Diagnostic['context'],
): Diagnostic {
  const item: Diagnostic = { severity: 'error', code, message };
  if (context !== undefined) item.context = context;
  return item;
}

function emptyRoute(model: SimulationModel, diagnostics: Diagnostic[]): Brown003RouteResult {
  return { model: model.id, spans: [], tracks: [], diagnostics };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v: Vec3, scalar: number): Vec3 {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function magnitude(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 | undefined {
  if (!v.every(Number.isFinite)) return undefined;
  const componentScale = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
  if (!(componentScale > 0)) return undefined;
  const scaled: Vec3 = [
    v[0] / componentScale,
    v[1] / componentScale,
    v[2] / componentScale,
  ];
  const length = magnitude(scaled);
  if (!(length > 0) || !Number.isFinite(length)) return undefined;
  return [scaled[0] / length, scaled[1] / length, scaled[2] / length];
}

function reject(v: Vec3, axis: Vec3): Vec3 {
  return subtract(v, scale(axis, dot(v, axis)));
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return scale(add(a, b), 0.5);
}

function distance(a: Vec3, b: Vec3): number {
  return magnitude(subtract(a, b));
}

function near(a: number, b: number, tolerance = GEOMETRY_TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

function parallelSameDirection(a: Vec3, b: Vec3): boolean {
  return dot(a, b) >= 1 - DIRECTION_TOLERANCE;
}

function perpendicular(a: Vec3, b: Vec3): boolean {
  return Math.abs(dot(a, b)) <= DIRECTION_TOLERANCE;
}

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function resolveParameters(
  model: SimulationModel,
  overrides: Partial<Record<ParameterId, QuantityValue>>,
): ParameterValues {
  for (const key of Reflect.ownKeys(overrides)) {
    if (
      typeof key !== 'string'
      || !Object.prototype.hasOwnProperty.call(model.parameters, key)
    ) {
      throw new RangeError(`Unknown parameter override ${String(key)}`);
    }
    if (overrides[key] === undefined) {
      throw new TypeError(`Parameter override ${key} must be defined`);
    }
  }

  const values: ParameterValues = {};
  for (const [id, definition] of Object.entries(model.parameters)) {
    const authored = Object.prototype.hasOwnProperty.call(overrides, id)
      ? overrides[id]
      : definition.default;
    if (authored === undefined) {
      throw new TypeError(`Parameter override ${id} must be defined`);
    }
    const value = assertFinite(canonicalNumber(authored, definition.kind), id);
    if (definition.domain?.min !== undefined) {
      const minimum = assertFinite(
        canonicalNumber(definition.domain.min, definition.kind),
        `${id} minimum`,
      );
      if (value < minimum) throw new RangeError(`${id} must be >= ${minimum}`);
    }
    if (definition.domain?.max !== undefined) {
      const maximum = assertFinite(
        canonicalNumber(definition.domain.max, definition.kind),
        `${id} maximum`,
      );
      if (value > maximum) throw new RangeError(`${id} must be <= ${maximum}`);
    }
    values[id] = { value, kind: definition.kind };
  }
  return values;
}

function resolveScalar(
  source: ScalarSource,
  parameters: ParameterValues,
  kind: QuantityKind,
  label: string,
): number {
  if (isParameterReference(source)) {
    const parameter = parameters[source.parameter];
    if (parameter === undefined) throw new TypeError(`Missing parameter ${source.parameter}`);
    if (parameter.kind !== kind) {
      throw new TypeError(`Parameter ${source.parameter} is ${parameter.kind}, not ${kind}`);
    }
    return assertFinite(parameter.value, label);
  }
  return assertFinite(canonicalNumber(source, kind), label);
}

function resolveCenter(
  pulley: FixedAxisPulleyDefinition,
  parameters: ParameterValues,
): Vec3 {
  return [
    resolveScalar(pulley.center.x, parameters, 'length', `${pulley.id} center x`),
    resolveScalar(pulley.center.y, parameters, 'length', `${pulley.id} center y`),
    resolveScalar(pulley.center.z, parameters, 'length', `${pulley.id} center z`),
  ];
}

function resolvePulley(
  pulley: FixedAxisPulleyDefinition,
  parameters: ParameterValues,
): ResolvedPulley {
  const axis = normalize(pulley.axis);
  if (axis === undefined) throw new TypeError(`${pulley.id} axis must be finite and non-zero`);
  const radius = resolveScalar(pulley.pitchRadius, parameters, 'length', `${pulley.id} radius`);
  if (pulley.faceWidth === undefined) {
    throw new TypeError(`${pulley.id} face width is required for Brown 003 route geometry`);
  }
  const faceWidth = resolveScalar(pulley.faceWidth, parameters, 'length', `${pulley.id} face width`);
  if (!(radius > 0)) throw new RangeError(`${pulley.id} radius must be positive`);
  if (!(faceWidth > 0)) throw new RangeError(`${pulley.id} face width must be positive`);
  return { definition: pulley, center: resolveCenter(pulley, parameters), axis, radius, faceWidth };
}

function ordinaryExternalTangent(
  sourceCenter: Vec3,
  sourceRadius: number,
  targetCenter: Vec3,
  targetRadius: number,
  axis: Vec3,
  branch: Sense,
): TangentSpan | undefined {
  const centerDelta = reject(subtract(targetCenter, sourceCenter), axis);
  const centerDistance = magnitude(centerDelta);
  if (!(centerDistance > sourceRadius + targetRadius + GEOMETRY_TOLERANCE)) {
    return undefined;
  }

  const along = normalize(centerDelta);
  if (along === undefined) return undefined;
  const across = normalize(cross(axis, along));
  if (across === undefined) return undefined;

  const radialProjection = (sourceRadius - targetRadius) / centerDistance;
  if (!(Math.abs(radialProjection) < 1)) return undefined;
  const transverseProjection = Math.sqrt(1 - radialProjection * radialProjection);
  const normal = add(
    scale(along, radialProjection),
    scale(across, branch * transverseProjection),
  );

  const start = add(sourceCenter, scale(normal, sourceRadius));
  const end = add(targetCenter, scale(normal, targetRadius));
  const direction = normalize(subtract(end, start));
  return direction === undefined ? undefined : { start, end, direction };
}

function axisOffset(point: Vec3, pulley: ResolvedPulley): number {
  return dot(subtract(point, pulley.center), pulley.axis);
}

function radialUnit(point: Vec3, pulley: ResolvedPulley): Vec3 | undefined {
  const relative = subtract(point, pulley.center);
  const radial = reject(relative, pulley.axis);
  const radius = magnitude(radial);
  if (!near(radius, pulley.radius, 1e-8)) return undefined;
  return normalize(radial);
}

function circulationSign(
  point: Vec3,
  travelDirection: Vec3,
  pulley: ResolvedPulley,
): Sense | undefined {
  const radial = radialUnit(point, pulley);
  if (radial === undefined) return undefined;
  const positiveTangent = normalize(cross(pulley.axis, radial));
  if (positiveTangent === undefined) return undefined;
  const alignment = dot(positiveTangent, travelDirection);
  if (Math.abs(Math.abs(alignment) - 1) > DIRECTION_TOLERANCE) return undefined;
  return alignment >= 0 ? 1 : -1;
}

function makeTrack(
  pulley: ResolvedPulley,
  arrival: Vec3,
  departure: Vec3,
  incomingDirection: Vec3,
  outgoingDirection: Vec3,
  authoredSense: Sense,
  beltWidth: number,
): Brown003PulleyTrack | Diagnostic {
  const arrivalRadial = radialUnit(arrival, pulley);
  const departureRadial = radialUnit(departure, pulley);
  if (arrivalRadial === undefined || departureRadial === undefined) {
    return routeDiagnostic('invalid-geometry', `${pulley.definition.id} contact left its pitch surface`);
  }

  const arrivalSense = circulationSign(arrival, incomingDirection, pulley);
  const departureSense = circulationSign(departure, outgoingDirection, pulley);
  if (arrivalSense === undefined || departureSense === undefined) {
    return routeDiagnostic(
      'invalid-geometry',
      `${pulley.definition.id} straight span is not tangent to its pitch surface`,
    );
  }
  if (arrivalSense !== departureSense || arrivalSense !== authoredSense) {
    return routeDiagnostic(
      'invalid-geometry',
      `${pulley.definition.id} authored travel sense disagrees with the routed tangent branch`,
      { authoredSense, arrivalSense, departureSense },
    );
  }

  let signedWrapAngle = Math.atan2(
    dot(pulley.axis, cross(arrivalRadial, departureRadial)),
    dot(arrivalRadial, departureRadial),
  );
  if (authoredSense === 1 && signedWrapAngle < 0) signedWrapAngle += 2 * Math.PI;
  if (authoredSense === -1 && signedWrapAngle > 0) signedWrapAngle -= 2 * Math.PI;
  if (!(Math.abs(signedWrapAngle) > GEOMETRY_TOLERANCE)) {
    return routeDiagnostic('invalid-geometry', `${pulley.definition.id} has zero routed wrap`);
  }

  const arrivalAxialOffset = axisOffset(arrival, pulley);
  const departureAxialOffset = axisOffset(departure, pulley);
  const faceMargin =
    pulley.faceWidth / 2
    - beltWidth / 2
    - Math.max(Math.abs(arrivalAxialOffset), Math.abs(departureAxialOffset));
  if (faceMargin < -GEOMETRY_TOLERANCE) {
    return routeDiagnostic(
      'invalid-geometry',
      `${pulley.definition.id} face is too narrow for Brown 003 belt tracking`,
      { faceMargin },
    );
  }

  return {
    pulley: pulley.definition.id,
    center: pulley.center,
    axis: pulley.axis,
    radius: pulley.radius,
    faceWidth: pulley.faceWidth,
    arrival,
    departure,
    arrivalAxialOffset,
    departureAxialOffset,
    signedWrapAngle,
    faceMargin,
    kinematicBoundary: 'lumped-pitch-speed-ratio-with-lateral-tracking-slip',
    lateralSlipDistance: Math.abs(departureAxialOffset - arrivalAxialOffset),
  };
}

function isDiagnostic(value: Brown003PulleyTrack | Diagnostic): value is Diagnostic {
  return 'severity' in value;
}

function makeSpan(
  id: Brown003RouteSpan['id'],
  from: FixedAxisPulleyId,
  to: FixedAxisPulleyId,
  span: TangentSpan,
): Brown003RouteSpan {
  return { id, from, to, start: span.start, end: span.end, length: distance(span.start, span.end) };
}

function directSpan(start: Vec3, end: Vec3): TangentSpan | undefined {
  const direction = normalize(subtract(end, start));
  return direction === undefined ? undefined : { start, end, direction };
}

/**
 * Solve the Atlas reference delivery route for Brown 003.
 *
 * This is deliberately Brown-specific. It applies the historical flat-belt
 * delivery rule: each straight belt portion approaches its destination in the
 * destination pulley's middle plane. The two guides are coaxial and occupy
 * separate axial faces, one for each belt leaf. Pulley-face widths bound the
 * lateral tracking required between incoming and outgoing tangent points.
 *
 * A successful result certifies geometric routing and face containment only.
 * It does not assert zero relative velocity over the full pulley face. Where
 * the centerline changes axial offset, the route explicitly represents lateral
 * tracking slip while the separate continuity oracle supplies only the lumped
 * ideal pitch-speed ratio relation. This is still not a SimulationAdapter;
 * dynamics, contact forces, slip magnitude laws, and historical dimensions are
 * outside this function.
 */
export function solveBrown003Route(
  model: SimulationModel,
  request: Brown003RouteRequest = {},
): Brown003RouteResult {
  const validation = validateSimulationModel(model);
  if (validation.some((item) => item.severity === 'error')) {
    return emptyRoute(model, validation);
  }
  if (
    model.id !== BROWN_003_MODEL_ID
    || model.subject !== BROWN_003_SUBJECT
    || model.variant !== BROWN_003_VARIANT
  ) {
    return emptyRoute(model, [
      routeDiagnostic('unsupported-model', 'Brown 003 route solver supports only the canonical quarter-turn guide-pulley model'),
    ]);
  }

  const system = model.systems.fixedAxisBelt;
  const loop = system?.loops[BROWN_003_LOOP_ID];
  if (system === undefined || loop === undefined) {
    return emptyRoute(model, [routeDiagnostic('unsupported-model', 'Brown 003 fixed-axis belt loop is missing')]);
  }
  if (
    loop.contacts.length !== CONTACT_PROFILE.length
    || Object.keys(system.pulleys).length !== CONTACT_PROFILE.length
  ) {
    return emptyRoute(model, [routeDiagnostic('unsupported-model', 'Brown 003 route requires exactly four routed pulleys')]);
  }

  for (let index = 0; index < CONTACT_PROFILE.length; index += 1) {
    const expected = CONTACT_PROFILE[index];
    const contact = loop.contacts[index];
    const pulley = expected === undefined ? undefined : system.pulleys[expected.pulley];
    if (
      expected === undefined
      || contact === undefined
      || pulley === undefined
      || contact.pulley !== expected.pulley
      || contact.sense !== expected.sense
      || pulley.role !== expected.role
      || pulley.coordinate !== expected.coordinate
    ) {
      return emptyRoute(model, [
        routeDiagnostic(
          'unsupported-model',
          `Brown 003 route requires ${expected?.pulley ?? 'the expected pulley'} at loop index ${index}`,
        ),
      ]);
    }
  }

  try {
    const parameters = resolveParameters(model, request.parameters ?? {});
    const beltWidth = resolveScalar(loop.beltWidth ?? { value: 0, unit: 'm' }, parameters, 'length', 'belt width');
    if (!(beltWidth >= 0)) throw new RangeError('belt width must be non-negative');
    const pulleys = Object.fromEntries(
      CONTACT_PROFILE.map(({ pulley }) => [pulley, resolvePulley(system.pulleys[pulley] as FixedAxisPulleyDefinition, parameters)]),
    ) as Record<FixedAxisPulleyId, ResolvedPulley>;

    const driver = pulleys.driver;
    const driven = pulleys.driven;
    const guideA = pulleys['guide-a'];
    const guideB = pulleys['guide-b'];

    if (!perpendicular(driver.axis, driven.axis)) {
      throw new TypeError('Brown 003 driver and driven axes must be perpendicular');
    }
    if (!parallelSameDirection(guideA.axis, guideB.axis)) {
      throw new TypeError('Brown 003 guide axes must be parallel and codirectional');
    }
    if (!perpendicular(driver.axis, guideA.axis) || !perpendicular(driven.axis, guideA.axis)) {
      throw new TypeError('Brown 003 guide axis must be perpendicular to both power axes');
    }

    const driverGuideA = ordinaryExternalTangent(
      driver.center,
      driver.radius,
      guideA.center,
      guideA.radius,
      driver.axis,
      1,
    );
    const guideADriven = ordinaryExternalTangent(
      guideA.center,
      guideA.radius,
      driven.center,
      driven.radius,
      driven.axis,
      -1,
    );
    const drivenGuideB = ordinaryExternalTangent(
      driven.center,
      driven.radius,
      guideB.center,
      guideB.radius,
      driven.axis,
      1,
    );
    const guideBDriver = ordinaryExternalTangent(
      guideB.center,
      guideB.radius,
      driver.center,
      driver.radius,
      driver.axis,
      -1,
    );
    if (
      driverGuideA === undefined
      || guideADriven === undefined
      || drivenGuideB === undefined
      || guideBDriver === undefined
    ) {
      throw new RangeError('Brown 003 reference centers and radii admit no external tangent route');
    }

    const midA = midpoint(driverGuideA.end, guideADriven.start);
    const midB = midpoint(drivenGuideB.end, guideBDriver.start);
    const guideARadial = radialUnit(midA, guideA);
    const guideBRadial = radialUnit(midB, guideB);
    if (guideARadial === undefined || guideBRadial === undefined) {
      throw new RangeError('Brown 003 guide contact midpoint left its pitch surface');
    }

    // The published plate does not dimension hidden depth. Atlas's reference
    // geometry locates each guide leaf so its straight delivery span approaches
    // the receiving power pulley in that pulley's middle plane. The returned
    // track records the resulting lateral motion across the finite face rather
    // than relabeling it as pointwise no-slip contact.
    const guideAArrival = driverGuideA.end;
    const guideADeparture = add(
      guideA.center,
      add(
        scale(guideARadial, guideA.radius),
        scale(guideA.axis, axisOffset(guideADriven.start, guideA)),
      ),
    );
    const guideBArrival = drivenGuideB.end;
    const guideBDeparture = add(
      guideB.center,
      add(
        scale(guideBRadial, guideB.radius),
        scale(guideB.axis, axisOffset(guideBDriver.start, guideB)),
      ),
    );

    const spans = [
      makeSpan('driver-guide-a', 'driver', 'guide-a', driverGuideA),
      makeSpan('guide-a-driven', 'guide-a', 'driven', directSpan(guideADeparture, guideADriven.end) as TangentSpan),
      makeSpan('driven-guide-b', 'driven', 'guide-b', drivenGuideB),
      makeSpan('guide-b-driver', 'guide-b', 'driver', directSpan(guideBDeparture, guideBDriver.end) as TangentSpan),
    ];
    const tracksOrDiagnostics = [
      makeTrack(driver, guideBDriver.end, driverGuideA.start, guideBDriver.direction, driverGuideA.direction, 1, beltWidth),
      makeTrack(guideA, guideAArrival, guideADeparture, driverGuideA.direction, guideADriven.direction, 1, beltWidth),
      makeTrack(driven, guideADriven.end, drivenGuideB.start, guideADriven.direction, drivenGuideB.direction, 1, beltWidth),
      makeTrack(guideB, guideBArrival, guideBDeparture, drivenGuideB.direction, guideBDriver.direction, 1, beltWidth),
    ];
    const diagnostic = tracksOrDiagnostics.find(isDiagnostic);
    if (diagnostic !== undefined) return emptyRoute(model, [diagnostic]);

    return {
      model: model.id,
      beltWidth,
      spans,
      tracks: tracksOrDiagnostics as Brown003PulleyTrack[],
      diagnostics: [],
    };
  } catch (error) {
    return emptyRoute(model, [
      routeDiagnostic(
        error instanceof RangeError ? 'invalid-geometry' : 'invalid-input',
        error instanceof Error ? error.message : 'Brown 003 route input is invalid',
      ),
    ]);
  }
}
