import * as JXGModule from 'jsxgraph';
import 'jsxgraph/distrib/jsxgraph.css';
import type { MechanismScene, ScenePrimitive, Vec2 } from '../scene.js';
import type { CandidateRenderer, RendererCallbacks } from './types.js';

const JXG: any = (JXGModule as any).default ?? JXGModule;
interface JxNode { object:any; type:ScenePrimitive['type']; }

function circlePoints(center:Vec2,radius:number,samples=56):Vec2[]{return Array.from({length:samples+1},(_,i)=>{const angle=i/samples*Math.PI*2;return{x:center.x+radius*Math.cos(angle),y:center.y+radius*Math.sin(angle)};});}
function primitivePoints(primitive:ScenePrimitive):Vec2[]{if(primitive.type==='segment')return[primitive.a,primitive.b];if(primitive.type==='polyline')return primitive.points;if(primitive.type==='vector')return[primitive.from,primitive.to];if(primitive.type==='circle')return circlePoints(primitive.center,primitive.radius);if(primitive.type==='dimension')return[primitive.a,primitive.b];return[];}

export function createJsxGraphRenderer(host:HTMLElement,callbacks:RendererCallbacks):CandidateRenderer{
  host.tabIndex=0;host.setAttribute('role','group'); if(!host.id)host.id=`jsxgraph-${Math.random().toString(36).slice(2)}`;
  const nodes=new Map<string,JxNode>(); const primitiveById=new Map<string,ScenePrimitive>();
  const board=JXG.JSXGraph.initBoard(host.id,{boundingbox:[-.05,.13,.28,-.13],axis:false,showNavigation:false,showCopyright:false,keepaspectratio:false,pan:{enabled:false},zoom:{enabled:false},renderer:'svg'});
  const setViewport=(next:MechanismScene)=>{board.setBoundingBox([next.viewport.minX,next.viewport.maxY,next.viewport.maxX,next.viewport.minY],false);};
  const decorate=(object:any,primitive:ScenePrimitive)=>{const node=object.rendNode as SVGElement|undefined;if(!node)return;node.setAttribute('data-primitive',primitive.id);if(primitive.type==='handle')node.setAttribute('data-handle',primitive.handle);if(primitive.type==='handle')node.classList.add('interaction-handle');if(primitive.selectId)node.setAttribute('data-select-id',primitive.selectId);node.setAttribute('aria-label',primitive.ariaLabel??primitive.id);node.setAttribute('role',primitive.type==='handle'?'slider':primitive.selectId?'button':'presentation');if(primitive.selectId||(primitive.type==='handle'&&primitive.handle!=='invalid'))node.setAttribute('tabindex','0');};
  const create=(primitive:ScenePrimitive):JxNode=>{
    let object:any;
    if(primitive.type==='label'){object=board.create('text',[primitive.at.x,primitive.at.y,primitive.text],{fixed:true,highlight:false,fontSize:12,strokeColor:'#74716a'});}
    else if(primitive.type==='handle'){object=board.create('point',[primitive.at.x,primitive.at.y],{name:'',size:primitive.shape==='square'?5:4,face:primitive.shape==='square'?'[]':'o',fixed:primitive.handle==='invalid',strokeColor:primitive.handle==='invalid'?'#a43e35':'#c45c38',fillColor:'#fbfaf6',highlight:false});object.on('drag',()=>{if(primitive.handle==='invalid')return;const point={x:object.X(),y:object.Y()};if(primitive.handle==='input')callbacks.onInputDrag(point);else callbacks.onParameterDrag(point);});}
    else {const points=primitivePoints(primitive);object=board.create('curve',[points.map(p=>p.x),points.map(p=>p.y)],{fixed:true,highlight:false,strokeWidth:primitive.type==='segment'?(primitive.width??3):primitive.type==='polyline'?(primitive.width??2):2,strokeColor:primitive.classes.includes('scene-vector')?'#365e7d':primitive.classes.includes('scene-trace')?'#9d998f':primitive.classes.includes('scene-ground')?'#97938a':'#191917',dash:primitive.classes.includes('scene-trace')?2:0});}
    object.on?.('down',()=>{const current=primitiveById.get(primitive.id);if(current?.selectId)callbacks.onSelect(current.selectId);});decorate(object,primitive);return{object,type:primitive.type};
  };
  const updateNode=(node:JxNode,primitive:ScenePrimitive,current:MechanismScene)=>{
    primitiveById.set(primitive.id,primitive);const selected=primitive.selectId!==undefined&&primitive.selectId===current.selectedId;
    if(primitive.type==='label'){node.object.setText(primitive.text);node.object.coords.setCoordinates(JXG.COORDS_BY_USER,[primitive.at.x,primitive.at.y]);}
    else if(primitive.type==='handle'){node.object.setPosition(JXG.COORDS_BY_USER,[primitive.at.x,primitive.at.y]);node.object.setAttribute({strokeColor:primitive.handle==='invalid'?'#a43e35':'#c45c38',fillColor:primitive.handle==='invalid'?'#f1d8cd':'#fbfaf6'});}
    else {const points=primitivePoints(primitive);node.object.dataX=points.map(p=>p.x);node.object.dataY=points.map(p=>p.y);node.object.setAttribute({strokeColor:selected?'#c45c38':primitive.classes.includes('scene-vector')?'#365e7d':primitive.classes.includes('scene-trace')?'#9d998f':primitive.classes.includes('scene-ground')?'#97938a':'#191917',strokeWidth:selected?4:primitive.type==='segment'?(primitive.width??3):primitive.type==='polyline'?(primitive.width??2):2});node.object.updateCurve?.();}
    decorate(node.object,primitive);
  };
  host.addEventListener('keydown',(event)=>{if(event.target!==host)return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();callbacks.onNudgeInput(event.key==='ArrowRight'?2:-2);}});
  return{id:'jsxgraph',update(next){host.dataset.scene=next.id;setViewport(next);board.suspendUpdate();const seen=new Set<string>();for(const primitive of next.primitives){seen.add(primitive.id);let node=nodes.get(primitive.id);if(!node||node.type!==primitive.type){if(node)board.removeObject(node.object);node=create(primitive);nodes.set(primitive.id,node);}updateNode(node,primitive,next);}for(const[id,node]of nodes)if(!seen.has(id)){board.removeObject(node.object);nodes.delete(id);primitiveById.delete(id);}board.unsuspendUpdate();},exportSvg:()=>host.querySelector('svg')?.outerHTML??null,domNodeCount:()=>host.querySelectorAll('*').length,destroy:()=>{JXG.JSXGraph.freeBoard(board);host.replaceChildren();nodes.clear();}};
}
