import { SVG } from '@svgdotjs/svg.js';
import type { HandlePrimitive, MechanismScene, ScenePrimitive, Vec2 } from '../scene.js';
import { SVG_HEIGHT, SVG_WIDTH, clientToWorld, project, sceneClassName, type CandidateRenderer, type RendererCallbacks } from './types.js';

type AnySvg = any;
interface SvgJsNode { group: AnySvg; visible: AnySvg; hit?: AnySvg; extras?: AnySvg[]; type: ScenePrimitive['type']; }

export function createSvgJsRenderer(host: HTMLElement, callbacks: RendererCallbacks): CandidateRenderer {
  host.tabIndex = 0; host.setAttribute('role','group');
  const draw: AnySvg = SVG().addTo(host).size('100%','100%').viewbox(0,0,SVG_WIDTH,SVG_HEIGHT).attr({ role:'img','aria-label':'Atlas mechanism diagram rendered with SVG.js' });
  const nodes = new Map<string,SvgJsNode>(); const handlePoints = new Map<string,Vec2>(); let scene: MechanismScene | undefined; let active: { id:string; handle:HandlePrimitive['handle']; pointerId:number } | undefined;

  const create = (primitive: ScenePrimitive): SvgJsNode => {
    const group = draw.group().attr({'data-primitive':primitive.id}); let visible:AnySvg; let hit:AnySvg|undefined; let extras:AnySvg[]|undefined;
    if (primitive.type==='segment' || primitive.type==='vector') { visible=group.line(); hit=group.line().addClass('scene-hit').stroke({width:20}); }
    else if (primitive.type==='circle' || primitive.type==='handle') { visible=group.circle(); hit=group.circle().addClass('scene-hit'); }
    else if (primitive.type==='polyline') visible=group.polyline();
    else if (primitive.type==='label') visible=group.text('');
    else { visible=group.line(); extras=[group.line(),group.line(),group.text('')]; }
    const node={group,visible,hit,extras,type:primitive.type};
    group.node.addEventListener('click',()=>{ const id=group.node.dataset.selectId; if(id) callbacks.onSelect(id); });
    group.node.addEventListener('keydown',(event:KeyboardEvent)=>{ const id=group.node.dataset.selectId; if(id&&(event.key==='Enter'||event.key===' ')){event.preventDefault();callbacks.onSelect(id);} const handle=group.node.dataset.handle; const point=handlePoints.get(primitive.id); if(point&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();const sign=event.key==='ArrowRight'?1:-1;if(handle==='input')callbacks.onNudgeInput(sign*2);if(handle==='parameter')callbacks.onParameterDrag({x:point.x+sign*.005,y:point.y});} });
    group.node.addEventListener('pointerdown',(event:PointerEvent)=>{ const handle=group.node.dataset.handle as HandlePrimitive['handle']|undefined; if(!handle||handle==='invalid')return;event.preventDefault();active={id:primitive.id,handle,pointerId:event.pointerId};draw.node.setPointerCapture(event.pointerId); });
    return node;
  };

  draw.node.addEventListener('pointermove',(event:PointerEvent)=>{if(!active||!scene)return;const point=clientToWorld(event.clientX,event.clientY,host,scene.viewport);if(active.handle==='input')callbacks.onInputDrag(point);else if(active.handle==='parameter')callbacks.onParameterDrag(point);});
  draw.node.addEventListener('pointerup',(event:PointerEvent)=>{if(active?.pointerId===event.pointerId){active=undefined;draw.node.releasePointerCapture(event.pointerId);}});
  host.addEventListener('keydown',(event)=>{if(event.target!==host)return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();callbacks.onNudgeInput(event.key==='ArrowRight'?2:-2);}});

  const setLine=(line:AnySvg,a:Vec2,b:Vec2,current:MechanismScene)=>{const pa=project(a,current.viewport),pb=project(b,current.viewport);line.plot(pa.x,pa.y,pb.x,pb.y);};
  const update=(node:SvgJsNode,primitive:ScenePrimitive,current:MechanismScene)=>{
    const selected=primitive.selectId!==undefined&&primitive.selectId===current.selectedId; node.group.attr({'data-select-id':primitive.selectId??'','data-handle':primitive.type==='handle'?primitive.handle:'',tabindex:primitive.selectId||(primitive.type==='handle'&&primitive.handle!=='invalid')?0:-1,role:primitive.type==='handle'?'slider':primitive.selectId?'button':'presentation','aria-label':primitive.ariaLabel??primitive.id});
    if(primitive.type==='segment'){setLine(node.visible,primitive.a,primitive.b,current);node.visible.attr({class:sceneClassName(primitive.classes,selected),'stroke-width':primitive.width??3,'stroke-linecap':'round'});setLine(node.hit,primitive.a,primitive.b,current);}
    else if(primitive.type==='circle'||primitive.type==='handle'){const point=primitive.type==='circle'?primitive.center:primitive.at;const p=project(point,current.viewport);const radius=primitive.type==='circle'?primitive.radius/(current.viewport.maxX-current.viewport.minX)*SVG_WIDTH:7;node.visible.center(p.x,p.y).radius(radius).attr({class:sceneClassName(primitive.classes,selected),'stroke-width':primitive.width??2});node.hit.center(p.x,p.y).radius(Math.max(radius+9,16));if(primitive.type==='handle'){handlePoints.set(primitive.id,primitive.at);node.visible.attr({'data-handle':primitive.handle,class:`${sceneClassName(primitive.classes,selected)} interaction-handle`});}}
    else if(primitive.type==='polyline'){node.visible.plot(primitive.points.map((point)=>{const p=project(point,current.viewport);return[p.x,p.y];})).fill('none').attr({class:sceneClassName(primitive.classes,selected),'stroke-width':primitive.width??2,'stroke-linejoin':'round'});}
    else if(primitive.type==='vector'){setLine(node.visible,primitive.from,primitive.to,current);node.visible.attr({class:sceneClassName(primitive.classes,selected),'stroke-width':2.2});setLine(node.hit,primitive.from,primitive.to,current);}
    else if(primitive.type==='label'){const p=project(primitive.at,current.viewport);node.visible.text(primitive.text).move(p.x,p.y-14).attr({class:sceneClassName(primitive.classes,selected)});}
    else {const a=project(primitive.a,current.viewport),b=project(primitive.b,current.viewport);setLine(node.visible,primitive.a,primitive.b,current);node.visible.attr({class:'scene-dimension','stroke-width':1.2});node.extras?.[0].plot(a.x,a.y-5,a.x,a.y+5).attr({class:'scene-dimension'});node.extras?.[1].plot(b.x,b.y-5,b.x,b.y+5).attr({class:'scene-dimension'});node.extras?.[2].text(primitive.text).center((a.x+b.x)/2,(a.y+b.y)/2-10).attr({class:'scene-label'});}
  };

  return {id:'svgjs',update(next){scene=next;host.dataset.scene=next.id;const seen=new Set<string>();for(const primitive of next.primitives){seen.add(primitive.id);let node=nodes.get(primitive.id);if(!node||node.type!==primitive.type){node?.group.remove();node=create(primitive);nodes.set(primitive.id,node);}update(node,primitive,next);}for(const[id,node]of nodes)if(!seen.has(id)){node.group.remove();nodes.delete(id);handlePoints.delete(id);}},exportSvg:()=>draw.svg(),domNodeCount:()=>host.querySelectorAll('*').length,destroy:()=>{draw.remove();nodes.clear();}};
}
