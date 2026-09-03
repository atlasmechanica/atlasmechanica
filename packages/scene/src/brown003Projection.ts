import {
  buildBrown003MaterialPath,
  sampleBrown003MaterialPath,
  solveBrown003Route,
  type Brown003MaterialPath,
  type Brown003PulleyTrack,
} from '@atlasmechanica/kinematics';
import {
  canonicalNumber,
  type FixedAxisPulleyId,
} from '@atlasmechanica/model';

import type { SceneBuildOptions } from './buildMechanismScene.js';
import {
  assertMechanismScene,
  type MechanismScene,
  type ScenePrimitive,
  type Vec2,
} from './types.js';

const BROWN_003_MODEL_ID = 'foundation:belt-drive:quarter-turn-guided';
const PULLEY_SAMPLES = 64;
const BELT_SAMPLES = 256;
const PROJECTION_Z_TO_X = 0.55;
const PROJECTION_Z_TO_Y = -0.25;

type Vec3 = readonly [number, number, number];

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
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

function magnitude(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vec3): Vec3 {
  const length = magnitude(vector);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new TypeError('Brown 003 projection requires a finite nonzero direction');
  }
  return scale(vector, 1 / length);
}

function reject(vector: Vec3, axis: Vec3): Vec3 {
  return subtract(vector, scale(axis, dot(vector, axis)));
}

/**
 * Deterministic oblique projection used only for the Brown 003 reference view.
 * The physical route remains three-dimensional; this transform is presentation
 * geometry and is never fed back into the model or solver.
 */
function project(point: Vec3): Vec2 {
  return {
    x: point[0] + point[2] * PROJECTION_Z_TO_X,
    y: point[1] + point[2] * PROJECTION_Z_TO_Y,
  };
}

function radialBasis(track: Brown003PulleyTrack): readonly [Vec3, Vec3] {
  const radial = normalize(reject(subtract(track.arrival, track.center), track.axis));
  const tangent = normalize(cross(track.axis, radial));
  return [radial, tangent];
}

function pulleyPitchCircle(track: Brown003PulleyTrack): Vec2[] {
  const [radial, tangent] = radialBasis(track);
  return Array.from({ length: PULLEY_SAMPLES + 1 }, (_, index) => {
    const angle = (index / PULLEY_SAMPLES) * Math.PI * 2;
    const point = add(
      track.center,
      add(
        scale(radial, track.radius * Math.cos(angle)),
        scale(tangent, track.radius * Math.sin(angle)),
      ),
    );
    return project(point);
  });
}

function pulleyPhasePoint(track: Brown003PulleyTrack, angle: number): Vec2 {
  const [radial, tangent] = radialBasis(track);
  return project(add(
    track.center,
    add(
      scale(radial, track.radius * Math.cos(angle)),
      scale(tangent, track.radius * Math.sin(angle)),
    ),
  ));
}

function projectedBelt(path: Brown003MaterialPath): Vec2[] {
  return Array.from({ length: BELT_SAMPLES + 1 }, (_, index) => {
    const sample = sampleBrown003MaterialPath(
      path,
      path.totalLength * (index / BELT_SAMPLES),
    );
    return project(sample.position);
  });
}

function pulleyAngle(
  options: SceneBuildOptions,
  pulleyId: FixedAxisPulleyId,
): number {
  const pulley = options.model.systems.fixedAxisBelt?.pulleys[pulleyId];
  if (pulley === undefined) throw new TypeError(`Missing Brown 003 pulley ${pulleyId}`);
  const coordinate = options.state.coordinates[pulley.coordinate];
  if (coordinate === undefined) {
    throw new TypeError(`Missing Brown 003 coordinate state ${pulley.coordinate}`);
  }
  return canonicalNumber(coordinate.position, 'angle');
}

function fittedViewport(points: readonly Vec2[]) {
  if (points.length === 0) throw new TypeError('Brown 003 projection has no points');
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError('Brown 003 projection contains a non-finite point');
    }
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0)) {
    throw new TypeError('Brown 003 projection has a degenerate viewport');
  }
  const padding = Math.max(width, height) * 0.10;
  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minY: minY - padding,
    maxY: maxY + padding,
  };
}

/**
 * Build a truthful 2D projection of the solved Brown 003 spatial mechanism.
 *
 * Pulley rims and the belt centerline are sampled from their real 3D geometry
 * and only then projected into 2D. This is not a planar belt approximation and
 * it makes no additional contact, traction, or no-slip claim.
 */
export function buildBrown003ProjectionScene(options: SceneBuildOptions): MechanismScene {
  if (options.model.id !== BROWN_003_MODEL_ID || options.state.model !== options.model.id) {
    throw new TypeError('Brown 003 projection requires the canonical spatial belt model and state');
  }
  const stateError = options.state.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (stateError !== undefined) {
    throw new TypeError(`Brown 003 projection requires a successful adapter state: ${stateError.message}`);
  }

  const route = solveBrown003Route(options.model, { parameters: options.parameters });
  const routeError = route.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (routeError !== undefined) {
    throw new TypeError(`Brown 003 projection route failed: ${routeError.message}`);
  }
  const material = buildBrown003MaterialPath(route);
  const materialError = material.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (materialError !== undefined || material.path === undefined) {
    throw new TypeError(
      `Brown 003 projection material path failed: ${materialError?.message ?? 'missing path'}`,
    );
  }

  const beltPoints = projectedBelt(material.path);
  const primitives: ScenePrimitive[] = [{
    id: 'brown003-belt-path',
    type: 'polyline',
    layer: 'mechanism',
    styles: ['belt'],
    points: beltPoints,
    width: 3.5,
    ariaLabel: 'Brown 003 projected spatial belt centerline',
  }];
  const viewportPoints: Vec2[] = [...beltPoints];

  for (const track of route.tracks) {
    const center = project(track.center);
    const rim = pulleyPitchCircle(track);
    const phase = pulleyPhasePoint(track, pulleyAngle(options, track.pulley));
    viewportPoints.push(...rim, center, phase);
    primitives.push(
      {
        id: `brown003-pulley-${track.pulley}`,
        type: 'polyline',
        layer: 'mechanism',
        styles: ['pulley'],
        points: rim,
        width: 2.5,
        ariaLabel: `${track.pulley} projected pitch circle`,
      },
      {
        id: `brown003-phase-${track.pulley}`,
        type: 'segment',
        layer: 'mechanism',
        styles: ['pulley'],
        a: center,
        b: phase,
        width: 2,
        ariaLabel: `${track.pulley} angular phase`,
      },
      {
        id: `brown003-label-${track.pulley}`,
        type: 'label',
        layer: 'annotation',
        styles: ['label'],
        at: { x: center.x + 0.008, y: center.y + 0.008 },
        text: track.pulley,
      },
    );
  }

  const beltTravel = options.state.signals['belt-travel'];
  const viewport = fittedViewport(viewportPoints);
  if (beltTravel?.type === 'scalar') {
    const marker = project(
      sampleBrown003MaterialPath(
        material.path,
        canonicalNumber(beltTravel.value, 'length'),
      ).position,
    );
    const markerRadius = Math.min(
      viewport.maxX - viewport.minX,
      viewport.maxY - viewport.minY,
    ) * 0.012;
    primitives.push({
      id: 'brown003-material-marker',
      type: 'circle',
      layer: 'annotation',
      styles: ['tracer'],
      center: marker,
      radius: markerRadius,
      ariaLabel: 'Prescribed Brown 003 belt material phase marker',
    });
  }

  const scene: MechanismScene = {
    id: 'brown003-spatial-projection',
    title: 'Brown 003 · spatial reference projection',
    viewport,
    primitives,
  };
  if (options.selectedId !== undefined) scene.selectedId = options.selectedId;
  assertMechanismScene(scene);
  return scene;
}
