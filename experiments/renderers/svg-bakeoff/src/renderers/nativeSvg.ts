import type { HandlePrimitive, MechanismScene, ScenePrimitive, Vec2 } from '../scene.js';
import { SVG_HEIGHT, SVG_WIDTH, clientToWorld, project, sceneClassName, type CandidateRenderer, type RendererCallbacks } from './types.js';

const NS = 'http://www.w3.org/2000/svg';

interface NativeNode { group: SVGGElement; type: ScenePrimitive['type']; }

function element<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, name);
}

function setLine(line: SVGLineElement, a: Vec2, b: Vec2, scene: MechanismScene): void {
  const pa = project(a, scene.viewport); const pb = project(b, scene.viewport);
  line.setAttribute('x1', String(pa.x)); line.setAttribute('y1', String(pa.y)); line.setAttribute('x2', String(pb.x)); line.setAttribute('y2', String(pb.y));
}

export function createNativeSvgRenderer(host: HTMLElement, callbacks: RendererCallbacks): CandidateRenderer {
  host.tabIndex = 0; host.setAttribute('role', 'group');
  const svg = element('svg'); svg.setAttribute('viewBox', `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Atlas mechanism diagram rendered with native SVG');
  const defs = element('defs');
  const marker = element('marker'); marker.setAttribute('id', `arrow-${Math.random().toString(36).slice(2)}`); marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '8'); marker.setAttribute('refY', '5'); marker.setAttribute('markerWidth', '7'); marker.setAttribute('markerHeight', '7'); marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = element('path'); arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); arrowPath.setAttribute('fill', 'currentColor'); marker.append(arrowPath); defs.append(marker); svg.append(defs);
  const root = element('g'); svg.append(root); host.replaceChildren(svg);
  const nodes = new Map<string, NativeNode>();
  const handlePoints = new Map<string, Vec2>();
  let scene: MechanismScene | undefined;
  let activeHandle: { id: string; handle: HandlePrimitive['handle']; pointerId: number } | undefined;

  const create = (primitive: ScenePrimitive): NativeNode => {
    const group = element('g'); group.dataset.primitive = primitive.id; root.append(group);
    if (primitive.type === 'segment' || primitive.type === 'vector') { group.append(element('line'), element('line')); }
    else if (primitive.type === 'circle' || primitive.type === 'handle') { group.append(element('circle'), element('circle')); }
    else if (primitive.type === 'polyline') { group.append(element('polyline')); }
    else if (primitive.type === 'label') { group.append(element('text')); }
    else if (primitive.type === 'dimension') { group.append(element('line'), element('line'), element('line'), element('text')); }
    group.addEventListener('click', () => { const id = group.dataset.selectId; if (id) callbacks.onSelect(id); });
    group.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const id = group.dataset.selectId;
      if (id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); callbacks.onSelect(id); }
      const handle = group.dataset.handle;
      const point = handlePoints.get(primitive.id);
      if (point && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault(); const sign = event.key === 'ArrowRight' ? 1 : -1;
        if (handle === 'input') callbacks.onNudgeInput(sign * 2);
        if (handle === 'parameter') callbacks.onParameterDrag({ x: point.x + sign * .005, y: point.y });
      }
    });
    group.addEventListener('pointerdown', (event) => {
      const handle = group.dataset.handle as HandlePrimitive['handle'] | undefined;
      if (!handle || handle === 'invalid') return;
      event.preventDefault(); activeHandle = { id: primitive.id, handle, pointerId: event.pointerId }; svg.setPointerCapture(event.pointerId);
    });
    return { group, type: primitive.type };
  };

  svg.addEventListener('pointermove', (event) => {
    if (!activeHandle || !scene) return;
    const point = clientToWorld(event.clientX, event.clientY, host, scene.viewport);
    if (activeHandle.handle === 'input') callbacks.onInputDrag(point); else if (activeHandle.handle === 'parameter') callbacks.onParameterDrag(point);
  });
  svg.addEventListener('pointerup', (event) => { if (activeHandle?.pointerId === event.pointerId) { activeHandle = undefined; svg.releasePointerCapture(event.pointerId); } });
  host.addEventListener('keydown', (event) => { if (event.target !== host) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); callbacks.onNudgeInput(event.key === 'ArrowRight' ? 2 : -2); } });

  const updateNode = (node: NativeNode, primitive: ScenePrimitive, current: MechanismScene): void => {
    const group = node.group; group.dataset.selectId = primitive.selectId ?? ''; group.dataset.handle = primitive.type === 'handle' ? primitive.handle : '';
    group.setAttribute('aria-label', primitive.ariaLabel ?? primitive.id);
    const focusable = primitive.selectId !== undefined || (primitive.type === 'handle' && primitive.handle !== 'invalid');
    group.setAttribute('tabindex', focusable ? '0' : '-1'); group.setAttribute('role', primitive.type === 'handle' ? 'slider' : primitive.selectId ? 'button' : 'presentation');
    const selected = primitive.selectId !== undefined && primitive.selectId === current.selectedId;
    if (primitive.type === 'segment') {
      const visible = group.children[0] as SVGLineElement; const hit = group.children[1] as SVGLineElement; setLine(visible, primitive.a, primitive.b, current); setLine(hit, primitive.a, primitive.b, current);
      visible.setAttribute('class', sceneClassName(primitive.classes, selected)); visible.setAttribute('stroke-width', String(primitive.width ?? 3)); visible.setAttribute('stroke-linecap', 'round'); hit.setAttribute('class', 'scene-hit'); hit.setAttribute('stroke-width', '20');
    } else if (primitive.type === 'circle' || primitive.type === 'handle') {
      const visible = group.children[0] as SVGCircleElement; const hit = group.children[1] as SVGCircleElement; const point = primitive.type === 'circle' ? primitive.center : primitive.at; const p = project(point, current.viewport); const radius = primitive.type === 'circle' ? primitive.radius / (current.viewport.maxX-current.viewport.minX) * SVG_WIDTH : 7; const strokeWidth = primitive.type === 'circle' ? (primitive.width ?? 2) : 2;
      visible.setAttribute('cx', String(p.x)); visible.setAttribute('cy', String(p.y)); visible.setAttribute('r', String(radius)); visible.setAttribute('class', sceneClassName(primitive.classes, selected)); visible.setAttribute('stroke-width', String(strokeWidth));
      if (primitive.type === 'handle' && primitive.shape === 'square') { visible.setAttribute('rx', '0'); visible.setAttribute('stroke-dasharray', primitive.handle === 'invalid' ? '3 3' : ''); }
      hit.setAttribute('cx', String(p.x)); hit.setAttribute('cy', String(p.y)); hit.setAttribute('r', String(Math.max(radius + 9, 16))); hit.setAttribute('class', 'scene-hit');
      if (primitive.type === 'handle') { handlePoints.set(primitive.id, primitive.at); visible.setAttribute('data-handle', primitive.handle); visible.classList.add('interaction-handle'); }
    } else if (primitive.type === 'polyline') {
      const polyline = group.children[0] as SVGPolylineElement; polyline.setAttribute('points', primitive.points.map((point) => { const p = project(point, current.viewport); return `${p.x},${p.y}`; }).join(' ')); polyline.setAttribute('class', sceneClassName(primitive.classes, selected)); polyline.setAttribute('stroke-width', String(primitive.width ?? 2)); polyline.setAttribute('fill', 'none'); polyline.setAttribute('stroke-linejoin', 'round');
    } else if (primitive.type === 'vector') {
      const visible = group.children[0] as SVGLineElement; const hit = group.children[1] as SVGLineElement; setLine(visible, primitive.from, primitive.to, current); setLine(hit, primitive.from, primitive.to, current); visible.setAttribute('class', sceneClassName(primitive.classes, selected)); visible.setAttribute('stroke-width', '2.2'); visible.setAttribute('marker-end', `url(#${marker.id})`); visible.style.color = 'var(--vector)'; hit.setAttribute('class', 'scene-hit'); hit.setAttribute('stroke-width', '16');
    } else if (primitive.type === 'label') {
      const text = group.children[0] as SVGTextElement; const p = project(primitive.at, current.viewport); text.setAttribute('x', String(p.x)); text.setAttribute('y', String(p.y)); text.setAttribute('class', sceneClassName(primitive.classes, selected)); text.textContent = primitive.text;
    } else if (primitive.type === 'dimension') {
      const line = group.children[0] as SVGLineElement; const tickA = group.children[1] as SVGLineElement; const tickB = group.children[2] as SVGLineElement; const text = group.children[3] as SVGTextElement; setLine(line, primitive.a, primitive.b, current); const a = project(primitive.a,current.viewport); const b = project(primitive.b,current.viewport); tickA.setAttribute('x1',String(a.x));tickA.setAttribute('x2',String(a.x));tickA.setAttribute('y1',String(a.y-5));tickA.setAttribute('y2',String(a.y+5));tickB.setAttribute('x1',String(b.x));tickB.setAttribute('x2',String(b.x));tickB.setAttribute('y1',String(b.y-5));tickB.setAttribute('y2',String(b.y+5)); [line,tickA,tickB].forEach((item)=>{ item.setAttribute('class',sceneClassName(primitive.classes,false)); item.setAttribute('stroke-width','1.2'); }); text.setAttribute('x',String((a.x+b.x)/2)); text.setAttribute('y',String((a.y+b.y)/2-7)); text.setAttribute('text-anchor','middle'); text.setAttribute('class','scene-label'); text.textContent=primitive.text;
    }
  };

  return {
    id: 'native',
    update(next) {
      scene = next; host.dataset.scene = next.id; const seen = new Set<string>();
      for (const primitive of next.primitives) { seen.add(primitive.id); let node = nodes.get(primitive.id); if (!node || node.type !== primitive.type) { node?.group.remove(); node = create(primitive); nodes.set(primitive.id,node); } updateNode(node,primitive,next); }
      for (const [id,node] of nodes) if (!seen.has(id)) { node.group.remove(); nodes.delete(id); handlePoints.delete(id); }
    },
    exportSvg: () => new XMLSerializer().serializeToString(svg),
    domNodeCount: () => host.querySelectorAll('*').length,
    destroy: () => { host.replaceChildren(); nodes.clear(); },
  };
}
