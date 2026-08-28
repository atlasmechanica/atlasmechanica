import {
  SCENE_LAYER_ORDER,
  assertMechanismScene,
  type HandlePrimitive,
  type MechanismScene,
  type SceneLayer,
  type ScenePrimitive,
  type Vec2,
} from '@atlasmechanica/scene';
import {
  DEFAULT_RENDER_SIZE,
  clientPointToWorld,
  projectPoint,
  type RenderSize,
} from './geometry.js';
import {
  SVG_RENDERER_STYLE,
  applySvgTheme,
  type SvgRendererTheme,
} from './theme.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgRendererCallbacks {
  onSelect?(id: string): void;
  onInputDrag?(point: Vec2): void;
  onParameterDrag?(point: Vec2): void;
  onNudgeInput?(deltaDegrees: number): void;
}

export interface SvgRendererOptions {
  instanceId: string;
  callbacks?: SvgRendererCallbacks | undefined;
  theme?: Partial<SvgRendererTheme> | undefined;
  width?: number | undefined;
  height?: number | undefined;
  ariaLabel?: string | undefined;
  keyboardParameterStep?: number | undefined;
}

export interface SvgMechanismRenderer {
  update(scene: MechanismScene): void;
  exportSvg(): string;
  domNodeCount(): number;
  destroy(): void;
}

interface RenderNode {
  group: SVGGElement;
  type: ScenePrimitive['type'];
  layer: SceneLayer;
}

interface ActiveHandle {
  id: string;
  handle: HandlePrimitive['handle'];
  pointerId: number;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function safeInstanceId(value: string): string {
  const result = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (result.length === 0) throw new TypeError('SVG renderer instanceId must contain an alphanumeric character');
  return result;
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function styleClass(primitive: ScenePrimitive, selected: boolean): string {
  return [
    'atlas-visible',
    ...primitive.styles.map((token) => `atlas-style-${token}`),
    selected ? 'atlas-selected' : '',
  ].filter(Boolean).join(' ');
}

function handlePath(point: Vec2, shape: HandlePrimitive['shape'], scene: MechanismScene, size: RenderSize): string {
  const projected = projectPoint(point, scene.viewport, size);
  const radius = 7;
  if (shape === 'square') {
    return `M ${projected.x - radius} ${projected.y - radius} H ${projected.x + radius} V ${projected.y + radius} H ${projected.x - radius} Z`;
  }
  return `M ${projected.x - radius} ${projected.y} A ${radius} ${radius} 0 1 0 ${projected.x + radius} ${projected.y} A ${radius} ${radius} 0 1 0 ${projected.x - radius} ${projected.y}`;
}

function setLine(
  line: SVGLineElement,
  a: Vec2,
  b: Vec2,
  scene: MechanismScene,
  size: RenderSize,
): void {
  const pa = projectPoint(a, scene.viewport, size);
  const pb = projectPoint(b, scene.viewport, size);
  line.setAttribute('x1', String(pa.x));
  line.setAttribute('y1', String(pa.y));
  line.setAttribute('x2', String(pb.x));
  line.setAttribute('y2', String(pb.y));
}

export function createSvgMechanismRenderer(
  host: HTMLElement,
  options: SvgRendererOptions,
): SvgMechanismRenderer {
  const instanceId = safeInstanceId(options.instanceId);
  const callbacks = options.callbacks ?? {};
  const size: RenderSize = {
    width: options.width ?? DEFAULT_RENDER_SIZE.width,
    height: options.height ?? DEFAULT_RENDER_SIZE.height,
  };
  if (!(size.width > 0) || !(size.height > 0)) throw new TypeError('SVG renderer size must be positive');

  const originalChildren = Array.from(host.childNodes);
  const originalTabIndex = host.getAttribute('tabindex');
  const originalRole = host.getAttribute('role');
  const originalAriaLabel = host.getAttribute('aria-label');
  const originalDataRenderer = host.getAttribute('data-renderer');
  const originalDataScene = host.getAttribute('data-scene');

  host.tabIndex = 0;
  host.setAttribute('role', 'group');
  if (originalAriaLabel === null) host.setAttribute('aria-label', 'Mechanism diagram controls');
  host.dataset.renderer = 'atlas-native-svg';

  const svg = svgElement('svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('class', 'atlas-svg-root');
  svg.style.width = '100%';
  svg.style.height = '100%';
  applySvgTheme(svg, options.theme);

  const defs = svgElement('defs');
  const style = svgElement('style');
  style.textContent = SVG_RENDERER_STYLE;
  defs.append(style);
  const markerId = `${instanceId}-arrow`;
  const marker = svgElement('marker');
  marker.setAttribute('id', markerId);
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = svgElement('path');
  arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowPath.setAttribute('fill', 'var(--am-vector)');
  marker.append(arrowPath);
  defs.append(marker);
  svg.append(defs);

  const layers = new Map<SceneLayer, SVGGElement>();
  for (const layer of SCENE_LAYER_ORDER) {
    const group = svgElement('g');
    group.setAttribute('class', 'atlas-layer');
    group.dataset.layer = layer;
    svg.append(group);
    layers.set(layer, group);
  }

  host.replaceChildren(svg);

  const nodes = new Map<string, RenderNode>();
  const handlePoints = new Map<string, Vec2>();
  let currentScene: MechanismScene | undefined;
  let activeHandle: ActiveHandle | undefined;
  let destroyed = false;

  const layerRoot = (layer: SceneLayer): SVGGElement => {
    const root = layers.get(layer);
    if (root === undefined) throw new TypeError(`Unknown scene layer ${layer}`);
    return root;
  };

  const createNode = (primitive: ScenePrimitive): RenderNode => {
    const group = svgElement('g');
    group.setAttribute('class', 'atlas-primitive');
    group.dataset.primitive = primitive.id;
    layerRoot(primitive.layer).append(group);

    if (primitive.type === 'segment' || primitive.type === 'vector') {
      group.append(svgElement('line'), svgElement('line'));
    } else if (primitive.type === 'circle') {
      group.append(svgElement('ellipse'), svgElement('ellipse'));
    } else if (primitive.type === 'polyline') {
      group.append(svgElement('polyline'), svgElement('polyline'));
    } else if (primitive.type === 'handle') {
      group.append(svgElement('path'), svgElement('circle'));
    } else if (primitive.type === 'label') {
      group.append(svgElement('text'));
    } else if (primitive.type === 'dimension') {
      group.append(svgElement('line'), svgElement('line'), svgElement('line'), svgElement('text'));
    }

    group.addEventListener('click', () => {
      const id = group.dataset.selectId;
      if (id) callbacks.onSelect?.(id);
    });

    group.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const id = group.dataset.selectId;
      if (id && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        callbacks.onSelect?.(id);
      }
      const handle = group.dataset.handle as HandlePrimitive['handle'] | undefined;
      const point = handlePoints.get(primitive.id);
      if (point !== undefined && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const sign = event.key === 'ArrowRight' ? 1 : -1;
        if (handle === 'input') callbacks.onNudgeInput?.(sign * 2);
        if (handle === 'parameter') {
          callbacks.onParameterDrag?.({
            x: point.x + sign * (options.keyboardParameterStep ?? 0.005),
            y: point.y,
          });
        }
      }
    });

    group.addEventListener('pointerdown', (event) => {
      const handle = group.dataset.handle as HandlePrimitive['handle'] | undefined;
      if (handle === undefined || handle === 'invalid') return;
      event.preventDefault();
      activeHandle = { id: primitive.id, handle, pointerId: event.pointerId };
      svg.setPointerCapture(event.pointerId);
    });

    return { group, type: primitive.type, layer: primitive.layer };
  };

  const updateNode = (node: RenderNode, primitive: ScenePrimitive, scene: MechanismScene): void => {
    const group = node.group;
    if (primitive.selectId === undefined) delete group.dataset.selectId;
    else group.dataset.selectId = primitive.selectId;
    if (primitive.type === 'handle') group.dataset.handle = primitive.handle;
    else delete group.dataset.handle;
    group.dataset.layer = primitive.layer;
    group.setAttribute('aria-label', primitive.ariaLabel ?? primitive.id);
    const focusable = primitive.selectId !== undefined || (primitive.type === 'handle' && primitive.handle !== 'invalid');
    group.setAttribute('tabindex', focusable ? '0' : '-1');
    group.setAttribute('role', focusable ? 'button' : 'presentation');
    if (primitive.type === 'handle' && primitive.handle !== 'invalid') {
      group.setAttribute('aria-roledescription', 'draggable mechanism control');
    } else {
      group.removeAttribute('aria-roledescription');
    }
    group.setAttribute('class', focusable ? 'atlas-primitive atlas-interactive' : 'atlas-primitive');
    const selected = primitive.selectId !== undefined && primitive.selectId === scene.selectedId;

    if (primitive.type === 'segment') {
      const visible = group.children[0] as SVGLineElement;
      const hit = group.children[1] as SVGLineElement;
      setLine(visible, primitive.a, primitive.b, scene, size);
      setLine(hit, primitive.a, primitive.b, scene, size);
      visible.setAttribute('class', styleClass(primitive, selected));
      visible.setAttribute('stroke-width', String(primitive.width ?? 3));
      visible.setAttribute('stroke-linecap', 'round');
      hit.setAttribute('class', 'atlas-hit');
      hit.setAttribute('stroke-width', String(Math.max((primitive.width ?? 3) + 14, 20)));
    } else if (primitive.type === 'circle') {
      const visible = group.children[0] as SVGEllipseElement;
      const hit = group.children[1] as SVGEllipseElement;
      const center = projectPoint(primitive.center, scene.viewport, size);
      const rx = (primitive.radius / (scene.viewport.maxX - scene.viewport.minX)) * size.width;
      const ry = (primitive.radius / (scene.viewport.maxY - scene.viewport.minY)) * size.height;
      for (const ellipse of [visible, hit]) {
        ellipse.setAttribute('cx', String(center.x));
        ellipse.setAttribute('cy', String(center.y));
      }
      visible.setAttribute('rx', String(rx));
      visible.setAttribute('ry', String(ry));
      visible.setAttribute('class', styleClass(primitive, selected));
      visible.setAttribute('stroke-width', String(primitive.width ?? 2));
      hit.setAttribute('rx', String(rx + 10));
      hit.setAttribute('ry', String(ry + 10));
      hit.setAttribute('class', 'atlas-hit-fill');
    } else if (primitive.type === 'polyline') {
      const visible = group.children[0] as SVGPolylineElement;
      const hit = group.children[1] as SVGPolylineElement;
      const points = primitive.points.map((point) => {
        const projected = projectPoint(point, scene.viewport, size);
        return `${projected.x},${projected.y}`;
      }).join(' ');
      for (const polyline of [visible, hit]) {
        polyline.setAttribute('points', points);
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke-linejoin', 'round');
      }
      visible.setAttribute('class', styleClass(primitive, selected));
      visible.setAttribute('stroke-width', String(primitive.width ?? 2));
      hit.setAttribute('class', 'atlas-hit');
      hit.setAttribute('stroke-width', String(Math.max((primitive.width ?? 2) + 14, 16)));
    } else if (primitive.type === 'vector') {
      const visible = group.children[0] as SVGLineElement;
      const hit = group.children[1] as SVGLineElement;
      setLine(visible, primitive.from, primitive.to, scene, size);
      setLine(hit, primitive.from, primitive.to, scene, size);
      visible.setAttribute('class', styleClass(primitive, selected));
      visible.setAttribute('stroke-width', '2.2');
      visible.setAttribute('marker-end', `url(#${markerId})`);
      hit.setAttribute('class', 'atlas-hit');
      hit.setAttribute('stroke-width', '16');
    } else if (primitive.type === 'handle') {
      const visible = group.children[0] as SVGPathElement;
      const hit = group.children[1] as SVGCircleElement;
      const point = projectPoint(primitive.at, scene.viewport, size);
      visible.setAttribute('d', handlePath(primitive.at, primitive.shape, scene, size));
      visible.setAttribute('class', `${styleClass(primitive, selected)} atlas-handle-visible`);
      visible.dataset.handle = primitive.handle;
      hit.setAttribute('cx', String(point.x));
      hit.setAttribute('cy', String(point.y));
      hit.setAttribute('r', '18');
      hit.setAttribute('class', 'atlas-hit-fill');
      handlePoints.set(primitive.id, primitive.at);
    } else if (primitive.type === 'label') {
      const text = group.children[0] as SVGTextElement;
      const point = projectPoint(primitive.at, scene.viewport, size);
      text.setAttribute('x', String(point.x));
      text.setAttribute('y', String(point.y));
      text.setAttribute('class', styleClass(primitive, selected));
      text.textContent = primitive.text;
    } else if (primitive.type === 'dimension') {
      const line = group.children[0] as SVGLineElement;
      const tickA = group.children[1] as SVGLineElement;
      const tickB = group.children[2] as SVGLineElement;
      const text = group.children[3] as SVGTextElement;
      setLine(line, primitive.a, primitive.b, scene, size);
      const a = projectPoint(primitive.a, scene.viewport, size);
      const b = projectPoint(primitive.b, scene.viewport, size);
      tickA.setAttribute('x1', String(a.x));
      tickA.setAttribute('x2', String(a.x));
      tickA.setAttribute('y1', String(a.y - 5));
      tickA.setAttribute('y2', String(a.y + 5));
      tickB.setAttribute('x1', String(b.x));
      tickB.setAttribute('x2', String(b.x));
      tickB.setAttribute('y1', String(b.y - 5));
      tickB.setAttribute('y2', String(b.y + 5));
      for (const item of [line, tickA, tickB]) {
        item.setAttribute('class', styleClass(primitive, false));
        item.setAttribute('stroke-width', '1.2');
      }
      text.setAttribute('x', String((a.x + b.x) / 2));
      text.setAttribute('y', String((a.y + b.y) / 2 - 7));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'atlas-dimension-text');
      text.textContent = primitive.text;
    }
  };

  const pointerMove = (event: PointerEvent): void => {
    if (activeHandle === undefined || currentScene === undefined) return;
    const point = clientPointToWorld(
      event.clientX,
      event.clientY,
      svg.getBoundingClientRect(),
      currentScene.viewport,
      size,
    );
    if (activeHandle.handle === 'input') callbacks.onInputDrag?.(point);
    else if (activeHandle.handle === 'parameter') callbacks.onParameterDrag?.(point);
  };

  const releasePointer = (event: PointerEvent): void => {
    if (activeHandle?.pointerId !== event.pointerId) return;
    activeHandle = undefined;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };

  const hostKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== host) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      callbacks.onNudgeInput?.(event.key === 'ArrowRight' ? 2 : -2);
    }
  };

  const ensureLayerOrder = (scene: MechanismScene, layer: SceneLayer): void => {
    const root = layerRoot(layer);
    let cursor = root.firstElementChild;
    for (const primitive of scene.primitives) {
      if (primitive.layer !== layer) continue;
      const node = nodes.get(primitive.id);
      if (node === undefined) continue;
      if (node.group !== cursor) root.insertBefore(node.group, cursor);
      cursor = node.group.nextElementSibling;
    }
  };

  svg.addEventListener('pointermove', pointerMove);
  svg.addEventListener('pointerup', releasePointer);
  svg.addEventListener('pointercancel', releasePointer);
  svg.addEventListener('lostpointercapture', releasePointer);
  host.addEventListener('keydown', hostKeyDown);

  return {
    update(scene) {
      if (destroyed) throw new TypeError('Cannot update a destroyed SVG mechanism renderer');
      assertMechanismScene(scene);
      currentScene = scene;
      svg.dataset.scene = scene.id;
      svg.setAttribute('aria-label', options.ariaLabel ?? scene.title);
      host.dataset.scene = scene.id;
      const seen = new Set<string>();

      for (const primitive of scene.primitives) {
        seen.add(primitive.id);
        let node = nodes.get(primitive.id);
        if (node === undefined || node.type !== primitive.type) {
          node?.group.remove();
          node = createNode(primitive);
          nodes.set(primitive.id, node);
        }
        if (node.layer !== primitive.layer) {
          layerRoot(primitive.layer).append(node.group);
          node.layer = primitive.layer;
        }
        updateNode(node, primitive, scene);
      }

      for (const [id, node] of nodes) {
        if (!seen.has(id)) {
          node.group.remove();
          nodes.delete(id);
          handlePoints.delete(id);
        }
      }

      for (const layer of SCENE_LAYER_ORDER) ensureLayerOrder(scene, layer);
    },

    exportSvg() {
      if (destroyed) throw new TypeError('Cannot export a destroyed SVG mechanism renderer');
      return new XMLSerializer().serializeToString(svg);
    },

    domNodeCount() {
      return host.querySelectorAll('*').length;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      activeHandle = undefined;
      currentScene = undefined;
      host.removeEventListener('keydown', hostKeyDown);
      nodes.clear();
      handlePoints.clear();
      host.replaceChildren(...originalChildren);
      restoreAttribute(host, 'tabindex', originalTabIndex);
      restoreAttribute(host, 'role', originalRole);
      restoreAttribute(host, 'aria-label', originalAriaLabel);
      restoreAttribute(host, 'data-renderer', originalDataRenderer);
      restoreAttribute(host, 'data-scene', originalDataScene);
    },
  };
}
