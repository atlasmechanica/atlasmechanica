import type { MechanismScene } from '@atlasmechanica/scene';
import {
  resolveBrown003SpatialRenderData,
  type Brown003SpatialPulleyRenderData,
  type Brown003SpatialRenderData,
  type Brown003SpatialRendererRuntimeContext,
  type Brown003SpatialVec3,
} from '@atlasmechanica/scene/brown003-spatial';
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

export type {
  Brown003SpatialPulleyRenderData,
  Brown003SpatialRenderData,
  Brown003SpatialRendererRuntimeContext,
} from '@atlasmechanica/scene/brown003-spatial';
export { resolveBrown003SpatialRenderData } from '@atlasmechanica/scene/brown003-spatial';

const BROWN_003_SCENE_ID = 'brown003-spatial-projection';
const PAPER = 0xfbfaf6;
const RUST = 0xc45a35;
const ROUTE_BLUE = 0x2f668e;
const DARK_METAL = 0x444846;
const MARKER = 0xd8a13b;

type PulleyId = Brown003SpatialPulleyRenderData['pulley'];

export interface Brown003SpatialRenderer extends Omit<ThreeMechanismRenderer, 'update'> {
  update(
    scene: MechanismScene,
    runtime?: Brown003SpatialRendererRuntimeContext,
  ): void;
}

class PolylineCurve3 extends Curve<Vector3> {
  private readonly points: Vector3[];
  private readonly cumulative: number[];
  private readonly totalLength: number;

  constructor(points: readonly Brown003SpatialVec3[], closed: boolean) {
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
      return target.copy(a).lerp(
        b,
        span > 0 ? MathUtils.clamp((distance - start) / span, 0, 1) : 0,
      );
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

  // The phase bar is a presentation cue only. It lies just beyond the positive
  // face so its rotation is readable without altering pulley/contact geometry.
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
 * Brown-003-specific Three.js renderer. Atlas scene semantics resolve the true
 * XYZ route, finite pulley faces, and runtime provenance before this adapter
 * creates any Three.js object. The projected 2D MechanismScene is used only as
 * the matching presentation identity required by the shared lab renderer API.
 */
export function createBrown003SpatialRenderer(
  host: HTMLElement,
  options: ThreeMechanismRendererOptions = {},
): Brown003SpatialRenderer {
  const threeScene = new ThreeScene();
  threeScene.background = null;

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.001, 50);
  camera.up.set(0, 1, 0);
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(PAPER, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute(
    'aria-label',
    options.ariaLabel ?? 'Interactive Brown 003 spatial mechanism view',
  );
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

  const pulleyMaterial = new MeshStandardMaterial({
    color: RUST,
    metalness: 0.18,
    roughness: 0.58,
  });
  const beltMaterial = new MeshStandardMaterial({
    color: ROUTE_BLUE,
    metalness: 0.02,
    roughness: 0.82,
  });
  const axleMaterial = new MeshStandardMaterial({
    color: DARK_METAL,
    metalness: 0.45,
    roughness: 0.46,
  });
  const markerMaterial = new MeshStandardMaterial({
    color: MARKER,
    metalness: 0.04,
    roughness: 0.62,
  });

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
  let pulleyCaches = new Map<PulleyId, PulleyCache>();
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
      host.dataset.spatialDepth = (
        currentData.bounds.max[2] - currentData.bounds.min[2]
      ).toFixed(6);
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

    // Tube radius is a legibility cue only. The physical model still carries a
    // flat-belt centerline/width contract rather than a circular rope section.
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
    camera.position.copy(center).add(
      new Vector3(span * 1.65, span * 1.20, span * 1.75),
    );
    controls.target.copy(center);
    controls.update();
    draw();
  }

  function resize(): void {
    if (destroyed) return;
    renderer.setSize(
      Math.max(1, host.clientWidth),
      Math.max(1, host.clientHeight),
      false,
    );
    if (currentData !== undefined) configureFrustum(currentData);
    draw();
  }

  controls.addEventListener('change', draw);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  return {
    update(scene, runtime) {
      if (destroyed) {
        throw new TypeError('Cannot update a destroyed Brown 003 spatial renderer');
      }
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
      // Material phase is absolute in current Atlas state; the subsequent lab
      // render after reset supplies the reset state rather than mutating local
      // renderer-owned phase.
      draw();
    },

    zoomBy(factor) {
      if (destroyed || !(factor > 0)) return;
      camera.zoom = MathUtils.clamp(
        camera.zoom * factor,
        controls.minZoom,
        controls.maxZoom,
      );
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
