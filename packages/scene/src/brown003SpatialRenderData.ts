import {
  buildBrown003MaterialPath,
  evaluateFixedAxisBeltContinuity,
  resolveBrown003MaterialPhase,
  sampleBrown003MaterialPath,
  solveBrown003Route,
  type Brown003MaterialPath,
  type Brown003PulleyTrack,
  type FixedAxisBeltContinuityRequest,
  type FixedAxisBeltContinuityResult,
} from '@atlasmechanica/kinematics';
import {
  canonicalNumber,
  isParameterReference,
  type FixedAxisPulleyId,
  type ModelState,
  type ParameterId,
  type QuantityValue,
  type ScalarSource,
  type SimulationModel,
} from '@atlasmechanica/model';

const BROWN_003_MODEL_ID = 'foundation:belt-drive:quarter-turn-guided';
const PATH_SAMPLES = 384;
const PULLEY_BOUND_SAMPLES = 32;
const CONSISTENCY_TOLERANCE = 1e-9;

export type Brown003SpatialVec3 = readonly [number, number, number];

export interface Brown003SpatialRendererRuntimeContext {
  readonly model: SimulationModel;
  readonly state: ModelState;
  readonly parameters?: Partial<Record<ParameterId, QuantityValue>>;
}

export interface Brown003SpatialPulleyRenderData {
  readonly pulley: FixedAxisPulleyId;
  readonly center: Brown003SpatialVec3;
  readonly axis: Brown003SpatialVec3;
  readonly referenceRadial: Brown003SpatialVec3;
  readonly pitchRadius: number;
  readonly faceWidth: number;
  readonly phaseAngle: number;
}

export interface Brown003SpatialRenderData {
  readonly model: string;
  readonly geometryKey: string;
  readonly path: Brown003MaterialPath;
  readonly beltPoints: readonly Brown003SpatialVec3[];
  readonly pulleys: readonly Brown003SpatialPulleyRenderData[];
  readonly materialArclength: number;
  readonly materialPoint: Brown003SpatialVec3;
  readonly bounds: Readonly<{
    min: Brown003SpatialVec3;
    max: Brown003SpatialVec3;
  }>;
}

function add(a: Brown003SpatialVec3, b: Brown003SpatialVec3): Brown003SpatialVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Brown003SpatialVec3, b: Brown003SpatialVec3): Brown003SpatialVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Brown003SpatialVec3, factor: number): Brown003SpatialVec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function dot(a: Brown003SpatialVec3, b: Brown003SpatialVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Brown003SpatialVec3, b: Brown003SpatialVec3): Brown003SpatialVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function magnitude(vector: Brown003SpatialVec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Brown003SpatialVec3, label: string): Brown003SpatialVec3 {
  const length = magnitude(vector);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new TypeError(`${label} must be a finite nonzero direction`);
  }
  return scale(vector, 1 / length);
}

function reject(vector: Brown003SpatialVec3, axis: Brown003SpatialVec3): Brown003SpatialVec3 {
  return subtract(vector, scale(axis, dot(vector, axis)));
}

function near(a: number, b: number): boolean {
  const scaleValue = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= CONSISTENCY_TOLERANCE * scaleValue;
}

function assertStateValue(
  actual: { value: number; unit: string } | undefined,
  expected: { value: number; unit: string } | undefined,
  label: string,
): void {
  if (actual === undefined || expected === undefined) {
    if (actual !== expected) {
      throw new TypeError(`Brown 003 spatial renderer runtime mismatch for ${label}`);
    }
    return;
  }
  if (actual.unit !== expected.unit || !near(actual.value, expected.value)) {
    throw new TypeError(`Brown 003 spatial renderer runtime mismatch for ${label}`);
  }
}

function resolvePositiveLength(
  source: ScalarSource,
  runtime: Brown003SpatialRendererRuntimeContext,
  label: string,
): number {
  let value: number;
  if (isParameterReference(source)) {
    const definition = runtime.model.parameters[source.parameter];
    if (definition === undefined || definition.kind !== 'length') {
      throw new TypeError(`${label} references a non-length parameter ${source.parameter}`);
    }
    const parameters = runtime.parameters ?? {};
    const authored = Object.prototype.hasOwnProperty.call(parameters, source.parameter)
      ? parameters[source.parameter]
      : definition.default;
    if (authored === undefined) {
      throw new TypeError(`${label} requires parameter ${source.parameter}`);
    }
    value = canonicalNumber(authored, 'length');
  } else {
    value = canonicalNumber(source, 'length');
  }
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`${label} must resolve to a finite positive length`);
  }
  return value;
}

function successfulContinuityForRuntime(
  runtime: Brown003SpatialRendererRuntimeContext,
): FixedAxisBeltContinuityResult {
  const system = runtime.model.systems.fixedAxisBelt;
  const driver = system?.pulleys.driver;
  if (system === undefined || driver === undefined) {
    throw new TypeError('Brown 003 spatial renderer requires the fixed-axis belt system');
  }
  const driverState = runtime.state.coordinates[driver.coordinate];
  if (driverState === undefined) {
    throw new TypeError(`Brown 003 spatial renderer is missing ${driver.coordinate}`);
  }

  const request: FixedAxisBeltContinuityRequest = {
    coordinates: { [driver.coordinate]: driverState.position },
  };
  if (runtime.state.configuration !== undefined) request.configuration = runtime.state.configuration;
  if (runtime.parameters !== undefined) request.parameters = runtime.parameters;
  if (driverState.velocity !== undefined) {
    request.rates = { [driver.coordinate]: driverState.velocity };
  }
  if (driverState.acceleration !== undefined) {
    request.accelerations = { [driver.coordinate]: driverState.acceleration };
  }

  const continuity = evaluateFixedAxisBeltContinuity(runtime.model, request);
  const continuityError = continuity.diagnostics.find((item) => item.severity === 'error');
  if (continuityError !== undefined) {
    throw new TypeError(`Brown 003 spatial renderer continuity failed: ${continuityError.message}`);
  }

  for (const contact of continuity.contactProfile) {
    const actual = runtime.state.coordinates[contact.coordinate];
    const expected = continuity.coordinates[contact.coordinate];
    if (actual === undefined || expected === undefined) {
      throw new TypeError(`Brown 003 spatial renderer is missing ${contact.coordinate}`);
    }
    assertStateValue(actual.position, expected.position, `${contact.coordinate} position`);
    assertStateValue(actual.velocity, expected.velocity, `${contact.coordinate} velocity`);
    assertStateValue(actual.acceleration, expected.acceleration, `${contact.coordinate} acceleration`);
  }

  const ratioSignal = runtime.state.signals['output-angular-ratio'];
  const expectedRatio = continuity.angularRatios.driven;
  if (
    ratioSignal?.type !== 'scalar'
    || expectedRatio === undefined
    || !near(ratioSignal.value.value, expectedRatio)
  ) {
    throw new TypeError('Brown 003 spatial renderer runtime mismatch for output-angular-ratio');
  }

  const travelSignal = runtime.state.signals['belt-travel'];
  if (
    travelSignal?.type !== 'scalar'
    || travelSignal.value.unit !== 'm'
    || continuity.beltTravel === undefined
    || !near(travelSignal.value.value, continuity.beltTravel)
  ) {
    throw new TypeError('Brown 003 spatial renderer runtime mismatch for belt-travel');
  }

  if (continuity.beltLinearSpeed !== undefined) {
    const speedSignal = runtime.state.signals['belt-linear-speed'];
    if (
      speedSignal?.type !== 'scalar'
      || speedSignal.value.unit !== 'm/s'
      || !near(speedSignal.value.value, continuity.beltLinearSpeed)
    ) {
      throw new TypeError('Brown 003 spatial renderer runtime mismatch for belt-linear-speed');
    }
  }

  return continuity;
}

function radialBasis(track: Brown003PulleyTrack): readonly [Brown003SpatialVec3, Brown003SpatialVec3] {
  const axis = normalize(track.axis, `${track.pulley} axis`);
  const radial = normalize(
    reject(subtract(track.arrival, track.center), axis),
    `${track.pulley} reference radial`,
  );
  return [radial, normalize(cross(axis, radial), `${track.pulley} tangent`)];
}

function geometryKey(
  path: Brown003MaterialPath,
  tracks: readonly Brown003PulleyTrack[],
  pulleys: readonly Brown003SpatialPulleyRenderData[],
): string {
  const faceWidths = new Map(pulleys.map((pulley) => [pulley.pulley, pulley.faceWidth]));
  const values: number[] = [path.totalLength];
  for (const track of tracks) {
    const faceWidth = faceWidths.get(track.pulley);
    if (faceWidth === undefined) {
      throw new TypeError(`Brown 003 spatial renderer is missing face width for ${track.pulley}`);
    }
    values.push(
      ...track.center,
      ...track.axis,
      track.radius,
      faceWidth,
      ...track.arrival,
      ...track.departure,
    );
  }
  return values.map((value) => value.toPrecision(15)).join('|');
}

function boundsFor(
  beltPoints: readonly Brown003SpatialVec3[],
  pulleys: readonly Brown003SpatialPulleyRenderData[],
): { min: Brown003SpatialVec3; max: Brown003SpatialVec3 } {
  const points: Brown003SpatialVec3[] = [...beltPoints];
  for (const pulley of pulleys) {
    const tangent = normalize(
      cross(pulley.axis, pulley.referenceRadial),
      `${pulley.pulley} tangent`,
    );
    for (const side of [-1, 1] as const) {
      const faceCenter = add(pulley.center, scale(pulley.axis, side * pulley.faceWidth / 2));
      for (let index = 0; index < PULLEY_BOUND_SAMPLES; index += 1) {
        const angle = index / PULLEY_BOUND_SAMPLES * Math.PI * 2;
        points.push(add(
          faceCenter,
          add(
            scale(pulley.referenceRadial, Math.cos(angle) * pulley.pitchRadius),
            scale(tangent, Math.sin(angle) * pulley.pitchRadius),
          ),
        ));
      }
    }
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!point.every(Number.isFinite)) {
      throw new TypeError('Brown 003 spatial renderer bounds contain a non-finite point');
    }
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    minZ = Math.min(minZ, point[2]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
    maxZ = Math.max(maxZ, point[2]);
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Resolve the exact spatial geometry and pose that Brown 003's Three.js view is
 * allowed to render. The supplied adapter state is rechecked against the same
 * parameter set before route/material geometry is accepted, so a same-model
 * state cannot be replayed against a different spatial route.
 *
 * This is renderer-neutral scene semantics. It does not create Three.js
 * objects or add friction, traction, tension, adhesion, pressure, creep, or
 * dynamic-stability claims.
 */
export function resolveBrown003SpatialRenderData(
  runtime: Brown003SpatialRendererRuntimeContext,
): Brown003SpatialRenderData {
  if (runtime.model.id !== BROWN_003_MODEL_ID || runtime.state.model !== runtime.model.id) {
    throw new TypeError('Brown 003 spatial renderer requires the canonical Brown 003 model and matching state');
  }
  const stateError = runtime.state.diagnostics.find((item) => item.severity === 'error');
  if (stateError !== undefined) {
    throw new TypeError(`Brown 003 spatial renderer requires a successful adapter state: ${stateError.message}`);
  }

  const continuity = successfulContinuityForRuntime(runtime);
  const route = solveBrown003Route(
    runtime.model,
    runtime.parameters === undefined ? {} : { parameters: runtime.parameters },
  );
  const routeError = route.diagnostics.find((item) => item.severity === 'error');
  if (routeError !== undefined) {
    throw new TypeError(`Brown 003 spatial renderer route failed: ${routeError.message}`);
  }
  const material = buildBrown003MaterialPath(route);
  const materialError = material.diagnostics.find((item) => item.severity === 'error');
  if (materialError !== undefined || material.path === undefined) {
    throw new TypeError(
      `Brown 003 spatial renderer material path failed: ${materialError?.message ?? 'missing path'}`,
    );
  }

  const materialPath = material.path;
  const materialArclength = resolveBrown003MaterialPhase(materialPath, continuity);
  const materialPoint = sampleBrown003MaterialPath(materialPath, materialArclength).position;
  const beltPoints = Array.from({ length: PATH_SAMPLES + 1 }, (_, index) => {
    return sampleBrown003MaterialPath(
      materialPath,
      materialPath.totalLength * (index / PATH_SAMPLES),
    ).position;
  });

  const pulleys = route.tracks.map((track): Brown003SpatialPulleyRenderData => {
    const pulley = runtime.model.systems.fixedAxisBelt?.pulleys[track.pulley];
    if (pulley === undefined) throw new TypeError(`Missing Brown 003 pulley ${track.pulley}`);
    if (pulley.faceWidth === undefined) {
      throw new TypeError(`Brown 003 spatial renderer requires finite face width for ${track.pulley}`);
    }
    const coordinate = runtime.state.coordinates[pulley.coordinate];
    if (coordinate === undefined) {
      throw new TypeError(`Missing finite Brown 003 phase ${pulley.coordinate}`);
    }
    const phaseAngle = canonicalNumber(coordinate.position, 'angle');
    if (!Number.isFinite(phaseAngle)) {
      throw new TypeError(`Missing finite Brown 003 phase ${pulley.coordinate}`);
    }
    const [referenceRadial] = radialBasis(track);
    return {
      pulley: track.pulley,
      center: track.center,
      axis: normalize(track.axis, `${track.pulley} axis`),
      referenceRadial,
      pitchRadius: track.radius,
      faceWidth: resolvePositiveLength(
        pulley.faceWidth,
        runtime,
        `${track.pulley} face width`,
      ),
      phaseAngle,
    };
  });

  return {
    model: runtime.model.id,
    geometryKey: geometryKey(materialPath, route.tracks, pulleys),
    path: materialPath,
    beltPoints,
    pulleys,
    materialArclength,
    materialPoint,
    bounds: boundsFor(beltPoints, pulleys),
  };
}
