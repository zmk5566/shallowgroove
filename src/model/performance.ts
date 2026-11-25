interface PerformanceNodeBase {
 id:string;
 name:string;
 trackId?:string;
 device?:string;
 uid?:string;
 channel?:number;
 value?:number;
}
export type PerformanceNode = PerformanceNodeBase & (
 | {kind:'knob'|'sensor'|'effect'}
 | {kind:'midi-input';midiDeviceId:string}
 | {kind:'midi-control';midiDeviceId:string;message:'cc'|'bend'|'pressure';controller?:number}
 | {kind:'threshold';low:number;high:number;manualValue:number}
 | {kind:'scale';root:number;scale:PerformanceScale;manualValue:number}
 | {kind:'osc-input';endpointId?:string;address:string;argument:number;output:'value'|'trigger'}
 | {kind:'note';pitch:number;pitchMin?:number;pitchMax?:number;velocity:number;lengthMs:number}
 | {kind:'retrigger';enabled:boolean;division:number;timing?:'sync'|'free';intervalMs?:number}
 | {kind:'remap';manualValue?:number;inMin:number;inMax:number;outMin:number;outMax:number}
);
const scaleDegrees={
 major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10], 'minor-pentatonic':[0,3,5,7,10],
 'major-pentatonic':[0,2,4,7,9], chromatic:[0,1,2,3,4,5,6,7,8,9,10,11]
};
export type PerformanceScale=keyof typeof scaleDegrees;
type MidiControl=Extract<PerformanceNode,{kind:'midi-control'}>;
export function oscSignalKey(endpointId:string|undefined,address:string):string {
 return endpointId===undefined||endpointId==='default'?address:JSON.stringify([endpointId,address]);
}
export function midiControlKey(node:MidiControl):string {
 return JSON.stringify([node.midiDeviceId,node.channel??0,node.message,node.message==='cc'?node.controller:null]);
}
export function updateMidiControlValues(graph:PerformanceGraph|undefined,deviceId:string,data:ArrayLike<number>,values:Map<string,number>):boolean {
 const [status,a,b]=[data[0],data[1],data[2]],kind=status>>4;
 if(!Number.isInteger(status)||status<128||status>239||![11,13,14].includes(kind)||
  !Number.isInteger(a)||a<0||a>127||(kind!==13&&(!Number.isInteger(b)||b<0||b>127)))return false;
 const message=kind===11?'cc':kind===13?'pressure':'bend';
 const bend=(b<<7)|a;
 const normalized=message==='cc'?b/127:message==='pressure'?a/127:
  bend<=8192?bend/16384:.5+(bend-8192)/16382;
 let matched=false;
 for(const node of graph?.nodes??[]){
  if(node.kind!=='midi-control'||node.midiDeviceId!==deviceId||node.message!==message||
    (node.channel&&node.channel!==(status&15)+1)||(message==='cc'&&node.controller!==a))continue;
  values.set(midiControlKey(node),normalized);matched=true;
 }
 return matched;
}
export interface PerformanceRoute {
 id:string;
 source:string;
 target:string;
 input:TransformInput|'gate'|'pitch'|'velocity'|'lengthMs'|'interval'|'enabled'|'trigger'|'midi';
}
export interface PerformanceLink {
 id:string;
 source:string;
 target:string;
 address:string;
 min:number;
 max:number;
 smoothMs:number;
 scale:'linear'|'log';
}
export interface PerformanceGraph {
 nodes:PerformanceNode[];
 links:PerformanceLink[];
 routes?:PerformanceRoute[];
 layout:Record<string,{x:number;y:number}>;
}
export type PerformanceEdit=
 | {op:'put_node';node:PerformanceNode;position?:{x:number;y:number}}
 | {op:'move_node';id:string;x:number;y:number}
 | {op:'remove_node';id:string}
 | {op:'put_link';link:PerformanceLink}
 | {op:'remove_link';id:string}
 | {op:'put_route';route:PerformanceRoute}
 | {op:'remove_route';id:string};

export function emptyPerformance():PerformanceGraph {return {nodes:[],links:[],layout:{}};}

// One beat is a quarter note; T denotes a triplet of the labeled note value.
export const retriggerDivisions = [32,16,8,4,2,1].flatMap(denominator=>[
 {label:'1/'+denominator+'T',beats:8/(3*denominator)},
 {label:'1/'+denominator,beats:4/denominator}
]);
export function isPerformanceNumericSource(node:PerformanceNode|undefined):boolean {
 return node?.kind==='knob'||node?.kind==='sensor'||node?.kind==='midi-control'||node?.kind==='threshold'||isPerformanceUnitSource(node);
}
export function isPerformanceUnitSource(node:PerformanceNode|undefined):boolean {
 return node?.kind==='remap'||node?.kind==='scale'||(node?.kind==='osc-input'&&node.output==='value');
}
function text(value:unknown):value is string {
 return typeof value==='string'&&value.trim().length>0&&value.length<=300;
}
function validId(value:unknown):value is string {
 return text(value)&&value!=='prototype'&&!Object.hasOwn(Object.prototype,value);
}
function validRange(link:PerformanceLink) {
 return Number.isFinite(link.min)&&Number.isFinite(link.max)&&link.min<link.max&&
  Number.isFinite(link.smoothMs)&&link.smoothMs>=0&&
  (link.scale==='linear'||(link.scale==='log'&&link.min>0));
}
export function validatePerformance(value:unknown):asserts value is PerformanceGraph {
 const graph=value as PerformanceGraph;
 if(!graph||!Array.isArray(graph.nodes)||!Array.isArray(graph.links)||(graph.routes!==undefined&&!Array.isArray(graph.routes))||!graph.layout||
    typeof graph.layout!=='object'||Array.isArray(graph.layout))throw Error('Invalid performance graph');
 const nodes=new Map<string,PerformanceNode>();
 for(const node of graph.nodes){
  if(!node||!validId(node.id)||!text(node.name)||!['knob','sensor','effect','midi-input','note','retrigger','remap','osc-input','threshold','scale','midi-control'].includes(node.kind))throw Error('Invalid performance node');
  if(nodes.has(node.id))throw Error('Duplicate performance node');
  if(node.kind==='effect'&&(!text(node.trackId)||!text(node.device)))throw Error('Invalid performance effect target');
  if(node.uid!==undefined&&(!text(node.uid)||!Number.isInteger(node.channel)))throw Error('Invalid performance sensor binding');
  if(node.kind!=='midi-control'&&node.channel!==undefined&&(!text(node.uid)||!Number.isInteger(node.channel)||node.channel<0||node.channel>255))throw Error('Invalid performance sensor channel');
  if(node.value!==undefined&&(!Number.isFinite(node.value)||node.value<0||node.value>1))throw Error('Invalid performance control value');
  if(node.kind==='midi-control'&&(!text(node.midiDeviceId)||!['cc','pressure','bend'].includes(node.message)||
   (node.channel!==undefined&&(!Number.isInteger(node.channel)||node.channel<0||node.channel>16))||
   ((node.message==='cc'||node.controller!==undefined)&&(node.controller===undefined||!Number.isInteger(node.controller)||node.controller<0||node.controller>127))))throw Error('Invalid performance MIDI control');
  if(node.kind==='threshold'&&(![node.manualValue,node.low,node.high].every(Number.isFinite)||node.low>=node.high))throw Error('Invalid performance threshold');
  if(node.kind==='scale'&&(!Number.isFinite(node.manualValue)||!Number.isInteger(node.root)||node.root<0||node.root>11||!Object.hasOwn(scaleDegrees,node.scale)))throw Error('Invalid performance scale');
  if(node.kind==='osc-input'&&((node.endpointId!==undefined&&!text(node.endpointId))||!text(node.address)||!node.address.startsWith('/')||/[\s\u0000-\u001f]/u.test(node.address)||
    !Number.isSafeInteger(node.argument)||node.argument<0||!['value','trigger'].includes(node.output)))throw Error('Invalid performance OSC input');
  if(node.kind==='midi-input'&&!text(node.midiDeviceId))throw Error('Invalid performance MIDI input device');
  if(node.kind==='note'&&(!Number.isInteger(node.pitch)||node.pitch<0||node.pitch>127||
    ![node.pitchMin??0,node.pitchMax??127].every(p=>Number.isInteger(p)&&p>=0&&p<=127)||(node.pitchMin??0)>(node.pitchMax??127)||
    !Number.isInteger(node.velocity)||node.velocity<1||node.velocity>127||
    !Number.isFinite(node.lengthMs)||node.lengthMs<=0))throw Error('Invalid performance note');
  if(node.kind==='retrigger'&&(typeof node.enabled!=='boolean'||!Number.isFinite(node.division)||node.division<=0||
    (node.timing!==undefined&&node.timing!=='sync'&&node.timing!=='free')||
    (node.intervalMs!==undefined&&(!Number.isFinite(node.intervalMs)||node.intervalMs<=0))))throw Error('Invalid performance retrigger');
  if(node.kind==='remap'&&((node.manualValue!==undefined&&!Number.isFinite(node.manualValue))||![node.inMin,node.inMax,node.outMin,node.outMax].every(Number.isFinite)||node.inMin===node.inMax))throw Error('Invalid performance remap range');
  nodes.set(node.id,node);
 }
 for(const [id,pos] of Object.entries(graph.layout)){
  if(!nodes.has(id)||!pos||!Number.isFinite(pos.x)||pos.x<0||!Number.isFinite(pos.y)||pos.y<0)throw Error('Invalid performance node position');
 }
 const ids=new Set<string>(),parameters=new Set<string>();
 for(const link of graph.links){
  if(!link||!validId(link.id)||!text(link.address)||!validRange(link))throw Error('Invalid performance link');
  if(nodes.has(link.id)||ids.has(link.id))throw Error('Duplicate performance link');
  const source=nodes.get(link.source),target=nodes.get(link.target);
  if(!isPerformanceNumericSource(source)||target?.kind!=='effect')throw Error('Invalid performance link endpoints');
  const parameter=JSON.stringify([target.trackId,target.device,link.address]);
  if(parameters.has(parameter))throw Error('Duplicate performance parameter binding');
  parameters.add(parameter);ids.add(link.id);
 }
 const inputs=new Set<string>();
 for(const route of graph.routes??[]){
  if(!route||!validId(route.id)||nodes.has(route.id)||ids.has(route.id))throw Error('Invalid or duplicate performance route ID');
  const source=nodes.get(route.source),target=nodes.get(route.target);
  if(!source||!target||!canRoutePerformance(source,target,route.input))throw Error('Invalid performance route endpoints');
  const binding=JSON.stringify([route.target,route.input==='gate'?'trigger':route.input,route.input==='midi'?route.source:null]);
  if(inputs.has(binding))throw Error('Duplicate performance input binding');
  inputs.add(binding);ids.add(route.id);
 }
 transformOrder(graph);
}

type Transform=Extract<PerformanceNode,{kind:'remap'|'threshold'|'scale'}>;
export function isPerformanceTransform(node:PerformanceNode|undefined):node is Transform {
 return node?.kind==='remap'||node?.kind==='threshold'||node?.kind==='scale';
}
const remapInputs=['value','inMin','inMax','outMin','outMax'] as const;
type RemapInput=typeof remapInputs[number];
type TransformInput=RemapInput|'low'|'high';
function isTransformInput(input:PerformanceRoute['input']):input is TransformInput {
 if(input==='low'||input==='high')return true;
 return (remapInputs as readonly string[]).includes(input);
}
interface TransformStep {
 node:Transform;
 sources:Partial<Record<TransformInput,string>>;
 dependencies:number;
 children:TransformStep[];
}
function transformOrder(graph:PerformanceGraph){
 const steps=new Map<string,TransformStep>();
 for(const node of graph.nodes)if(isPerformanceTransform(node))steps.set(node.id,{node,sources:{},dependencies:0,children:[]});
 for(const route of graph.routes??[]){
  const target=steps.get(route.target);
  if(!target||!isTransformInput(route.input))continue;
  target.sources[route.input]=route.source;
  const source=steps.get(route.source);
  if(source){target.dependencies++;source.children.push(target);}
 }
 const ordered=[...steps.values()].filter(s=>!s.dependencies);
 for(let i=0;i<ordered.length;i++){
  for(const child of ordered[i].children)if(--child.dependencies===0)ordered.push(child);
 }
 if(ordered.length!==steps.size)throw Error('Cycle in performance numeric routes');
 return ordered;
}
function scalePitch(input:number,node:Extract<Transform,{kind:'scale'}>){
 const pitch=Math.max(0,Math.min(127,input)),degrees=scaleDegrees[node.scale];
 let low=Math.floor(pitch),high=Math.ceil(pitch);
 while(low>=0&&!degrees.includes((low-node.root+12)%12))low--;
 while(high<=127&&!degrees.includes((high-node.root+12)%12))high++;
 return low<0?high:high>127||pitch-low<=high-pitch?low:high;
}
export function evaluateRemaps(graph:PerformanceGraph,values:Record<string,number>,thresholdState=new Map<string,boolean>(),rising?:string[]):void {
 const liveThresholds=new Set<string>();
 for(const {node,sources} of transformOrder(graph)){
  function read(input:TransformInput,fallback:number):number {
   const source=sources[input];return source===undefined?fallback:values[source];
  }
  const input=read('value',node.manualValue??NaN);
  delete values[node.id];
  if(!Number.isFinite(input))continue;
  if(node.kind==='threshold'){
   const low=read('low',node.low),high=read('high',node.high);
   if(!Number.isFinite(low)||!Number.isFinite(high)||high<=low)continue;
   const previous=thresholdState.get(node.id)??false;
   const active=previous?input>low:input>=high;
   if(active&&!previous)rising?.push(node.id);
   liveThresholds.add(node.id);thresholdState.set(node.id,active);values[node.id]=Number(active);continue;
  }
  if(node.kind==='scale'){values[node.id]=scalePitch(input,node);continue;}
  const inMin=read('inMin',node.inMin),inMax=read('inMax',node.inMax),outMin=read('outMin',node.outMin),outMax=read('outMax',node.outMax);
  if(![inMin,inMax,outMin,outMax].every(Number.isFinite)||inMin===inMax)continue;
  const clamp=Math.min(Math.max(inMin,inMax),Math.max(Math.min(inMin,inMax),input));
  const span=inMax-inMin;
  const t=Number.isFinite(span)?(clamp-inMin)/span:(clamp/2-inMin/2)/(inMax/2-inMin/2);
  values[node.id]=(1-t)*outMin+t*outMax;
 }
 for(const id of thresholdState.keys())if(!liveThresholds.has(id))thresholdState.delete(id);
}
export function canRoutePerformance(source:PerformanceNode,target:PerformanceNode,input:PerformanceRoute['input'],graph?:PerformanceGraph):boolean {
 if((input==='gate'||input==='trigger')&&graph?.routes?.some(r=>r.target===target.id&&r.input===(input==='gate'?'trigger':'gate')))return false;
 if(isTransformInput(input)){
  if(!isPerformanceTransform(target)||!isPerformanceNumericSource(source)||source.id===target.id)return false;
  if(input!=='value'&&(target.kind==='scale'||(target.kind==='threshold')!==(input==='low'||input==='high')))return false;
  if(!graph||!isPerformanceTransform(source))return true;
  // A new cable closes a cycle when its proposed target already feeds its source.
  const reachable=new Set([target.id]);
  for(const step of transformOrder(graph)){
   if(Object.values(step.sources).some(id=>reachable.has(id)))reachable.add(step.node.id);
  }
  return !reachable.has(source.id);
 }
 switch(input){
  case 'interval':case 'enabled':return target.kind==='retrigger'&&isPerformanceNumericSource(source);
  case 'pitch':case 'velocity':case 'lengthMs':return target.kind==='note'&&isPerformanceNumericSource(source);
  case 'gate':return target.kind==='note'&&source.kind==='threshold';
  case 'trigger':return target.kind==='note'&&(source.kind==='threshold'||source.kind==='retrigger'||(source.kind==='osc-input'&&source.output==='trigger'));
  case 'midi':return target.kind==='effect'&&target.device==='instrument'&&(source.kind==='note'||source.kind==='midi-input');
  default:return false;
 }
}
function put<T extends {id:string}>(items:T[],item:T):T[]{
 return items.some(x=>x.id===item.id)?items.map(x=>x.id===item.id?{...item}:x):[...items,{...item}];
}
export const defaultPerformancePosition={x:32,y:32} as const;
function initialPosition(graph:PerformanceGraph) {
 const positions=graph.nodes.map(node=>graph.layout[node.id]??defaultPerformancePosition);
 for(let slot=0;;slot++){
  const x=defaultPerformancePosition.x+(slot%3)*256;
  const y=defaultPerformancePosition.y+Math.floor(slot/3)*192;
  if(positions.every(pos=>Math.abs(pos.x-x)>=240||Math.abs(pos.y-y)>=175))return {x,y};
 }
}
export function editPerformance(graph:PerformanceGraph,edit:PerformanceEdit):PerformanceGraph {
 let result:PerformanceGraph;
 switch(edit.op){
  case 'put_node':{
   const layout=Object.hasOwn(graph.layout,edit.node.id)?graph.layout:{...graph.layout,[edit.node.id]:edit.position??initialPosition(graph)};
   const node=edit.node.kind==='remap'&&edit.node.manualValue===undefined&&!graph.nodes.some(n=>n.id===edit.node.id)
    ?{...edit.node,manualValue:0}:edit.node;
   result={...graph,layout,nodes:put(graph.nodes,node)};
   break;
  }
  case 'move_node':
   result={...graph,layout:{...graph.layout,[edit.id]:{x:edit.x,y:edit.y}}};
   break;
  case 'remove_node':{
   if(!graph.nodes.some(node=>node.id===edit.id))throw Error('Unknown performance node');
   const layout={...graph.layout};delete layout[edit.id];
   result={...graph,nodes:graph.nodes.filter(node=>node.id!==edit.id),links:graph.links.filter(link=>link.source!==edit.id&&link.target!==edit.id),layout};
   if(graph.routes)result.routes=graph.routes.filter(route=>route.source!==edit.id&&route.target!==edit.id);
   break;
  }
  case 'put_link':result={...graph,links:put(graph.links,edit.link)};break;
  case 'remove_link':
   if(!graph.links.some(link=>link.id===edit.id))throw Error('Unknown performance link');
   result={...graph,links:graph.links.filter(link=>link.id!==edit.id)};
   break;
  case 'put_route':result={...graph,routes:put(graph.routes??[],edit.route)};break;
  case 'remove_route':
   if(!graph.routes?.some(route=>route.id===edit.id))throw Error('Unknown performance route');
   result={...graph,routes:graph.routes.filter(route=>route.id!==edit.id)};
   break;
  default:throw Error('Invalid performance edit');
 }
 validatePerformance(result);return result;
}

// Input is normalized. Previous values are in the parameter's physical units.
export function mapPerformanceValue(link:PerformanceLink,input:number,previous?:number,elapsedMs=0):number {
 if(!validRange(link)||!Number.isFinite(input)||!Number.isFinite(elapsedMs)||elapsedMs<0||
    (previous!==undefined&&!Number.isFinite(previous)))throw Error('Invalid performance sample');
 const n=Math.max(0,Math.min(1,input));
 const target=n===0?link.min:n===1?link.max:link.scale==='log'?
  Math.exp((1-n)*Math.log(link.min)+n*Math.log(link.max)):(1-n)*link.min+n*link.max;
 if(previous===undefined||link.smoothMs===0)return target;
 const last=Math.max(link.min,Math.min(link.max,previous));
 const weight=-Math.expm1(-elapsedMs/link.smoothMs);
 return (1-weight)*last+weight*target;
}
