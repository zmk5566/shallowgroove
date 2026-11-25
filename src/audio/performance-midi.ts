import {oscSignalKey,isPerformanceUnitSource,retriggerDivisions,type PerformanceGraph,type PerformanceNode} from '../model/performance.ts';
const syncBeats=retriggerDivisions.map(option=>option.beats).sort((a,b)=>a-b);
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
type Output={track:number;channel:number};
type Track={id:string;midi_channel:number};
type Held={output:Output;notes:Set<number>;pedal:boolean};
type Voice={nodeId:string;pitch:number;velocity:number;lengthMs:number;trigger?:string;oscKey?:string;risingId?:string;gate?:string;output:Output};
type Pulse={interval:number;next:number};
export class PerformanceMidi {
 private held=new Map<string,Held>();
 private inputs=new Map<string,Map<number,Output>>();
 private pulses=new Map<string,Pulse>();
 private voices=new Map<string,Voice>();
 private ends=new Map<string,number>();
 readonly readings:Record<string,number>=Object.create(null);
 readonly intervals:Record<string,number>=Object.create(null);
 readonly pitches:Record<string,number>=Object.create(null);
 private timer:ReturnType<typeof setTimeout>|undefined;
 private deadline=Infinity;
 private send:(track:number,data:number[])=>void;
 private now:()=>number;
 constructor(send:(track:number,data:number[])=>void,now=()=>performance.now()){this.send=send;this.now=now;}
 private deliver(owner:string,output:Output,data:number[]){
  const [status,a,b]=data,kind=status>>4;
  let h=this.held.get(owner);
  const on=kind===9&&b>0,off=kind===8||(kind===9&&b===0),pedal=kind===11&&a===64;
  if(on||(pedal&&b>=64)){
   if(!h){h={output,notes:new Set(),pedal:false};this.held.set(owner,h);}
   if(on){
    const already=[...this.held.values()].some(other=>other!==h&&other.output.track===output.track&&other.notes.has(a));
    if(h.notes.has(a)&&!already)this.send(output.track,[128|output.channel,a,0]);
    h.notes.add(a);if(already)return;
   }else h.pedal=true;
  }else if(off||pedal){
   if(!h)return;
   if(off&&!h.notes.delete(a))return;
   if(pedal)h.pedal=false;
   if(!h.notes.size&&!h.pedal)this.held.delete(owner);
   if([...this.held.values()].some(other=>other.output.track===output.track&&(off?other.notes.has(a):other.pedal)))return;
  }
  this.send(output.track,[(status&240)|output.channel,...data.slice(1)]);
 }
 private release(owner:string){
  const held=this.held.get(owner);if(!held)return;
  for(const note of [...held.notes])this.deliver(owner,held.output,[128,note,0]);
  if(held.pedal)this.deliver(owner,held.output,[176,64,0]);
 }
 input(deviceId:string,data:number[]){
  if(data.length<2||data[0]<128||data[0]>=240)return;
  for(const output of this.inputs.get(deviceId)?.values()??[]){
   const owner=JSON.stringify(['input',deviceId,output.track,data[0]&15]);
   if((data[0]>>4)===11&&[120,123].includes(data[1])){this.release(owner);continue;}
   this.deliver(owner,output,data);
  }
 }
 disconnect(deviceId:string){
  for(const track of this.inputs.get(deviceId)?.keys()??[])this.releaseInput(deviceId,track);
  this.inputs.delete(deviceId);
 }
 private releaseInput(id:string,track:number){
  for(let ch=0;ch<16;ch++)this.release(JSON.stringify(['input',id,track,ch]));
 }
 sync(graph:PerformanceGraph|undefined,tracks:Track[],values:Record<string,number>,bpm:number,webDevices:string[],armed:number){
  const nodes=new Map(graph?.nodes.map(n=>[n.id,n])),routes=graph?.routes??[];
  const inputs=new Map<string,Map<number,Output>>(),nativeRoutes=new Map<string,{deviceId:string;track:number}>();
  const voices=new Map<string,Voice>(),pulses=new Map<string,Pulse>();
  const now=this.now(),web=new Set(webDevices);
  const inputsOf=new Map(routes.filter(r=>r.input!=='midi').map(r=>[JSON.stringify([r.target,r.input]),r]));
  function addInput(id:string,track:number){
   let targets=inputs.get(id);if(!targets){targets=new Map();inputs.set(id,targets);}
   targets.set(track,{track,channel:tracks[track].midi_channel-1});
  }
  if(tracks[armed])for(const id of web)addInput(id,armed);
  const readings=this.readings;
  for(const id of Object.keys(readings))delete readings[id];
  function control(target:string,input:string,fallback:number,normalized:(n:number)=>number,inUnits:(n:number)=>number,disconnect?:number){
   const route=inputsOf.get(JSON.stringify([target,input]));
   if(!route)return fallback;
   const sample=values[route.source];
   const value=Number.isFinite(sample)
    ? isPerformanceUnitSource(nodes.get(route.source))?inUnits(sample):normalized(clamp(sample,0,1))
    : disconnect;
   if(value!==undefined)readings[route.id]=value;
   return value;
  }
  const timeScale=(n:number)=>10+1990*n;
  const milliseconds=(n:number)=>Math.max(1,n);
  function intervalValue(clock:Extract<PerformanceNode,{kind:'retrigger'}>){
   if(clock.timing==='free')return control(clock.id,'interval',clock.intervalMs??250,timeScale,milliseconds);
   return control(clock.id,'interval',clock.division,
    n=>syncBeats[Math.round(n*(syncBeats.length-1))],
    n=>syncBeats.reduce((best,b)=>Math.abs(b-n)<Math.abs(best-n)?b:best));
  }
  for(const id of Object.keys(this.intervals))delete this.intervals[id];
  for(const id of Object.keys(this.pitches))delete this.pitches[id];
  const activeClocks=new Set<string>(),notes=new Map<string,{pitch:number;velocity:number;lengthMs:number}>();
  const gate=(n:number)=>Number(n>=.5);
  for(const node of nodes.values()){
   if(node.kind==='retrigger'){
    if(control(node.id,'enabled',Number(node.enabled),gate,gate,Number(node.enabled)))activeClocks.add(node.id);
    const value=intervalValue(node);
    if(value!==undefined)this.intervals[node.id]=value;
   }
   if(node.kind!=='note')continue;
   const low=node.pitchMin??0,high=node.pitchMax??127;
   const pitch=control(node.id,'pitch',node.pitch,n=>Math.round(low+(high-low)*n),n=>clamp(Math.round(n),0,127));
   const velocity=control(node.id,'velocity',node.velocity,n=>Math.round(1+126*n),n=>clamp(Math.round(n),1,127));
   const lengthMs=inputsOf.has(JSON.stringify([node.id,'gate']))?node.lengthMs:control(node.id,'lengthMs',node.lengthMs,timeScale,milliseconds);
   if(pitch!==undefined)this.pitches[node.id]=pitch;
   if(pitch!==undefined&&velocity!==undefined&&lengthMs!==undefined)notes.set(node.id,{pitch,velocity,lengthMs});
  }
  for(const route of routes){
   if(route.input!=='midi')continue;
   const source=nodes.get(route.source),dest=nodes.get(route.target);
   if(dest?.device!=='instrument')continue;
   const track=tracks.findIndex(t=>t.id===dest.trackId);if(track<0)continue;
   if(source?.kind==='midi-input'){
    const deviceId=source.midiDeviceId;
    nativeRoutes.set(JSON.stringify([deviceId,track]),{deviceId,track});
    if(web.has(deviceId))addInput(deviceId,track);
   }else if(source?.kind==='note'){
    const note=notes.get(source.id);if(!note)continue;
    const gateRoute=inputsOf.get(JSON.stringify([source.id,'gate']));
    if(gateRoute){
     const open=Number(values[gateRoute.source]>=.5);
     readings[gateRoute.id]=open;
     if(!open)continue;
    }
    const triggerRoute=inputsOf.get(JSON.stringify([source.id,'trigger']));
    const trigger=triggerRoute&&nodes.get(triggerRoute.source);
    const oscKey=trigger?.kind==='osc-input'&&trigger.output==='trigger'?oscSignalKey(trigger.endpointId,trigger.address):undefined;
    if(triggerRoute&&oscKey===undefined&&trigger?.kind!=='threshold'){
     if(trigger?.kind!=='retrigger'||!activeClocks.has(trigger.id))continue;
     const units=this.intervals[trigger.id];if(units===undefined)continue;
     const interval=trigger.timing==='free'?units:Math.max(1,60000*units/bpm);
     if(!(interval>0&&Number.isFinite(interval)))continue;
     const old=this.pulses.get(trigger.id);
     const next=old?(old.interval===interval?old.next:now+Math.max(0,(old.next-now)/old.interval)*interval):now;
     pulses.set(trigger.id,{interval,next});
    }
    voices.set(route.id,{nodeId:source.id,...note,trigger:triggerRoute?.source,gate:gateRoute?.source,risingId:trigger?.kind==='threshold'?trigger.id:undefined,oscKey,output:{track,channel:tracks[track].midi_channel-1}});
   }
  }
  for(const [id,targets] of this.inputs){
   for(const [track,target] of targets)if(inputs.get(id)?.get(track)?.channel!==target.channel)this.releaseInput(id,track);
  }
  for(const [id,v] of this.voices){
   const next=voices.get(id);
   if(!next||next.nodeId!==v.nodeId||next.risingId!==v.risingId||next.gate!==v.gate||next.trigger!==v.trigger||next.oscKey!==v.oscKey||next.output.track!==v.output.track||next.output.channel!==v.output.channel){
    this.release('note:'+id);this.ends.delete(id);
   }
  }
  for(const [id,v] of voices){
   if(v.gate!==undefined&&!this.held.has('note:'+id))this.deliver('note:'+id,v.output,[144,v.pitch,v.velocity]);
  }
  this.inputs=inputs;this.voices=voices;this.pulses=pulses;
  this.tick();
  return [...nativeRoutes.values()];
 }
 private playVoice(route:string,v:Voice,now:number){
  this.release('note:'+route);this.deliver('note:'+route,v.output,[144,v.pitch,v.velocity]);
  this.ends.set(route,now+v.lengthMs);
 }
 thresholdTrigger(id:string){
  const now=this.now();
  for(const [route,v] of this.voices)if(v.risingId===id)this.playVoice(route,v,now);
  this.tick();
 }
 oscTrigger(address:string,endpointId?:string){
  const now=this.now(),key=oscSignalKey(endpointId,address);
  for(const [route,v] of this.voices)if(v.oscKey===key)this.playVoice(route,v,now);
  this.tick();
 }
 trigger(noteId:string){
  const now=this.now();
  for(const [route,v] of this.voices)if(v.nodeId===noteId&&v.trigger===undefined&&v.gate===undefined)this.playVoice(route,v,now);
  this.tick();
 }
 tick(){
  const now=this.now();
  for(const [id,end] of this.ends)if(end<=now){this.release('note:'+id);this.ends.delete(id);}
  for(const [id,pulse] of this.pulses)if(pulse.next<=now){
   for(const [route,v] of this.voices)if(v.trigger===id)this.playVoice(route,v,now);
   // Preserve pulse phase without queuing a burst after a suspended renderer.
   pulse.next+=(1+Math.floor((now-pulse.next)/pulse.interval))*pulse.interval;
  }
  const next=Math.min(Infinity,...this.ends.values(),...[...this.pulses.values()].map(p=>p.next));
  if(this.deadline===next)return;
  clearTimeout(this.timer);this.deadline=next;
  if(Number.isFinite(next))this.timer=setTimeout(()=>{this.deadline=Infinity;this.tick();},Math.min(2147483647,Math.max(1,next-now)));
 }
 stop(){
  clearTimeout(this.timer);this.deadline=Infinity;
  for(const owner of this.held.keys())this.release(owner);
  this.inputs.clear();this.voices.clear();this.pulses.clear();this.ends.clear();
 }
}
