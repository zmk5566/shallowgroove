import type {AudioEngine} from './engine';
import type {Connector} from '../hardware/useHexblocks';
import {MIN_BPM,MAX_BPM} from '../model/tempo.ts';
import {hardwareKey,type HardwareMapping} from '../model/hardware.ts';
import {oscSignalKey,evaluateRemaps,isPerformanceTransform,midiControlKey,isPerformanceUnitSource,mapPerformanceValue,type PerformanceGraph} from '../model/performance.ts';
import {declaredPatchName} from '../model/patch-name.ts';

export function performanceDevices(engine:AudioEngine){
 const project=engine.project;
 if(!project||!engine.effects)return [];
 const channels=[...project.tracks.map((_,i)=>i),'delay','reverb','master'] as const;
 return channels.flatMap(channel=>{
  const track=typeof channel==='number'?project.tracks[channel]:null;
  const trackId=track?.id??String(channel),prefix=track?.name??trackId;
  const voice=typeof channel==='number'?engine.voices[channel]:undefined;
  const devices=[
   ...(voice?[{id:'instrument',name:voice.libraryRef?.name??declaredPatchName(voice.code)??'Instrument',controls:engine.describe(voice.node),values:voice.values,wetOnly:false}]:[]),
   ...engine.effects!.chain(channel).effects.map(fx=>({...fx,name:fx.libraryRef?.name??declaredPatchName(fx.code)??fx.kind}))
  ];
  return devices.map(d=>({trackId,device:d.id,name:prefix+' / '+d.name,parameters:d.controls.filter(c=>c.max>c.min&&c.label!=='BPM'&&!(d.wetOnly&&c.label==='Mix')).map(c=>({
   address:c.address,label:c.label,min:c.min,max:c.max,step:c.step,value:engine.automationDisplay(trackId,d.id,c.address,d.values[c.address]??c.init)
  }))}));
 });
}

export function performanceSensors(connectors:Connector[]){
 return connectors.filter(c=>c.transport.connected).flatMap(c=>c.modules.flatMap(m=>{
  const ids=new Set([...(m.descriptor?.channels??[]).map(ch=>ch.id),...Object.keys(m.channels).map(Number)]);
  const moduleName=m.descriptor?.name??m.descriptor?.nm??m.name??m.uid;
  return [...ids].map(channel=>{
   const messageName=m.descriptor?.channels?.find(ch=>ch.id===channel)?.label??String(channel);
   return {uid:m.uid,channel,moduleName,messageName,name:moduleName+' / '+messageName};
  });
 }));
}

// One runtime per engine. View changes never interrupt active control signals.
export class ControlDisplay {
 private listeners=new Set<()=>void>();
 private current:Record<string,number>={};
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 snapshot=()=>this.current;
 publish(values:Record<string,number>){
  const keys=Object.keys(values);
  if(keys.length===Object.keys(this.current).length&&keys.every(id=>values[id]===this.current[id]))return;
  this.current=values;
  for(const listener of this.listeners)listener();
 }
}

export class PerformanceControls{
 private previous=new Map<string,{value:number;at:number;signature:string}>();
 private subscriptions=new Map<string,number>();
 private thresholds=new Map<string,boolean>();
 readonly risingThresholds:string[]=[];
 values:Record<string,number>={};
 frame(graph:PerformanceGraph,engine:AudioEngine,connectors:Connector[],subscribe:(id:string,uid:string,channel:number)=>void,keep:Set<string>,now:number,oscValues?:ReadonlyMap<string,readonly (number|string|boolean|null)[]>,midiValues?:ReadonlyMap<string,number>){
  const values:Record<string,number>=Object.create(null);
  const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
  const subscriptions=new Set<string>();
  for(const n of graph.nodes){
   if(n.kind==='osc-input'&&n.output==='value'){
    const sample=oscValues?.get(oscSignalKey(n.endpointId,n.address))?.[n.argument];
    if(typeof sample==='boolean')values[n.id]=Number(sample);
    if(typeof sample==='number'&&Number.isFinite(sample))values[n.id]=sample;
    continue;
   }
   if(n.kind==='midi-control'){
    const value=midiValues?.get(midiControlKey(n));if(value!==undefined)values[n.id]=value;
    continue;
   }
   if(n.kind==='knob'){values[n.id]=n.value??0;continue;}
   if(n.kind!=='sensor'||n.channel===undefined)continue;
   const connector=connectors.find(c=>c.transport.connected&&c.modules.some(m=>m.uid===n.uid));
   const module=connector?.modules.find(m=>m.uid===n.uid);
   if(!module||!connector)continue;
   const key=JSON.stringify([connector.id,module.uid,n.channel]);subscriptions.add(key);
   const sample=module.channels[n.channel];
   if(!this.subscriptions.has(key)||(!sample&&now-this.subscriptions.get(key)!>2000)){
    subscribe(connector.id,module.uid,n.channel);this.subscriptions.set(key,now);
   }
   const desc=module.descriptor?.channels?.find(c=>c.id===n.channel);
   const lo=desc?.min??0,hi=desc?.max??1;
   if(sample&&Number.isFinite(sample.value)&&hi>lo)values[n.id]=Math.max(0,Math.min(1,(sample.value-lo)/(hi-lo)));
  }
  for(const key of this.subscriptions.keys())if(!subscriptions.has(key))this.subscriptions.delete(key);
  this.risingThresholds.length=0;evaluateRemaps(graph,values,this.thresholds,this.risingThresholds);
  let performanceBpm:number|undefined;
  for(const route of graph.routes??[]){
   if(route.input==='bpm'&&engine.performanceDsp===true&&Number.isFinite(values[route.source])){
    performanceBpm=Math.round(Math.max(MIN_BPM,Math.min(MAX_BPM,values[route.source]))*100)/100;
    values[route.id]=performanceBpm;
   }
   if(isPerformanceTransform(nodes.get(route.target))&&Number.isFinite(values[route.source]))values[route.id]=values[route.source];
  }
  if(engine.performanceDsp===true)engine.setPerformanceBpm(performanceBpm);
  const active=new Set<string>();
  for(const link of graph.links){
   const dest=nodes.get(link.target),input=values[link.source];
   if(!dest?.trackId||!dest.device||input===undefined)continue;
   const mapping:HardwareMapping={id:link.id,connectorId:'performance',uid:'',channel:0,trackId:dest.trackId,device:dest.device,address:link.address,label:link.address,inputMin:0,inputMax:1,outputMin:Math.min(link.min,link.max),outputMax:Math.max(link.min,link.max),curve:link.scale,invert:false,smoothingMs:0,enabled:true};
   const key=hardwareKey(mapping);
   if(keep.has(key))continue;
   const source=nodes.get(link.source);
   const binding=source?.kind==='osc-input'?[oscSignalKey(source.endpointId,source.address),source.argument]:undefined;
   const signature=JSON.stringify([key,link.source,link.min,link.max,link.scale,link.smoothMs,binding]);
   const previous=this.previous.get(link.id);
   const same=previous?.signature===signature;
   const goal=isPerformanceUnitSource(source)
    ?Math.max(link.min,Math.min(link.max,input))
    :mapPerformanceValue(link,input);
   const weight=same&&link.smoothMs>0?-Math.expm1(-(now-previous.at)/link.smoothMs):1;
   let value=same?previous.value+(goal-previous.value)*weight:goal;

   if(Math.abs(goal-value)<=1e-6*Math.max(1,Math.abs(link.max-link.min)))value=goal;
   const held=engine.hardwareValues.get(key);
   const unchanged=same&&previous.value===value&&held?.mapping.id===link.id&&held.param===engine.automationTarget(mapping)?.param;
   if(!unchanged&&!engine.applyHardware(mapping,value))continue;
   keep.add(key);active.add(link.id);values[link.id]=engine.hardwareValues.get(key)!.value;
   this.previous.set(link.id,{value,at:now,signature});
  }
  for(const id of this.previous.keys())if(!active.has(id))this.previous.delete(id);
  this.values=values;
 }
}
