import type {
  CirclePrimitive,
  MechanismScene,
  PolylinePrimitive,
  SegmentPrimitive,
  Vec2,
} from '@atlasmechanica/scene';
import {
  AmbientLight,
  CanvasTexture,
  Curve,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Path,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  Scene as ThreeScene,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const TAU = Math.PI * 2;
const RUST = 0xc45a35;
const ROPE_BLUE = 0x2f668e;
const DARK_METAL = 0x444846;
const PAPER = 0xfbfaf6;
const STROKE_REFERENCE_WIDTH = 1180;
const CORD_WRAP_REPEATS = 22;
const CROSSING_CLEARANCE_RADII = 1.45;

type PulleyPrefix = 'belt-driver' | 'belt-driven';

export interface ThreeMechanismRendererOptions {
  ariaLabel?: string | undefined;
}

export interface ThreeMechanismRenderer {
  update(scene: MechanismScene): void;
  fitView(): void;
  zoomBy(factor: number): void;
  destroy(): void;
}

interface BeltAssemblyCache {
  key: string;
  driver: Group;
  driven: Group;
  pathLength: number;
}

interface CrossingSpan {
  index: number;
  t: number;
}

interface BeltCrossing {
  first: CrossingSpan;
  second: CrossingSpan;
}

export type BeltSpatialPoint = Vec2 & { z: number };

class PolylineCurve3 extends Curve<Vector3> {
  private readonly points: Vector3[];
  private readonly cumulative: number[];
  private readonly totalLength: number;

  constructor(points: Vector3[], closed: boolean) {
    super();
    const normalized = points.map((point) => point.clone());
    if (closed && normalized.length > 2) {
      const first = normalized[0];
      const last = normalized[normalized.length - 1];
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
      const startDistance = this.cumulative[index] ?? 0;
      const endDistance = this.cumulative[index + 1] ?? startDistance;
      if (distance > endDistance && index < this.cumulative.length - 2) continue;
      const a = this.points[index];
      const b = this.points[index + 1];
      if (a === undefined || b === undefined) break;
      const span = endDistance - startDistance;
      const local = span > 0 ? (distance - startDistance) / span : 0;
      return target.copy(a).lerp(b, MathUtils.clamp(local, 0, 1));
    }
    return target.copy(this.points[this.points.length - 1] ?? new Vector3());
  }
}

function hasStyle(primitive: { styles: readonly string[] }, style: string): boolean {
  return primitive.styles.includes(style as never);
}

function sceneWidth(scene: MechanismScene): number {
  return scene.viewport.maxX - scene.viewport.minX;
}

function sceneHeight(scene: MechanismScene): number {
  return scene.viewport.maxY - scene.viewport.minY;
}

function sceneCenter(scene: MechanismScene): Vec2 {
  return {
    x: (scene.viewport.minX + scene.viewport.maxX) / 2,
    y: (scene.viewport.minY + scene.viewport.maxY) / 2,
  };
}

function mechanismDepth(scene: MechanismScene): number {
  const span = Math.min(sceneWidth(scene), sceneHeight(scene));
  return MathUtils.clamp(span * 0.035, 0.006, 0.014);
}

function strokeWorld(scene: MechanismScene, width = 3): number {
  return Math.max(sceneWidth(scene) * width / STROKE_REFERENCE_WIDTH, sceneWidth(scene) * 0.0015);
}

function annulusGeometry(outerRadius: number, innerRadius: number, depth: number): ExtrudeGeometry {
  const shape = new Shape();
  shape.absarc(0, 0, outerRadius, 0, TAU, false);
  const hole = new Path();
  hole.absarc(0, 0, Math.max(0.0001, innerRadius), 0, TAU, true);
  shape.holes.push(hole);
  const radialThickness = Math.max(outerRadius - innerRadius, depth * 0.5);
  const bevel = Math.min(depth * 0.14, radialThickness * 0.09);
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 64,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function spokeGeometry(left: SegmentPrimitive, right: SegmentPrimitive, depth: number): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(left.a.x, left.a.y);
  shape.lineTo(left.b.x, left.b.y);
  shape.lineTo(right.b.x, right.b.y);
  shape.lineTo(right.a.x, right.a.y);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: depth * 0.08,
    bevelThickness: depth * 0.08,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function createCordWrapTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context === null) throw new TypeError('Unable to create 3D cord texture canvas');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';

  for (const offset of [-64, 0, 64]) {
    context.beginPath();
    context.moveTo(offset, 64);
    context.lineTo(offset + 64, 0);
    context.strokeStyle = 'rgba(22, 39, 52, 0.82)';
    context.lineWidth = 14;
    context.stroke();

    context.beginPath();
    context.moveTo(offset, 64);
    context.lineTo(offset + 64, 0);
    context.strokeStyle = 'rgba(255, 255, 255, 0.48)';
    context.lineWidth = 3;
    context.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(CORD_WRAP_REPEATS, 2);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function segmentIntersection(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): { t: number; u: number } | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return undefined;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (!(t > 0.04 && t < 0.96 && u > 0.04 && u < 0.96)) return undefined;
  return { t, u };
}

function crossingSegments(points: Vec2[]): BeltCrossing | undefined {
  const segmentCount = points.length - 1;
  for (let first = 0; first < segmentCount; first += 1) {
    const a = points[first];
    const b = points[first + 1];
    if (a === undefined || b === undefined) continue;
    for (let second = first + 2; second < segmentCount; second += 1) {
      if (first === 0 && second === segmentCount - 1) continue;
      const c = points[second];
      const d = points[second + 1];
      if (c === undefined || d === undefined) continue;
      const intersection = segmentIntersection(a, b, c, d);
      if (intersection !== undefined) {
        return {
          first: { index: first, t: intersection.t },
          second: { index: second, t: intersection.u },
        };
      }
    }
  }
  return undefined;
}

function normalizedDirection(segment: SegmentPrimitive): Vec2 {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function segmentDirection(points: Vec2[], index: number): Vec2 {
  const a = points[index];
  const b = points[index + 1];
  if (a === undefined || b === undefined) return { x: 1, y: 0 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function alignment(a: Vec2, b: Vec2): number {
  return Math.abs(a.x * b.x + a.y * b.y);
}

function interpolate(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Lift only the crossed straight spans out of the pulley midplane. Every
 * original belt vertex remains at z=0, so both 001 and 002 sit centered through
 * the wheel thickness at contact and around the wrap. For 002 we insert one
 * spatial point at each 2D crossing and grade linearly from the tangent contact
 * to +/- crossingOffset at the midpoint, then back to the opposite wheel. That
 * preserves the solver-owned XY tangent while avoiding the old immediate axial
 * dogleg at the pulley.
 */
export function beltSpatialPoints(
  scene: MechanismScene,
  belt: PolylinePrimitive,
  crossingOffset: number,
): BeltSpatialPoint[] {
  const centered = belt.points.map((point) => ({ ...point, z: 0 }));
  if (scene.id !== 'belt-reversed') return centered;

  const crossing = crossingSegments(belt.points);
  const bridge = scene.primitives.find((primitive): primitive is SegmentPrimitive => {
    return primitive.id === 'belt-crossing-bridge-outline' && primitive.type === 'segment';
  });
  if (crossing === undefined || bridge === undefined) return centered;

  const bridgeDirection = normalizedDirection(bridge);
  const firstAlignment = alignment(
    segmentDirection(belt.points, crossing.first.index),
    bridgeDirection,
  );
  const secondAlignment = alignment(
    segmentDirection(belt.points, crossing.second.index),
    bridgeDirection,
  );
  const topIndex = firstAlignment >= secondAlignment
    ? crossing.first.index
    : crossing.second.index;
  const depthBySegment = new Map<number, number>([
    [crossing.first.index, crossing.first.index === topIndex ? crossingOffset : -crossingOffset],
    [crossing.second.index, crossing.second.index === topIndex ? crossingOffset : -crossingOffset],
  ]);
  const crossingBySegment = new Map<number, CrossingSpan>([
    [crossing.first.index, crossing.first],
    [crossing.second.index, crossing.second],
  ]);

  const result: BeltSpatialPoint[] = [];
  const firstPoint = belt.points[0];
  if (firstPoint !== undefined) result.push({ ...firstPoint, z: 0 });

  for (let index = 0; index < belt.points.length - 1; index += 1) {
    const a = belt.points[index];
    const b = belt.points[index + 1];
    if (a === undefined || b === undefined) continue;
    const crossingSpan = crossingBySegment.get(index);
    if (crossingSpan !== undefined) {
      const point = interpolate(a, b, crossingSpan.t);
      result.push({
        ...point,
        z: depthBySegment.get(index) ?? 0,
      });
    }
    result.push({ ...b, z: 0 });
  }
  return result;
}

function spatialPolylineLength(points: BeltSpatialPoint[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined || b === undefined) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

function beltPathPhaseSign(belt: PolylinePrimitive, driver: CirclePrimitive): 1 | -1 {
  const contact = belt.points[0];
  const next = belt.points[1];
  if (contact === undefined || next === undefined) return 1;
  const segmentLength = Math.hypot(next.x - contact.x, next.y - contact.y);
  if (!(segmentLength > 0)) return 1;

  const pathTangent = {
    x: (next.x - contact.x) / segmentLength,
    y: (next.y - contact.y) / segmentLength,
  };
  const radial = {
    x: contact.x - driver.center.x,
    y: contact.y - driver.center.y,
  };
  const positiveRotationVelocity = { x: -radial.y, y: radial.x };
  const dot =
    positiveRotationVelocity.x * pathTangent.x +
    positiveRotationVelocity.y * pathTangent.y;
  return dot >= 0 ? 1 : -1;
}

function wrapUnit(value: number): number {
  return ((value % 1) + 1) % 1;
}

/**
 * Translate pulley phase into material travel along the cached rope tube. This
 * mirrors the 2D lay-mark convention: positive driver rotation advances the
 * rope by angle × physical pitch radius along the path. Moving the UV texture
 * rather than rebuilding TubeGeometry keeps Play cheap while making the cord
 * visibly travel through both open and crossed mechanisms.
 */
export function beltCordTextureOffset(
  scene: MechanismScene,
  belt: PolylinePrimitive,
  pathLength: number,
  repeats = CORD_WRAP_REPEATS,
): number {
  if (!(pathLength > 0) || !(repeats > 0)) return 0;
  const driver = findCircle(scene, 'belt-driver');
  const contact = belt.points[0];
  if (driver === undefined || contact === undefined) return 0;
  const pitchRadius = Math.hypot(
    contact.x - driver.center.x,
    contact.y - driver.center.y,
  );
  if (!(pitchRadius > 0)) return 0;

  const travel = beltPathPhaseSign(belt, driver) * pulleyPhase(scene, 'belt-driver') * pitchRadius;
  // TubeGeometry's U coordinate increases along the belt path. A material mark
  // moving forward by `travel` therefore samples the texture from U-travel,
  // hence the negative offset.
  return wrapUnit(-(travel / pathLength) * repeats);
}

function beltCurve(
  scene: MechanismScene,
  belt: PolylinePrimitive,
  crossingOffset: number,
): PolylineCurve3 {
  const points = beltSpatialPoints(scene, belt, crossingOffset)
    .map((point) => new Vector3(point.x, point.y, point.z));
  return new PolylineCurve3(points, true);
}

function addCylinderBetween(
  group: Group,
  a: Vec2,
  b: Vec2,
  radius: number,
  z: number,
  material: MeshStandardMaterial,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-9)) return;
  const geometry = new CylinderGeometry(radius, radius, length, 10, 1, false);
  const mesh = new Mesh(geometry, material);
  mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, z);
  mesh.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
  mesh.castShadow = true;
  group.add(mesh);
}

function findCircle(scene: MechanismScene, id: string): CirclePrimitive | undefined {
  const primitive = scene.primitives.find((candidate) => candidate.id === id);
  return primitive?.type === 'circle' ? primitive : undefined;
}

function findSegment(scene: MechanismScene, id: string): SegmentPrimitive | undefined {
  const primitive = scene.primitives.find((candidate) => candidate.id === id);
  return primitive?.type === 'segment' ? primitive : undefined;
}

function findBelt(scene: MechanismScene): PolylinePrimitive | undefined {
  const primitive = scene.primitives.find((candidate) => candidate.id === 'belt-band-underlay');
  return primitive?.type === 'polyline' ? primitive : undefined;
}

function pulleyPhase(scene: MechanismScene, prefix: PulleyPrefix): number {
  const outer = findCircle(scene, prefix);
  const left = findSegment(scene, `${prefix}-spoke-0`);
  const right = findSegment(scene, `${prefix}-spoke-0-edge`);
  if (outer === undefined || left === undefined || right === undefined) return 0;
  const root = {
    x: (left.a.x + right.a.x) / 2,
    y: (left.a.y + right.a.y) / 2,
  };
  return Math.atan2(root.y - outer.center.y, root.x - outer.center.x);
}

function localPoint(point: Vec2, center: Vec2, phase: number): Vec2 {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cosine = Math.cos(phase);
  const sine = Math.sin(phase);
  return {
    x: dx * cosine + dy * sine,
    y: -dx * sine + dy * cosine,
  };
}

function localSegment(segment: SegmentPrimitive, center: Vec2, phase: number): SegmentPrimitive {
  return {
    ...segment,
    a: localPoint(segment.a, center, phase),
    b: localPoint(segment.b, center, phase),
  };
}

function keyNumber(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function normalizedSpokeKey(scene: MechanismScene, prefix: PulleyPrefix): unknown[] {
  const outer = findCircle(scene, prefix);
  if (outer === undefined) return [];
  const phase = pulleyPhase(scene, prefix);
  const result: unknown[] = [];
  for (let index = 0; index < 4; index += 1) {
    const left = findSegment(scene, `${prefix}-spoke-${index}`);
    const right = findSegment(scene, `${prefix}-spoke-${index}-edge`);
    if (left === undefined || right === undefined) continue;
    const localLeft = localSegment(left, outer.center, phase);
    const localRight = localSegment(right, outer.center, phase);
    result.push([
      keyNumber(localLeft.a.x), keyNumber(localLeft.a.y),
      keyNumber(localLeft.b.x), keyNumber(localLeft.b.y),
      keyNumber(localRight.a.x), keyNumber(localRight.a.y),
      keyNumber(localRight.b.x), keyNumber(localRight.b.y),
    ]);
  }
  return result;
}

function circleKey(circle: CirclePrimitive | undefined): unknown {
  return circle === undefined
    ? null
    : [
      keyNumber(circle.center.x),
      keyNumber(circle.center.y),
      keyNumber(circle.radius),
      circle.width === undefined ? null : keyNumber(circle.width),
    ];
}

function beltGeometryKey(scene: MechanismScene, belt: PolylinePrimitive): string {
  const bridge = findSegment(scene, 'belt-crossing-bridge-outline');
  return JSON.stringify([
    scene.id,
    [
      keyNumber(scene.viewport.minX),
      keyNumber(scene.viewport.maxX),
      keyNumber(scene.viewport.minY),
      keyNumber(scene.viewport.maxY),
    ],
    belt.width === undefined ? null : keyNumber(belt.width),
    belt.points.map((point) => [keyNumber(point.x), keyNumber(point.y)]),
    circleKey(findCircle(scene, 'belt-driver')),
    circleKey(findCircle(scene, 'belt-driver-rim-inner')),
    circleKey(findCircle(scene, 'belt-driver-hub')),
    normalizedSpokeKey(scene, 'belt-driver'),
    circleKey(findCircle(scene, 'belt-driven')),
    circleKey(findCircle(scene, 'belt-driven-rim-inner')),
    circleKey(findCircle(scene, 'belt-driven-hub')),
    normalizedSpokeKey(scene, 'belt-driven'),
    bridge === undefined ? null : [
      keyNumber(bridge.a.x), keyNumber(bridge.a.y),
      keyNumber(bridge.b.x), keyNumber(bridge.b.y),
    ],
  ]);
}

function buildPulleyGroup(
  scene: MechanismScene,
  prefix: PulleyPrefix,
  depth: number,
  pulleyMaterial: MeshStandardMaterial,
  axleMaterial: MeshStandardMaterial,
): Group | undefined {
  const outer = findCircle(scene, prefix);
  const inner = findCircle(scene, `${prefix}-rim-inner`);
  const hub = findCircle(scene, `${prefix}-hub`);
  if (outer === undefined || inner === undefined || hub === undefined) return undefined;

  const phase = pulleyPhase(scene, prefix);
  const group = new Group();
  group.name = prefix;
  group.position.set(outer.center.x, outer.center.y, 0);
  group.rotation.z = phase;

  const rim = new Mesh(annulusGeometry(outer.radius, inner.radius, depth), pulleyMaterial);
  rim.castShadow = true;
  group.add(rim);

  const hubGeometry = new CylinderGeometry(hub.radius, hub.radius, depth * 1.15, 48);
  hubGeometry.rotateX(Math.PI / 2);
  const hubMesh = new Mesh(hubGeometry, pulleyMaterial);
  hubMesh.castShadow = true;
  group.add(hubMesh);

  const axleGeometry = new CylinderGeometry(hub.radius * 0.38, hub.radius * 0.38, depth * 2.2, 32);
  axleGeometry.rotateX(Math.PI / 2);
  const axle = new Mesh(axleGeometry, axleMaterial);
  axle.castShadow = true;
  group.add(axle);

  for (let index = 0; index < 4; index += 1) {
    const left = findSegment(scene, `${prefix}-spoke-${index}`);
    const right = findSegment(scene, `${prefix}-spoke-${index}-edge`);
    if (left === undefined || right === undefined) continue;
    const localLeft = localSegment(left, outer.center, phase);
    const localRight = localSegment(right, outer.center, phase);
    const spoke = new Mesh(spokeGeometry(localLeft, localRight, depth * 0.72), pulleyMaterial);
    spoke.castShadow = true;
    group.add(spoke);
  }
  return group;
}

function updatePulleyPose(group: Group, scene: MechanismScene, prefix: PulleyPrefix): void {
  const outer = findCircle(scene, prefix);
  if (outer === undefined) return;
  group.position.set(outer.center.x, outer.center.y, 0);
  group.rotation.z = pulleyPhase(scene, prefix);
}

function buildBeltAssembly(
  group: Group,
  scene: MechanismScene,
  belt: PolylinePrimitive,
  pulleyMaterial: MeshStandardMaterial,
  beltMaterial: MeshStandardMaterial,
  axleMaterial: MeshStandardMaterial,
): BeltAssemblyCache | undefined {
  if (!scene.id.startsWith('belt-')) return undefined;
  const depth = mechanismDepth(scene);
  const driver = buildPulleyGroup(scene, 'belt-driver', depth, pulleyMaterial, axleMaterial);
  const driven = buildPulleyGroup(scene, 'belt-driven', depth, pulleyMaterial, axleMaterial);
  if (driver === undefined || driven === undefined) return undefined;
  group.add(driver, driven);

  const radius = Math.max(strokeWorld(scene, belt.width ?? 7) * 0.46, depth * 0.11);
  const crossingOffset = radius * CROSSING_CLEARANCE_RADII;
  const spatialPoints = beltSpatialPoints(scene, belt, crossingOffset);
  const tubularSegments = Math.max(128, Math.min(420, belt.points.length * 4));
  const ropeGeometry = new TubeGeometry(
    new PolylineCurve3(
      spatialPoints.map((point) => new Vector3(point.x, point.y, point.z)),
      true,
    ),
    tubularSegments,
    radius,
    12,
    true,
  );
  const rope = new Mesh(ropeGeometry, beltMaterial);
  rope.castShadow = true;
  group.add(rope);

  return {
    key: beltGeometryKey(scene, belt),
    driver,
    driven,
    pathLength: spatialPolylineLength(spatialPoints),
  };
}

function buildGenericScene(
  group: Group,
  scene: MechanismScene,
  pulleyMaterial: MeshStandardMaterial,
  beltMaterial: MeshStandardMaterial,
  axleMaterial: MeshStandardMaterial,
): void {
  const depth = mechanismDepth(scene);
  for (const primitive of scene.primitives) {
    if (primitive.layer !== 'mechanism' || hasStyle(primitive, 'cutout')) continue;
    const material = hasStyle(primitive, 'belt') ? beltMaterial
      : hasStyle(primitive, 'pulley') ? pulleyMaterial
        : axleMaterial;
    if (primitive.type === 'circle') {
      const tube = Math.max(strokeWorld(scene, primitive.width ?? 3) / 2, depth * 0.07);
      const outer = primitive.radius + tube;
      const inner = Math.max(primitive.radius - tube, outer * 0.2);
      const mesh = new Mesh(annulusGeometry(outer, inner, depth * 0.45), material);
      mesh.position.set(primitive.center.x, primitive.center.y, 0);
      group.add(mesh);
    } else if (primitive.type === 'segment') {
      addCylinderBetween(group, primitive.a, primitive.b, strokeWorld(scene, primitive.width ?? 3) / 2, 0, material);
    } else if (primitive.type === 'polyline' && primitive.points.length > 2) {
      const curve = new PolylineCurve3(
        primitive.points.map((point) => new Vector3(point.x, point.y, 0)),
        false,
      );
      const geometry = new TubeGeometry(
        curve,
        Math.max(24, primitive.points.length * 3),
        strokeWorld(scene, primitive.width ?? 3) / 2,
        8,
        false,
      );
      group.add(new Mesh(geometry, material));
    }
  }
}

function disposeGeometry(root: Group): void {
  root.traverse((object) => {
    if (object instanceof Mesh) object.geometry.dispose();
  });
  root.clear();
}

export function createThreeMechanismRenderer(
  host: HTMLElement,
  options: ThreeMechanismRendererOptions = {},
): ThreeMechanismRenderer {
  const threeScene = new ThreeScene();
  threeScene.background = null;

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.001, 20);
  camera.up.set(0, 1, 0);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(PAPER, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', options.ariaLabel ?? 'Interactive 3D mechanism view');
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  host.replaceChildren(renderer.domElement);
  host.dataset.renderer = 'three';
  host.dataset.geometryBuildCount = '0';
  host.dataset.poseUpdateCount = '0';
  host.dataset.ropeTexture = 'helical-wrap';
  host.dataset.ropePhase = '0.000000';

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

  const cordWrapTexture = createCordWrapTexture();
  cordWrapTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const pulleyMaterial = new MeshStandardMaterial({ color: RUST, metalness: 0.16, roughness: 0.58 });
  const beltMaterial = new MeshStandardMaterial({
    color: ROPE_BLUE,
    map: cordWrapTexture,
    bumpMap: cordWrapTexture,
    bumpScale: 0.18,
    metalness: 0.02,
    roughness: 0.84,
  });
  const axleMaterial = new MeshStandardMaterial({ color: DARK_METAL, metalness: 0.42, roughness: 0.48 });

  threeScene.add(new AmbientLight(0xffffff, 1.75));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(0.4, 0.7, 1.2);
  threeScene.add(key);
  const fill = new DirectionalLight(0xdde9f0, 0.8);
  fill.position.set(-0.8, -0.2, 0.5);
  threeScene.add(fill);

  const mechanism = new Group();
  threeScene.add(mechanism);

  let currentScene: MechanismScene | undefined;
  let previousCenter: Vec2 | undefined;
  let beltCache: BeltAssemblyCache | undefined;
  let geometryBuildCount = 0;
  let poseUpdateCount = 0;
  let destroyed = false;

  function syncCameraDataset(): void {
    host.dataset.cameraPosition = [camera.position.x, camera.position.y, camera.position.z]
      .map((value) => value.toFixed(5)).join(',');
    host.dataset.cameraTarget = [controls.target.x, controls.target.y, controls.target.z]
      .map((value) => value.toFixed(5)).join(',');
    host.dataset.cameraZoom = camera.zoom.toFixed(3);
    host.dataset.geometryBuildCount = String(geometryBuildCount);
    host.dataset.poseUpdateCount = String(poseUpdateCount);
  }

  function draw(): void {
    if (destroyed) return;
    syncCameraDataset();
    renderer.render(threeScene, camera);
  }

  function configureFrustum(scene: MechanismScene): void {
    const hostWidth = Math.max(1, host.clientWidth);
    const hostHeight = Math.max(1, host.clientHeight);
    const hostAspect = hostWidth / hostHeight;
    const width = sceneWidth(scene) * 1.10;
    const height = sceneHeight(scene) * 1.10;
    let halfWidth = width / 2;
    let halfHeight = height / 2;
    if (hostAspect > width / height) halfWidth = halfHeight * hostAspect;
    else halfHeight = halfWidth / hostAspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  function shiftToSceneCenter(scene: MechanismScene): void {
    const next = sceneCenter(scene);
    if (previousCenter === undefined) {
      previousCenter = next;
      return;
    }
    const dx = next.x - previousCenter.x;
    const dy = next.y - previousCenter.y;
    camera.position.x += dx;
    camera.position.y += dy;
    controls.target.x += dx;
    controls.target.y += dy;
    previousCenter = next;
  }

  function updateCordPhase(scene: MechanismScene, belt: PolylinePrimitive): void {
    if (beltCache === undefined || !(beltCache.pathLength > 0)) return;
    const phase = beltCordTextureOffset(scene, belt, beltCache.pathLength);
    cordWrapTexture.offset.x = phase;
    host.dataset.ropePhase = phase.toFixed(6);
  }

  function updateMechanism(scene: MechanismScene): void {
    const belt = findBelt(scene);
    if (belt !== undefined && beltCache !== undefined) {
      const nextKey = beltGeometryKey(scene, belt);
      if (nextKey === beltCache.key) {
        updatePulleyPose(beltCache.driver, scene, 'belt-driver');
        updatePulleyPose(beltCache.driven, scene, 'belt-driven');
        updateCordPhase(scene, belt);
        poseUpdateCount += 1;
        return;
      }
    }

    disposeGeometry(mechanism);
    beltCache = undefined;
    if (belt !== undefined) {
      beltCache = buildBeltAssembly(
        mechanism,
        scene,
        belt,
        pulleyMaterial,
        beltMaterial,
        axleMaterial,
      );
    }
    if (beltCache === undefined) {
      buildGenericScene(mechanism, scene, pulleyMaterial, beltMaterial, axleMaterial);
    } else if (belt !== undefined) {
      updateCordPhase(scene, belt);
    }
    geometryBuildCount += 1;
  }

  function fitView(): void {
    if (currentScene === undefined) return;
    const center = sceneCenter(currentScene);
    const span = Math.max(sceneWidth(currentScene), sceneHeight(currentScene));
    configureFrustum(currentScene);
    camera.zoom = 1;
    camera.position.set(center.x, center.y, Math.max(0.75, span * 2.8));
    camera.up.set(0, 1, 0);
    controls.target.set(center.x, center.y, 0);
    controls.update();
    previousCenter = center;
    draw();
  }

  function resize(): void {
    if (destroyed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    if (currentScene !== undefined) configureFrustum(currentScene);
    draw();
  }

  controls.addEventListener('change', draw);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  return {
    update(scene) {
      if (destroyed) throw new TypeError('Cannot update a destroyed Three.js mechanism renderer');
      const firstScene = currentScene === undefined;
      currentScene = scene;
      shiftToSceneCenter(scene);
      configureFrustum(scene);
      updateMechanism(scene);
      if (firstScene) fitView();
      else draw();
    },

    fitView,

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
      disposeGeometry(mechanism);
      beltCache = undefined;
      pulleyMaterial.dispose();
      beltMaterial.dispose();
      axleMaterial.dispose();
      cordWrapTexture.dispose();
      renderer.dispose();
      host.replaceChildren();
      delete host.dataset.renderer;
      delete host.dataset.cameraPosition;
      delete host.dataset.cameraTarget;
      delete host.dataset.cameraZoom;
      delete host.dataset.geometryBuildCount;
      delete host.dataset.poseUpdateCount;
      delete host.dataset.ropeTexture;
      delete host.dataset.ropePhase;
    },
  };
}
