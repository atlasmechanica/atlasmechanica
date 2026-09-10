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
import type {
  FixedAxisPulleyId,
  ModelState,
  ParameterId,
  QuantityValue,
  SimulationModel,
} from '@atlasmechanica/model';
import type { MechanismScene } from '@atlasmechanica/scene';
import {
  AmbientLight,
  BoxGeometry,
  Curve,
  CylinderGeometry,
  DirectionalLight,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Quaternion,
  Scene as ThreeScene,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type {
  ThreeMechanismRenderer,
  ThreeMechanismRendererOptions,
} from './index.js';

const BROWN_003_MODEL_ID = 'foundation:belt-drive:quarter-turn-guided';
const BROWN_003_SCENE_ID = 'brown003-spatial-projection';
const PATH_SAMPLES = 384;
const PULLEY_BOUND_SAMPLES = 32;
const PAPER = 0xfbfaf6;
const RUST = 0xc45a35;
const ROUTE_BLUE = 0x2f668e;
const DARK_METAL = 0x444846;
const MARKER = 0xd8a13b;
const CONSISTENCY_TOLERANCE = 1e-9;

type Vec3 = readonly [number, number, number];

export interface Brown003SpatialRendererRuntimeContext {
  readonly model: SimulationModel;
  readonly state: ModelState;
  readonly parameters?: Partial<Record<ParameterId, QuantityValue>>;
}

export interface Brown003SpatialPulleyRenderData {
  readonly pulley: FixedAxisPulleyId;
  readonly center: Vec3;
  readonly axis: Vec3;
  readonly referenceRadial: Vec3;
  readonly pitchRadius: number;
  readonly faceWidth: number;
  readonly phaseAngle: number;
}

export interface Brown003SpatialRenderData {
  readonly model: string;
  readonly geometryKey: string;
  readonly path: Brown003MaterialPath;
  readonly beltPoints: readonly Vec3[];
  readonly pulleys: readonly Brown003SpatialPulleyRenderData[];
  readonly materialArclength: number;
  readonly materialPoint: Vec3;
  readonly bounds: Readonly<{
    min: Vec3;
    max: Vec3;
  }>;
}

export interface Brown003SpatialRenderer extends Omit<ThreeMechanismRenderer, 'update'> {
  update(
    scene: MechanismScene,
    runtime?: Brown003SpatialRendererRuntimeContext,
  ): void;
}

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

function normalize(vector: Vec3, label: string): Vec3 {
  const length = magnitude(vector);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new TypeError(`${label} must be a finite nonzero direction`);
  }
  return scale(vector, 1 / length);
}

function reject(vector: Vec3, axis: Vec3): Vec3 {
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
  if (runtime.state.configuration !== undefined) {
    request.configuration = runtime.state.configuration;
  }
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
  if (ratioSignal?.type !== 'scalar' || expectedRatio === undefined || !near(ratioSignal.value.value, expectedRatio)) {
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

function radialBasis(track: Brown003PulleyTrack): readonly [Vec3, Vec3] {
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
): string {
  const values: number[] = [path.totalLength];
  for (const track of tracks) {
    values.push(
      ...track.center,
      ...track.axis,
      track.radius,
      track.faceWidth,
      ...track.arrival,
      ...track.departure,
    );
  }
  return values.map((value) => value.toPrecision(15)).join('|');
}

function boundsFor(
  beltPoints: readonly Vec3[],
  tracks: readonly Brown003PulleyTrack[],
): { min: Vec3; max: Vec3 } {
  const points: Vec3[] = [...beltPoints];
  for (const track of tracks) {
    const [radial, tangent] = radialBasis(track);
    const axis = normalize(track.axis, `${track.pulley} axis`);
    for (const side of [-1, 1] as const) {
      const faceCenter = add(track.center, scale(axis, side * track.faceWidth / 2));
      for (let index = 0; index < PULLEY_BOUND_SAMPLES; index += 1) {
        const angle = index / PULLEY_BOUND_SAMPLES * Math.PI * 2;
        points.push(add(
          faceCenter,
          add(
            scale(radial, Math.cos(angle) * track.radius),
            scale(tangent, Math.sin(angle) * track.radius),
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
 */
export function resolveBrown003SpatialRenderData(
  runtime: Brown003SpatialRendererRuntimeContext,
): Brown003SpatialRenderData {
  if (runtime.model.id !== BROWN_003_MODEL_ID || runtime.state.model !== runtime.model.id) {
    throw new TypeError('Brown 003 spatial renderer requires the canonical model and matching state');
  }
  const stateError = runtime.state.diagnostics.find((item) => item.severity === 'error');
  if (stateError !== undefined) {
    throw new TypeError(`Brown 003 spatial renderer requires a successful adapter state: ${stateError.message}`);
  }

  const continuity = successfulContinuityForRuntime(runtime);
  const routeRequest = runtime.parameters === undefined ? {} : { parameters: runtime.parameters };
  const route = solveBrown003Route(runtime.model, routeRequest);
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
    const coordinate = runtime.state.coordinates[pulley.coordinate];
    if (coordinate === undefined || !Number.isFinite(coordinate.position.value)) {
      throw new TypeError(`Missing finite Brown 003 phase ${pulley.coordinate}`);
    }
    const [referenceRadial] = radialBasis(track);
    return {
      pulley: track.pulley,
      center: track.center,
      axis: normalize(track.axis, `${track.pulley} axis`),
      referenceRadial,
      pitchRadius: track.radius,
      faceWidth: track.faceWidth,
      phaseAngle: coordinate.position.value,
    };
  });

  return {
    model: runtime.model.id,
    geometryKey: geometryKey(materialPath, route.tracks),
    path: materialPath,
    beltPoints,
    pulleys,
    materialArclength,
    materialPoint,
    bounds: boundsFor(beltPoints, route.tracks),
  };
}

class PolylineCurve3 extends Curve<Vector3> {
  private readonly points: Vector3[];
  private readonly cumulative: number[];
  private readonly totalLength: number;

  constructor(points: readonly Vec3[], closed: boolean) {
    super();
    const normalized = points.map((point) => new Vector3(...point));
    if (closed && normalized.length > 2) {
      const first = normalized[0];
      const last = normalized.at(-1);
      if (first !== undefined && last !== undefined && first.distanceToSquared(last) > 1e-16) {
        normalized.push(first.clone());
      }
    }
    this.points = normalized;
    this.cumulative = [0];
    let total = 0;
    for (let index = 0; index < normalized.length - 1; index += 1) {
      const a = normalized[index];
      const b = normalized[index + 1];
      if (a === undefined || b === undefined) continue;
      total += a.distanceTo(b);
      this.cumulative.push(total);
    }
    this.totalLength = total;
  }

  override getPoint(t: number, target = new Vector3()): Vector3 {
    if (this.points.length === 0) return target.set(0, 0, 0);
    if (this.points.length === 1 || !(this.totalLength > 0)) {
      return target.copy(this.points[0] ?? new Vector3());
    }
    const distance = MathUtils.clamp(t, 0, 1) * this.totalLength;
    for (let index = 0; index < this.cumulative.length - 1; index += 1) {
      const start = this.cumulative[index] ?? 0;
      const end = this.cumulative[index + 1] ?? start;
      if (distance > end && index < this.cumulative.length - 2) continue;
      const a = this.points[index];
      const b = this.points[index + 1];
      if (a === undefined || b === undefined) break;
      const span = end - start;
      return target.copy(a).lerp(b, span > 0 ? MathUtils.clamp((distance - start) / span, 0, 1) : 0);
    }
    return target.copy(this.points.at(-1) ?? new Vector3());
  }
}

interface PulleyCache {
  group: Group;
  baseQuaternion: Quaternion;
}

function setPulleyPhase(cache: PulleyCache, angle: number): void {
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);
  cache.group.quaternion.copy(cache.baseQuaternion).multiply(rotation);
}

function buildPulleyGroup(
  data: Brown003SpatialPulleyRenderData,
  pulleyMaterial: MeshStandardMaterial,
  axleMaterial: MeshStandardMaterial,
): PulleyCache {
  const group = new Group();
  group.name = `brown003-pulley-${data.pulley}`;
  group.position.set(...data.center);

  const radial = new Vector3(...data.referenceRadial);
  const axis = new Vector3(...data.axis);
  const zAxis = radial.clone().cross(axis).normalize();
  const basis = new Matrix4().makeBasis(radial, axis, zAxis);
  const baseQuaternion = new Quaternion().setFromRotationMatrix(basis);

  const body = new Mesh(
    new CylinderGeometry(data.pitchRadius, data.pitchRadius, data.faceWidth, 64, 1, false),
    pulleyMaterial,
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const hubRadius = Math.max(data.pitchRadius * 0.13, 0.002);
  const hub = new Mesh(
    new CylinderGeometry(hubRadius, hubRadius, data.faceWidth * 1.18, 32),
    axleMaterial,
  );
  hub.castShadow = true;
  group.add(hub);

  const phaseLength = data.pitchRadius * 0.80;
  const phaseThickness = Math.max(data.pitchRadius * 0.035, 0.0012);
  const phase = new Mesh(
    new BoxGeometry(phaseLength, phaseThickness, phaseThickness),
    axleMaterial,
  );
  phase.position.set(
    phaseLength / 2,
    data.faceWidth / 2 + phaseThickness * 0.7,
    0,
  );
  phase.castShadow = true;
  group.add(phase);

  const cache = { group, baseQuaternion };
  setPulleyPhase(cache, data.phaseAngle);
  return cache;
}

function disposeGroup(root: Group): void {
  root.traverse((object) => {
    if (object instanceof Mesh) object.geometry.dispose();
  });
  root.clear();
}

function dataCenter(data: Brown003SpatialRenderData): Vector3 {
  return new Vector3(
    (data.bounds.min[0] + data.bounds.max[0]) / 2,
    (data.bounds.min[1] + data.bounds.max[1]) / 2,
    (data.bounds.min[2] + data.bounds.max[2]) / 2,
  );
}

function dataSpan(data: Brown003SpatialRenderData): number {
  return Math.max(
    data.bounds.max[0] - data.bounds.min[0],
    data.bounds.max[1] - data.bounds.min[1],
    data.bounds.max[2] - data.bounds.min[2],
  );
}

/**
 * Brown-003-specific Three.js renderer. Geometry comes directly from the solved
 * XYZ route and fixed-axis pulley semantics; the projected 2D scene is used only
 * as the matching presentation identity required by the shared lab renderer API.
 */
export function createBrown003SpatialRenderer(
  host: HTMLElement,
  options: ThreeMechanismRendererOptions = {},
): Brown003SpatialRenderer {
  const threeScene = new ThreeScene();
  threeScene.background = null;

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.001, 50);
  camera.up.set(0, 1, 0);
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(PAPER, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', options.ariaLabel ?? 'Interactive Brown 003 spatial mechanism view');
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  host.replaceChildren(renderer.domElement);
  host.dataset.renderer = 'three-brown003-spatial';
  host.dataset.geometryBuildCount = '0';
  host.dataset.poseUpdateCount = '0';
  host.dataset.spatialPulleyCount = '0';
  host.dataset.spatialRoutePointCount = '0';
  host.dataset.materialArclength = '0.000000';

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.75;
  controls.minZoom = 0.55;
  controls.maxZoom = 4;

  const pulleyMaterial = new MeshStandardMaterial({ color: RUST, metalness: 0.18, roughness: 0.58 });
  const beltMaterial = new MeshStandardMaterial({ color: ROUTE_BLUE, metalness: 0.02, roughness: 0.82 });
  const axleMaterial = new MeshStandardMaterial({ color: DARK_METAL, metalness: 0.45, roughness: 0.46 });
  const markerMaterial = new MeshStandardMaterial({ color: MARKER, metalness: 0.04, roughness: 0.62 });

  threeScene.add(new AmbientLight(0xffffff, 1.8));
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(0.7, 1.2, 1.1);
  threeScene.add(key);
  const fill = new DirectionalLight(0xdde9f0, 0.9);
  fill.position.set(-0.8, 0.2, -0.5);
  threeScene.add(fill);

  const mechanism = new Group();
  threeScene.add(mechanism);

  let currentData: Brown003SpatialRenderData | undefined;
  let currentGeometryKey: string | undefined;
  let pulleyCaches = new Map<FixedAxisPulleyId, PulleyCache>();
  let markerMesh: Mesh | undefined;
  let geometryBuildCount = 0;
  let poseUpdateCount = 0;
  let destroyed = false;

  function syncDataset(): void {
    host.dataset.cameraPosition = [camera.position.x, camera.position.y, camera.position.z]
      .map((value) => value.toFixed(5)).join(',');
    host.dataset.cameraTarget = [controls.target.x, controls.target.y, controls.target.z]
      .map((value) => value.toFixed(5)).join(',');
    host.dataset.cameraZoom = camera.zoom.toFixed(3);
    host.dataset.geometryBuildCount = String(geometryBuildCount);
    host.dataset.poseUpdateCount = String(poseUpdateCount);
    if (currentData !== undefined) {
      host.dataset.spatialPulleyCount = String(currentData.pulleys.length);
      host.dataset.spatialRoutePointCount = String(currentData.beltPoints.length);
      host.dataset.materialArclength = currentData.materialArclength.toFixed(6);
      host.dataset.spatialDepth = (currentData.bounds.max[2] - currentData.bounds.min[2]).toFixed(6);
    }
  }

  function draw(): void {
    if (destroyed) return;
    syncDataset();
    renderer.render(threeScene, camera);
  }

  function configureFrustum(data: Brown003SpatialRenderData): void {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const aspect = width / height;
    const span = Math.max(dataSpan(data) * 1.25, 0.1);
    let halfWidth = span / 2;
    let halfHeight = span / 2;
    if (aspect > 1) halfWidth *= aspect;
    else halfHeight /= aspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  function rebuildGeometry(data: Brown003SpatialRenderData): void {
    disposeGroup(mechanism);
    pulleyCaches = new Map();
    markerMesh = undefined;

    const span = Math.max(dataSpan(data), 0.1);
    const routeRadius = Math.max(span * 0.004, 0.0012);
    const route = new Mesh(
      new TubeGeometry(
        new PolylineCurve3(data.beltPoints, true),
        Math.max(192, data.beltPoints.length * 2),
        routeRadius,
        10,
        true,
      ),
      beltMaterial,
    );
    route.name = 'brown003-spatial-belt-centerline';
    route.castShadow = true;
    mechanism.add(route);

    for (const pulley of data.pulleys) {
      const cache = buildPulleyGroup(pulley, pulleyMaterial, axleMaterial);
      pulleyCaches.set(pulley.pulley, cache);
      mechanism.add(cache.group);
    }

    markerMesh = new Mesh(
      new SphereGeometry(routeRadius * 2.1, 24, 16),
      markerMaterial,
    );
    markerMesh.name = 'brown003-spatial-material-marker';
    markerMesh.position.set(...data.materialPoint);
    markerMesh.castShadow = true;
    mechanism.add(markerMesh);

    currentGeometryKey = data.geometryKey;
    geometryBuildCount += 1;
  }

  function updatePose(data: Brown003SpatialRenderData): void {
    for (const pulley of data.pulleys) {
      const cache = pulleyCaches.get(pulley.pulley);
      if (cache === undefined) {
        throw new TypeError(`Brown 003 spatial renderer lost pulley ${pulley.pulley}`);
      }
      setPulleyPhase(cache, pulley.phaseAngle);
    }
    if (markerMesh === undefined) {
      throw new TypeError('Brown 003 spatial renderer lost its material marker');
    }
    markerMesh.position.set(...data.materialPoint);
    poseUpdateCount += 1;
  }

  function fitView(): void {
    if (currentData === undefined) return;
    configureFrustum(currentData);
    const center = dataCenter(currentData);
    const span = Math.max(dataSpan(currentData), 0.1);
    camera.zoom = 1;
    camera.position.copy(center).add(new Vector3(span * 1.65, span * 1.20, span * 1.75));
    controls.target.copy(center);
    controls.update();
    draw();
  }

  function resize(): void {
    if (destroyed) return;
    renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);
    if (currentData !== undefined) configureFrustum(currentData);
    draw();
  }

  controls.addEventListener('change', draw);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  return {
    update(scene, runtime) {
      if (destroyed) throw new TypeError('Cannot update a destroyed Brown 003 spatial renderer');
      if (scene.id !== BROWN_003_SCENE_ID) {
        throw new TypeError(`Brown 003 spatial renderer does not support scene ${scene.id}`);
      }
      if (runtime === undefined) {
        throw new TypeError('Brown 003 spatial renderer requires Atlas runtime context');
      }
      const firstUpdate = currentData === undefined;
      const data = resolveBrown003SpatialRenderData(runtime);
      currentData = data;
      if (currentGeometryKey !== data.geometryKey) rebuildGeometry(data);
      updatePose(data);
      configureFrustum(data);
      if (firstUpdate) fitView();
      else draw();
    },

    fitView,

    resetMotionPhase() {
      draw();
    },

    zoomBy(factor) {
      if (destroyed || !(factor > 0)) return;
      camera.zoom = MathUtils.clamp(camera.zoom * factor, controls.minZoom, controls.maxZoom);
      camera.updateProjectionMatrix();
      controls.update();
      draw();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      controls.dispose();
      disposeGroup(mechanism);
      pulleyCaches.clear();
      markerMesh = undefined;
      pulleyMaterial.dispose();
      beltMaterial.dispose();
      axleMaterial.dispose();
      markerMaterial.dispose();
      renderer.dispose();
      host.replaceChildren();
      for (const keyName of [
        'renderer',
        'cameraPosition',
        'cameraTarget',
        'cameraZoom',
        'geometryBuildCount',
        'poseUpdateCount',
        'spatialPulleyCount',
        'spatialRoutePointCount',
        'materialArclength',
        'spatialDepth',
      ]) {
        delete host.dataset[keyName];
      }
    },
  };
}
