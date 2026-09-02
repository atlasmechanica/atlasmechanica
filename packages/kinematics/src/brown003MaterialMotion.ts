import {
  canonicalNumber,
  type Diagnostic,
  type FixedAxisPulleyId,
  type SimulationModel,
} from '@atlasmechanica/model';

import {
  sampleBrown003PulleyTrack,
  type Brown003PulleyTrack,
  type Brown003RouteResult,
  type Brown003RouteSpan,
} from './brown003Route.js';
import type { FixedAxisBeltContinuityResult } from './fixedAxisBeltContinuity.js';

type Vec3 = readonly [number, number, number];

const BROWN_003_LOOP_ID = 'main-belt';
const TRACK_ARCLENGTH_STEPS = 64;
const TRACK_INVERSION_STEPS = 36;
const CONTINUITY_COMPATIBILITY_TOLERANCE = 1e-8;

export type Brown003MaterialPathSegment =
  | {
      kind: 'pulley-track';
      id: string;
      startArclength: number;
      length: number;
      track: Brown003PulleyTrack;
    }
  | {
      kind: 'span';
      id: Brown003RouteSpan['id'];
      startArclength: number;
      length: number;
      span: Brown003RouteSpan;
    };

export interface Brown003MaterialPath {
  model: string;
  /** Brown fixed-axis belt loop this routed path represents. */
  loop: string;
  /** Ordered pulley/contact-sense profile encoded by the solved routed tracks. */
  contactProfile: readonly Readonly<{
    pulley: FixedAxisPulleyId;
    sense: 1 | -1;
  }>[];
  /** Closed routed-centerline length in meters. */
  totalLength: number;
  /** Ordered in authored positive loop-travel direction. */
  segments: readonly Brown003MaterialPathSegment[];
}

export interface Brown003MaterialPathResult {
  model: string;
  path?: Brown003MaterialPath;
  diagnostics: Diagnostic[];
}

export interface Brown003MaterialPathSample {
  /** Wrapped loop arclength in [0, totalLength), in meters. */
  arclength: number;
  segmentIndex: number;
  segmentId: string;
  segmentKind: Brown003MaterialPathSegment['kind'];
  localArclength: number;
  position: Vec3;
  /** Unit tangent in authored positive loop-travel direction. */
  tangent: Vec3;
  pulley?: FixedAxisPulleyId;
}

export interface Brown003MaterialMotionSample extends Brown003MaterialPathSample {
  /** Prescribed belt-material velocity along the routed centerline, in m/s. */
  materialVelocity: Vec3;
  /** Rotating pulley-surface velocity at this routed point, in m/s. */
  pulleySurfaceVelocity?: Vec3;
  /** materialVelocity - pulleySurfaceVelocity, in m/s. */
  relativeSlipVelocity?: Vec3;
  relativeSlipSpeed?: number;
}

function diagnostic(
  message: string,
  context?: Diagnostic['context'],
): Diagnostic {
  const item: Diagnostic = { severity: 'error', code: 'invalid-input', message };
  if (context !== undefined) item.context = context;
  return item;
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

function rotateAroundAxis(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  );
}

function trackDerivative(track: Brown003PulleyTrack, t: number): Vec3 {
  const arrivalRelative = subtract(track.arrival, track.center);
  const arrivalRadial = normalize(reject(arrivalRelative, track.axis));
  if (arrivalRadial === undefined) {
    throw new TypeError(`${track.pulley} track has no finite arrival radial direction`);
  }

  const radial = rotateAroundAxis(
    arrivalRadial,
    track.axis,
    track.signedWrapAngle * t,
  );
  const circumferential = scale(
    cross(track.axis, radial),
    track.radius * track.signedWrapAngle,
  );
  const axialRate =
    (track.departureAxialOffset - track.arrivalAxialOffset)
    * 6
    * t
    * (1 - t);
  return add(circumferential, scale(track.axis, axialRate));
}

function trackSpeed(track: Brown003PulleyTrack, t: number): number {
  return magnitude(trackDerivative(track, t));
}

function integrateTrackLength(track: Brown003PulleyTrack, endT = 1): number {
  if (endT <= 0) return 0;
  if (endT >= 1) endT = 1;

  const steps = TRACK_ARCLENGTH_STEPS;
  const h = endT / steps;
  let sum = trackSpeed(track, 0) + trackSpeed(track, endT);
  for (let index = 1; index < steps; index += 1) {
    sum += (index % 2 === 0 ? 2 : 4) * trackSpeed(track, index * h);
  }
  return (h / 3) * sum;
}

function trackParameterAtArclength(
  track: Brown003PulleyTrack,
  localArclength: number,
  trackLength: number,
): number {
  if (localArclength <= 0) return 0;
  if (localArclength >= trackLength) return 1;

  let low = 0;
  let high = 1;
  for (let index = 0; index < TRACK_INVERSION_STEPS; index += 1) {
    const middle = (low + high) / 2;
    if (integrateTrackLength(track, middle) < localArclength) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function wrapArclength(value: number, totalLength: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('Brown 003 material arclength must be finite');
  }
  if (!finitePositive(totalLength)) {
    throw new RangeError('Brown 003 material path length must be finite and positive');
  }
  const wrapped = ((value % totalLength) + totalLength) % totalLength;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function closeEnough(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= CONTINUITY_COMPATIBILITY_TOLERANCE * scale;
}

/**
 * Verify that the continuity oracle and routed path came from the same Brown
 * loop, ordered contact-sense profile, and absolute resolved pitch radii.
 * Angular ratios alone are not sufficient provenance because flipping every
 * contact sense preserves those ratios while reversing signed belt travel, and
 * uniformly scaling every radius preserves the ratios while changing travel
 * and linear speed.
 */
function assertPathContinuityCompatibility(
  path: Brown003MaterialPath,
  continuity: FixedAxisBeltContinuityResult,
): void {
  if (continuity.loop !== path.loop) {
    throw new TypeError('Brown 003 material path and continuity result use different loops');
  }

  if (
    continuity.contactProfile.length !== path.contactProfile.length
    || path.contactProfile.some((expected, index) => {
      const actual = continuity.contactProfile[index];
      return actual === undefined
        || actual.pulley !== expected.pulley
        || actual.sense !== expected.sense;
    })
  ) {
    throw new TypeError(
      'Brown 003 material path and continuity result use incompatible loop contact semantics',
    );
  }

  for (const segment of path.segments) {
    if (segment.kind !== 'pulley-track') continue;
    const resolvedRadius = continuity.resolvedPitchRadii[segment.track.pulley];
    if (!finitePositive(resolvedRadius ?? Number.NaN)) {
      throw new TypeError(
        `Brown 003 material motion is missing resolved pitch-radius provenance for ${segment.track.pulley}`,
      );
    }
    if (!closeEnough(resolvedRadius ?? Number.NaN, segment.track.radius)) {
      throw new TypeError(
        'Brown 003 material path and continuity result use incompatible resolved pitch radii',
      );
    }
  }
}

/**
 * Build the closed routed centerline used by the prescribed Brown 003 material
 * motion contract.
 *
 * This composes the already-solved route only. It does not add a friction,
 * tension, adhesion, elastic-creep, or dynamic contact model.
 */
export function buildBrown003MaterialPath(
  route: Brown003RouteResult,
): Brown003MaterialPathResult {
  if (route.diagnostics.some((item) => item.severity === 'error')) {
    return { model: route.model, diagnostics: [...route.diagnostics] };
  }

  const tracks = new Map(route.tracks.map((track) => [track.pulley, track]));
  const spans = new Map(route.spans.map((span) => [span.id, span]));
  const specs: ReadonlyArray<
    | { kind: 'pulley-track'; pulley: FixedAxisPulleyId }
    | { kind: 'span'; id: Brown003RouteSpan['id'] }
  > = [
    { kind: 'pulley-track', pulley: 'driver' },
    { kind: 'span', id: 'driver-guide-a' },
    { kind: 'pulley-track', pulley: 'guide-a' },
    { kind: 'span', id: 'guide-a-driven' },
    { kind: 'pulley-track', pulley: 'driven' },
    { kind: 'span', id: 'driven-guide-b' },
    { kind: 'pulley-track', pulley: 'guide-b' },
    { kind: 'span', id: 'guide-b-driver' },
  ];

  const segments: Brown003MaterialPathSegment[] = [];
  const contactProfile: Array<{ pulley: FixedAxisPulleyId; sense: 1 | -1 }> = [];
  let cursor = 0;
  try {
    for (const spec of specs) {
      if (spec.kind === 'span') {
        const span = spans.get(spec.id);
        if (span === undefined) throw new TypeError(`Missing Brown 003 route span ${spec.id}`);
        if (!finitePositive(span.length)) {
          throw new RangeError(`Brown 003 route span ${spec.id} has invalid length`);
        }
        segments.push({
          kind: 'span',
          id: span.id,
          startArclength: cursor,
          length: span.length,
          span,
        });
        cursor += span.length;
        continue;
      }

      const track = tracks.get(spec.pulley);
      if (track === undefined) throw new TypeError(`Missing Brown 003 pulley track ${spec.pulley}`);
      if (!Number.isFinite(track.signedWrapAngle) || track.signedWrapAngle === 0) {
        throw new RangeError(`Brown 003 pulley track ${spec.pulley} has invalid travel sense`);
      }
      const length = integrateTrackLength(track);
      if (!finitePositive(length)) {
        throw new RangeError(`Brown 003 pulley track ${spec.pulley} has invalid length`);
      }
      segments.push({
        kind: 'pulley-track',
        id: `track:${track.pulley}`,
        startArclength: cursor,
        length,
        track,
      });
      contactProfile.push({
        pulley: track.pulley,
        sense: track.signedWrapAngle > 0 ? 1 : -1,
      });
      cursor += length;
    }
  } catch (error) {
    return {
      model: route.model,
      diagnostics: [
        diagnostic(
          error instanceof Error ? error.message : 'Invalid Brown 003 material path input',
        ),
      ],
    };
  }

  if (!finitePositive(cursor)) {
    return {
      model: route.model,
      diagnostics: [diagnostic('Brown 003 material path has no finite positive loop length')],
    };
  }

  return {
    model: route.model,
    path: {
      model: route.model,
      loop: BROWN_003_LOOP_ID,
      contactProfile,
      totalLength: cursor,
      segments,
    },
    diagnostics: [],
  };
}

/** Sample a closed Brown 003 routed centerline by signed loop arclength. */
export function sampleBrown003MaterialPath(
  path: Brown003MaterialPath,
  arclength: number,
): Brown003MaterialPathSample {
  const wrapped = wrapArclength(arclength, path.totalLength);
  let segmentIndex = path.segments.length - 1;
  for (let index = 0; index < path.segments.length; index += 1) {
    const candidate = path.segments[index];
    if (candidate !== undefined && wrapped < candidate.startArclength + candidate.length) {
      segmentIndex = index;
      break;
    }
  }

  const segment = path.segments[segmentIndex];
  if (segment === undefined) throw new TypeError('Brown 003 material path has no segments');
  const localArclength = wrapped - segment.startArclength;

  if (segment.kind === 'span') {
    const tangent = normalize(subtract(segment.span.end, segment.span.start));
    if (tangent === undefined) throw new TypeError(`${segment.id} has no finite tangent`);
    return {
      arclength: wrapped,
      segmentIndex,
      segmentId: segment.id,
      segmentKind: segment.kind,
      localArclength,
      position: add(segment.span.start, scale(tangent, localArclength)),
      tangent,
    };
  }

  const t = trackParameterAtArclength(segment.track, localArclength, segment.length);
  const tangent = normalize(trackDerivative(segment.track, t));
  if (tangent === undefined) throw new TypeError(`${segment.id} has no finite tangent`);
  return {
    arclength: wrapped,
    segmentIndex,
    segmentId: segment.id,
    segmentKind: segment.kind,
    localArclength,
    position: sampleBrown003PulleyTrack(segment.track, t),
    tangent,
    pulley: segment.track.pulley,
  };
}

/**
 * Advance a reference material marker using the lumped oracle's signed belt
 * travel. This is loop phase only; it is not a local no-slip assertion.
 */
export function resolveBrown003MaterialPhase(
  path: Brown003MaterialPath,
  continuity: FixedAxisBeltContinuityResult,
  referenceArclength = 0,
): number {
  if (continuity.model !== path.model) {
    throw new TypeError('Brown 003 material path and continuity result use different models');
  }
  if (continuity.diagnostics.some((item) => item.severity === 'error')) {
    throw new TypeError('Brown 003 material phase requires a successful continuity result');
  }
  assertPathContinuityCompatibility(path, continuity);
  if (continuity.beltTravel === undefined || !Number.isFinite(continuity.beltTravel)) {
    throw new TypeError('Brown 003 material phase requires finite lumped belt travel');
  }
  return wrapArclength(referenceArclength + continuity.beltTravel, path.totalLength);
}

/**
 * Sample prescribed material velocity and, on pulley tracks, the local rotating
 * surface velocity and their relative slip vector.
 *
 * The relative vector is a kinematic difference only. It is not a friction,
 * traction, adhesion-zone, pressure, or elastic-creep solution. Negative rates
 * are evaluated algebraically but do not certify that reverse operation is
 * physically self-tracking.
 *
 * The replay model contributes identity only. Pulley-to-coordinate bindings
 * come from the successful continuity result so another same-id model cannot
 * redirect the surface-velocity lookup.
 */
export function sampleBrown003MaterialMotion(
  model: SimulationModel,
  path: Brown003MaterialPath,
  continuity: FixedAxisBeltContinuityResult,
  arclength: number,
): Brown003MaterialMotionSample {
  if (model.id !== path.model || continuity.model !== path.model) {
    throw new TypeError('Brown 003 material motion inputs use different models');
  }
  if (continuity.diagnostics.some((item) => item.severity === 'error')) {
    throw new TypeError('Brown 003 material motion requires a successful continuity result');
  }
  assertPathContinuityCompatibility(path, continuity);
  if (continuity.beltLinearSpeed === undefined || !Number.isFinite(continuity.beltLinearSpeed)) {
    throw new TypeError('Brown 003 material motion requires a finite driver rate');
  }

  const sample = sampleBrown003MaterialPath(path, arclength);
  const materialVelocity = scale(sample.tangent, continuity.beltLinearSpeed);
  const segment = path.segments[sample.segmentIndex];
  if (segment === undefined || segment.kind === 'span') {
    return { ...sample, materialVelocity };
  }

  const contact = continuity.contactProfile.find(
    (item) => item.pulley === segment.track.pulley,
  );
  if (contact === undefined) {
    throw new TypeError(
      `Missing Brown 003 coordinate provenance for ${segment.track.pulley}`,
    );
  }
  const angularVelocity = continuity.coordinates[contact.coordinate]?.velocity;
  if (angularVelocity === undefined) {
    throw new TypeError(`Missing Brown 003 angular velocity for ${segment.track.pulley}`);
  }
  const angularRate = canonicalNumber(angularVelocity, 'angular-velocity');
  if (!Number.isFinite(angularRate)) {
    throw new RangeError(`Brown 003 angular velocity for ${segment.track.pulley} must be finite`);
  }

  const radialPosition = reject(
    subtract(sample.position, segment.track.center),
    segment.track.axis,
  );
  const pulleySurfaceVelocity = cross(
    scale(segment.track.axis, angularRate),
    radialPosition,
  );
  const relativeSlipVelocity = subtract(materialVelocity, pulleySurfaceVelocity);

  return {
    ...sample,
    materialVelocity,
    pulleySurfaceVelocity,
    relativeSlipVelocity,
    relativeSlipSpeed: magnitude(relativeSlipVelocity),
  };
}
