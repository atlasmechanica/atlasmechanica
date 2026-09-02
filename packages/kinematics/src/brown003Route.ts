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
  arrival: Vec3;
  departure: Vec3;
  arrivalAxialOffset: number;
  departureAxialOffset: number;
  /** Signed angular travel about the authored +axis, in radians. */
  signedWrapAngle: number;
  /** Remaining usable half-face margin after accounting for belt width, in meters. */
  faceMargin: number;
  /**
   * Brown's one-direction flat-belt route requires the belt centerline to walk
   * laterally across several pulley faces. The ideal ωr law constrains only the
   * circumferential traction component; this axial motion is explicit slip.
   */
  contactKinematics: 'circumferential-traction-with-lateral-tracking-slip';
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
  const length = magnitude(v);
  if (!(length > 1e-12)) return undefined;
  return scale(v, 1 / length);
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
  for (const id of Object.keys(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(model.parameters, id)) {
      throw new RangeError(`Unknown parameter override ${id}`);
    }
  }

  const values: ParameterValues = {};
  for (const [id, definition] of Object.entries(model.parameters)) {
    const authored = overrides[id] ?? definition.default;
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
    arrival,
    departure,
    arrivalAxialOffset,
    departureAxialOffset,
    signedWrapAngle,
    faceMargin,
    contactKinematics: 'circumferential-traction-with-lateral-tracking-slip',
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
 * tracking slip while the separate continuity oracle supplies only the ideal
 * circumferential ωr relation. This is still not a SimulationAdapter; dynamics,
 * contact forces, slip magnitude laws, and historical dimensions are outside
 * this function.
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
    const pulley = contact === undefined ? undefined : system.pulleys[contact.pulley];
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
        routeDiagnostic('unsupported-model', 'Brown 003 contact order, roles, coordinates, or travel senses differ from the reference route'),
      ]);
    }
  }

  let parameters: ParameterValues;
  let driver: ResolvedPulley;
  let guideA: ResolvedPulley;
  let driven: ResolvedPulley;
  let guideB: ResolvedPulley;
  let beltWidth: number;
  try {
    parameters = resolveParameters(model, request.parameters ?? {});
    const driverDefinition = system.pulleys.driver;
    const guideADefinition = system.pulleys['guide-a'];
    const drivenDefinition = system.pulleys.driven;
    const guideBDefinition = system.pulleys['guide-b'];
    if (
      driverDefinition === undefined
      || guideADefinition === undefined
      || drivenDefinition === undefined
      || guideBDefinition === undefined
    ) {
      throw new TypeError('Brown 003 pulley definitions are incomplete');
    }
    driver = resolvePulley(driverDefinition, parameters);
    guideA = resolvePulley(guideADefinition, parameters);
    driven = resolvePulley(drivenDefinition, parameters);
    guideB = resolvePulley(guideBDefinition, parameters);
    if (loop.beltWidth === undefined) {
      throw new TypeError('Brown 003 belt width is required for route geometry');
    }
    beltWidth = resolveScalar(loop.beltWidth, parameters, 'length', 'Brown 003 belt width');
    if (!(beltWidth > 0)) throw new RangeError('Brown 003 belt width must be positive');
  } catch (error) {
    return emptyRoute(model, [
      routeDiagnostic(
        'invalid-input',
        error instanceof Error ? error.message : 'Invalid Brown 003 route input',
      ),
    ]);
  }

  if (
    !perpendicular(driver.axis, driven.axis)
    || !parallelSameDirection(guideA.axis, driven.axis)
    || !parallelSameDirection(guideB.axis, driven.axis)
  ) {
    return emptyRoute(model, [
      routeDiagnostic('invalid-geometry', 'Brown 003 requires perpendicular power axes and a parallel +axis guide pair'),
    ]);
  }

  const guideDelta = subtract(guideB.center, guideA.center);
  const guideRadialResidual = magnitude(reject(guideDelta, driven.axis));
  if (guideRadialResidual > GEOMETRY_TOLERANCE) {
    return emptyRoute(model, [routeDiagnostic('invalid-geometry', 'Brown 003 guide pulleys must be coaxial')]);
  }

  const guideMidpoint = midpoint(guideA.center, guideB.center);
  const guideFromDriver = subtract(guideMidpoint, driver.center);
  const guideAlongDriver = dot(guideFromDriver, driver.axis);
  const guideAlongUpperAxis = dot(guideFromDriver, driven.axis);
  const transverse = reject(reject(guideFromDriver, driver.axis), driven.axis);
  const transverseDirection = normalize(transverse);
  if (transverseDirection === undefined || !near(guideAlongUpperAxis, 0)) {
    return emptyRoute(model, [
      routeDiagnostic('invalid-geometry', 'Brown 003 guide midpoint must lie in the driver center plane with a nonzero riser'),
    ]);
  }

  const guideSide: Sense = guideAlongDriver >= 0 ? 1 : -1;
  if (!near(Math.abs(guideAlongDriver), guideA.radius) || !near(guideA.radius, guideB.radius)) {
    return emptyRoute(model, [
      routeDiagnostic('invalid-geometry', 'Brown 003 guide shaft must be offset from the driver axis by one guide radius'),
    ]);
  }

  const guideAOffset = dot(subtract(guideA.center, guideMidpoint), driven.axis);
  const guideBOffset = dot(subtract(guideB.center, guideMidpoint), driven.axis);
  if (!near(guideAOffset, -driver.radius) || !near(guideBOffset, driver.radius)) {
    return emptyRoute(model, [
      routeDiagnostic(
        'invalid-geometry',
        'Brown 003 guide middle planes must straddle the driver center plane by one driver radius',
      ),
    ]);
  }

  const drivenFromGuides = subtract(driven.center, guideMidpoint);
  const drivenAxialOffset = dot(drivenFromGuides, driven.axis);
  const drivenRiserOffset = dot(drivenFromGuides, transverseDirection);
  const upperCenterSpacing = dot(drivenFromGuides, driver.axis);
  const upperResidual = reject(
    reject(drivenFromGuides, driven.axis),
    driver.axis,
  );
  if (
    !near(drivenAxialOffset, 0)
    || !near(drivenRiserOffset, 0)
    || magnitude(upperResidual) > GEOMETRY_TOLERANCE
    || !(upperCenterSpacing > guideA.radius + driven.radius + GEOMETRY_TOLERANCE)
  ) {
    return emptyRoute(model, [
      routeDiagnostic('invalid-geometry', 'Brown 003 upper power pulley must share the guide riser and clear the guide pitch circles'),
    ]);
  }

  if (!(magnitude(transverse) > driver.radius + guideA.radius + GEOMETRY_TOLERANCE)) {
    return emptyRoute(model, [
      routeDiagnostic('invalid-geometry', 'Brown 003 guide riser does not clear the lower power pulley'),
    ]);
  }

  const guideAIntervalMax = guideAOffset + guideA.faceWidth / 2;
  const guideBIntervalMin = guideBOffset - guideB.faceWidth / 2;
  if (guideAIntervalMax > guideBIntervalMin + GEOMETRY_TOLERANCE) {
    return emptyRoute(model, [
      routeDiagnostic('invalid-geometry', 'Brown 003 side-by-side guide pulley faces overlap'),
    ]);
  }

  const driverDeparture = add(
    add(driver.center, scale(driver.axis, 2 * guideSide * guideA.radius)),
    scale(driven.axis, -driver.radius),
  );
  const guideAArrival = add(guideA.center, scale(driver.axis, guideSide * guideA.radius));
  const guideBDeparture = add(guideB.center, scale(driver.axis, -guideSide * guideB.radius));
  const driverArrival = add(driver.center, scale(driven.axis, driver.radius));

  const driverGuideA = directSpan(driverDeparture, guideAArrival);
  const guideBDriver = directSpan(guideBDeparture, driverArrival);
  if (driverGuideA === undefined || guideBDriver === undefined) {
    return emptyRoute(model, [routeDiagnostic('invalid-geometry', 'Brown 003 vertical guide span collapsed')]);
  }

  const guideAInDrivenPlane = add(
    guideA.center,
    scale(driven.axis, dot(subtract(driven.center, guideA.center), driven.axis)),
  );
  const drivenInGuideBPlane = add(
    driven.center,
    scale(driven.axis, dot(subtract(guideB.center, driven.center), driven.axis)),
  );
  const tangentBranch: Sense = guideSide === 1 ? -1 : 1;
  const guideADriven = ordinaryExternalTangent(
    guideAInDrivenPlane,
    guideA.radius,
    driven.center,
    driven.radius,
    driven.axis,
    tangentBranch,
  );
  const drivenGuideB = ordinaryExternalTangent(
    drivenInGuideBPlane,
    driven.radius,
    guideB.center,
    guideB.radius,
    driven.axis,
    tangentBranch,
  );
  if (guideADriven === undefined || drivenGuideB === undefined) {
    return emptyRoute(model, [
      routeDiagnostic('invalid-geometry', 'Brown 003 upper guide/driven pitch circles have no clear external tangent'),
    ]);
  }

  const contactByPulley = new Map(loop.contacts.map((contact) => [contact.pulley, contact]));
  const driverContact = contactByPulley.get('driver');
  const guideAContact = contactByPulley.get('guide-a');
  const drivenContact = contactByPulley.get('driven');
  const guideBContact = contactByPulley.get('guide-b');
  if (
    driverContact === undefined
    || guideAContact === undefined
    || drivenContact === undefined
    || guideBContact === undefined
  ) {
    return emptyRoute(model, [routeDiagnostic('invalid-model', 'Brown 003 route lost its contact semantics')]);
  }

  const trackInputs: Array<{
    pulley: ResolvedPulley;
    arrival: Vec3;
    departure: Vec3;
    incoming: Vec3;
    outgoing: Vec3;
    contact: FixedAxisBeltContactDefinition;
  }> = [
    {
      pulley: driver,
      arrival: driverArrival,
      departure: driverDeparture,
      incoming: guideBDriver.direction,
      outgoing: driverGuideA.direction,
      contact: driverContact,
    },
    {
      pulley: guideA,
      arrival: guideAArrival,
      departure: guideADriven.start,
      incoming: driverGuideA.direction,
      outgoing: guideADriven.direction,
      contact: guideAContact,
    },
    {
      pulley: driven,
      arrival: guideADriven.end,
      departure: drivenGuideB.start,
      incoming: guideADriven.direction,
      outgoing: drivenGuideB.direction,
      contact: drivenContact,
    },
    {
      pulley: guideB,
      arrival: drivenGuideB.end,
      departure: guideBDeparture,
      incoming: drivenGuideB.direction,
      outgoing: guideBDriver.direction,
      contact: guideBContact,
    },
  ];

  const tracks: Brown003PulleyTrack[] = [];
  for (const input of trackInputs) {
    const track = makeTrack(
      input.pulley,
      input.arrival,
      input.departure,
      input.incoming,
      input.outgoing,
      input.contact.sense,
      beltWidth,
    );
    if (isDiagnostic(track)) return emptyRoute(model, [track]);
    tracks.push(track);
  }

  return {
    model: model.id,
    beltWidth,
    spans: [
      makeSpan('driver-guide-a', 'driver', 'guide-a', driverGuideA),
      makeSpan('guide-a-driven', 'guide-a', 'driven', guideADriven),
      makeSpan('driven-guide-b', 'driven', 'guide-b', drivenGuideB),
      makeSpan('guide-b-driver', 'guide-b', 'driver', guideBDriver),
    ],
    tracks,
    diagnostics: [],
  };
}

function rotateAroundAxis(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  );
}

/**
 * Sample the Brown 003 belt-centerline tracking path on a pulley face; `t` is
 * clamped to [0, 1]. Axial movement in this sampled path is explicit lateral
 * tracking slip, not no-slip rolling contact.
 */
export function sampleBrown003PulleyTrack(track: Brown003PulleyTrack, t: number): Vec3 {
  const clamped = Math.max(0, Math.min(1, t));
  const arrivalRelative = subtract(track.arrival, track.center);
  const arrivalRadial = normalize(reject(arrivalRelative, track.axis));
  if (arrivalRadial === undefined) return track.arrival;

  const axialBlend = clamped * clamped * (3 - 2 * clamped);
  const axialOffset =
    track.arrivalAxialOffset
    + (track.departureAxialOffset - track.arrivalAxialOffset) * axialBlend;
  const radial = rotateAroundAxis(
    arrivalRadial,
    track.axis,
    track.signedWrapAngle * clamped,
  );
  return add(
    add(track.center, scale(track.axis, axialOffset)),
    scale(radial, track.radius),
  );
}
