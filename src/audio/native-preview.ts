import {systemOutput,type NativeOutput,type OutputOptions} from './native-output.ts';
import {NativeMeters} from './native-inspect.ts';
import {nativeBeatGrid} from './native-metronome.ts';
import {physicalValue,type AutomationLane} from '../model/automation.ts';
import {isTempoTarget,timeline,tempoMap,tempoSeconds,tempoTicks,type TempoPoint} from '../model/project.ts';
import {hardwareKey,type HardwareMapping} from '../model/hardware.ts';
import type {AudioEngine} from './engine';
import type {ChannelTarget,EffectDevice} from './effects';
import {NativeSession,sessionTiming,type SessionSlot} from './native-session.ts';


type NativeMessage = Record<string,unknown>;
export interface NativePreferences {engine:'web'|'native';midiInputs:string[];output:NativeOutput}
export interface NativeBridge {
 preferences():Promise<NativePreferences>;
 savePreferences(update:Partial<NativePreferences>):Promise<NativePreferences>;
 status():Promise<{available:boolean;running:boolean}>;
 outputOptions(device:string|null):Promise<OutputOptions>;
 applyOutput(change:{output:NativeOutput;position:number;graph:ReturnType<typeof nativeGraph>;monitor:{enabled:boolean;track:number};midiInputs:string[]}):Promise<NativeMessage>;
 request(command:NativeMessage):Promise<NativeMessage>;
 onEvent(fn:(event:NativeMessage)=>void):()=>void;
 stop():Promise<void>;
}
export type NativeInput={id:string;name:string;enabled:boolean};
type Parameter = {device:string;address:string;value:number};
type SequenceEvent = ({status:number;data1:number;data2:number}|Parameter)&{time:number;track:ChannelTarget};
export type NativeDetails = {audioDevice?:string;sampleRate?:number;bufferSize?:number;midiInputs:NativeInput[]};
const unsupported=(reason:string)=>Error('Native preview · '+reason);
export const busNames=['delay','reverb','master'] as const;
export function nativeChannel(engine:AudioEngine,id:string):ChannelTarget {
 const index=engine.project?.tracks.findIndex(t=>t.id===id)??-1;
 if(index>=0)return index;
 const bus=busNames.find(b=>b===id);if(bus)return bus;
 throw unsupported('Unknown routing destination: '+id);
}
function projectEffects(engine:AudioEngine,devices:EffectDevice[]){
 return devices.map(e=>{
  const bpm=e.controls.find(c=>c.label==='BPM'),values={...e.values};
  if(bpm)values[bpm.address]=Math.max(bpm.min,Math.min(bpm.max,engine.bpm));
  return {id:e.id,code:e.code,values,bypass:e.bypassed,wetOnly:e.wetOnly??false};
 });
}
function mixerValue(engine:AudioEngine,channel:ChannelTarget,address:string,value:number){
 if(typeof channel!=='number'){
  const bus=channel==='master'?engine.effects!.master!:engine.effects!.returns[channel];
  return bus.muted?0:value;
 }
 const voice=engine.voices[channel],track=engine.project!.tracks[channel];
 if(address==='gain')return track.mute||(engine.project!.tracks.some(t=>t.solo)&&!track.solo)?0:.2*voice.trim*value;
 if(address==='pan')return Math.max(-1,Math.min(1,value+voice.basePan));
 return value;
}
export function nativePreset(engine:AudioEngine,index=0,devices=engine.effects?.tracks[index]?.effects){
 const voice=engine.voices[index],track=engine.project?.tracks[index],chain=engine.effects?.tracks[index];
 if(!track||!voice||!chain||!devices)throw unsupported('Track unavailable');
 return {instrument:voice.code,values:{...voice.values},effects:projectEffects(engine,devices),
  gain:mixerValue(engine,index,'gain',track.gain),pan:mixerValue(engine,index,'pan',track.pan),sends:{...chain.amounts}};
}
export function nativeBus(engine:AudioEngine,id:typeof busNames[number],devices?:EffectDevice[]){
 const bus=id==='master'?engine.effects!.master!:engine.effects!.returns[id];
 return {gain:bus.muted?0:bus.level,effects:projectEffects(engine,devices??bus.effects)};
}
export function nativeGraph(engine:AudioEngine,p=engine.project){
 if(!p||!p.tracks.length||engine.voices.length!==p.tracks.length||!engine.effects?.master)throw unsupported('Track rack is not ready');
 return {racks:p.tracks.map((_,i)=>nativePreset(engine,i)),buses:Object.fromEntries(busNames.map(b=>[b,nativeBus(engine,b)]))};
}
export function nativeRackFile(engine:AudioEngine,index=0) {
 const {sends,...preset}=nativePreset(engine,index),voice=engine.voices[index];
 const devices=[{id:'instrument',controls:engine.describe(voice.node),values:voice.values},...voice.rack.effects];
 const slots=devices.flatMap(d=>[...d.controls].sort((a,b)=>a.address<b.address?-1:a.address>b.address?1:0)
  .filter(c=>c.max>c.min&&c.label!=='BPM').map(c=>({device:d.id,address:c.address,
   value:Math.max(0,Math.min(1,((d.values[c.address]??c.init)-c.min)/(c.max-c.min)))}))).slice(0,8);
 return {format:'shallowgroove-rack-v1',preset:{...preset,macros:slots.map(({device,address})=>({device,address}))},
  macroValues:Array.from({length:8},(_,i)=>slots[i]?.value??0)};
}

export function nativeSequence(engine:AudioEngine) {
 const project=engine.timingProject??engine.project!;
 const tempo=tempoMap(project),ppqn=project.timing.ppqn;
 function at(value:number,field:'tick'|'seconds'):TempoPoint{
  let low=0,high=tempo.length;
  while(high-low>1){const mid=(low+high)>>1;if(tempo[mid][field]<=value)low=mid;else high=mid;}
  return tempo[low];
 }
 function timeAt(tick:number){const p=at(tick,'tick');return p.seconds+tempoSeconds(p,tick-p.tick,ppqn);}
 function tickAt(time:number){const p=at(time,'seconds');return p.tick+tempoTicks(p,time-p.seconds,ppqn);}
 const events:SequenceEvent[]=timeline(project).filter(e=>[8,9,11,14].includes((e.status??0)>>4)).map(e=>({time:e.seconds,track:e.trackIndex,status:e.status!,data1:e.data[0],data2:e.data[1]}));
 const end=timeAt(project.timing.end_tick);
 function push(track:ChannelTarget,time:number,parameter:Parameter){
  if(events.length>=150000)throw unsupported('自动化序列过长 / Automation exceeds the preview capacity.');
  events.push({track,time,...parameter});
 }
 function add(lane:AutomationLane,time:number,normalized:number){
  let value=physicalValue(lane,normalized);
  const track=nativeChannel(engine,lane.trackId);
  if(lane.device==='mixer')value=mixerValue(engine,track,lane.address,value);
  push(track,time,{device:lane.device,address:lane.address,value});
 }
 for(const lane of engine.project?.automation??[]){
  if(lane.mode!=='read'||!lane.points.length||isTempoTarget(lane)||!engine.automationTarget(lane))continue;
  add(lane,0,lane.points[0].value);
  let from=0;
  for(let i=0;i<lane.points.length;i++){
   const point=lane.points[i],prev=lane.points[i-1],time=timeAt(point.tick);
   if(prev&&lane.interpolation==='linear'&&point.value!==prev.value){
    for(let t=from+.02;t<time;t+=.02)add(lane,t,prev.value+(point.value-prev.value)*(tickAt(t)-prev.tick)/(point.tick-prev.tick));
   }
   if(time>0)add(lane,time,point.value);
   from=time;
  }
 }
 for(const track of [...engine.voices.keys(),...busNames])for(const fx of engine.effects!.chain(track).effects){
  const bpm=fx.controls.find(c=>c.label==='BPM');if(!bpm)continue;
  for(let i=0;i<tempo.length;i++){
   const point=tempo[i],until=tempo[i+1]?.seconds??end;
   const bpmAt=(time:number)=>Math.max(bpm.min,Math.min(bpm.max,60e6/point.tempo+(point.slope??0)*(tickAt(time)-point.tick)));
   push(track,point.seconds,{device:fx.id,address:bpm.address,value:bpmAt(point.seconds)});
   if(point.slope)for(let t=point.seconds+.02;t<until;t+=.02)push(track,t,{device:fx.id,address:bpm.address,value:bpmAt(t)});
  }
 }
 events.sort((a,b)=>a.time-b.time);
 return {events,end};
}

export class NativePreview {
 private off:()=>void;
 private closed=false;
 private clock=0;
 private sessionClock=0;
 private sessionTick?:number;
 private timing?:ReturnType<typeof sessionTiming>;
 private session=new NativeSession();
 private measured=0;
 private running=false;
 private limit=Infinity;
 private loop:{start:number;end:number}|null=null;
 private hardware=new Map<string,{at:number;value:number}>();
 private countToken=0;
 private count?:{wire:{token:number;total:number;beats:number;interval:number};done:Promise<void>;finish:()=>void;display:(label:string)=>void};
 async countedPlay(bars:number,beats:number,interval:number,signal:AbortSignal,display:(label:string)=>void,launch:()=>Promise<void>){
  if(signal.aborted)return;
  const wire={token:++this.countToken,total:bars*beats,beats,interval};
  let finish!:()=>void;
  const done=new Promise<void>(resolve=>{finish=resolve;});
  const count=this.count={wire,done,finish,display};
  const abort=()=>{this.stop(this.clock);finish();};
  signal.addEventListener('abort',abort,{once:true});
  try{display('-'+bars+'.1');await launch();}
  finally{signal.removeEventListener('abort',abort);if(this.count===count)this.count=undefined;}
 }
 private generation=0;
 private endPending=false;
 private sequenceId=0;
 details:NativeDetails={midiInputs:[]};
 output:NativeOutput={...systemOutput};
 outputPending=false;
 private outputReady=false;
 private pendingDefault?:string;
 private midiIds:string[]=[];
 private performanceRouteKey='';
 private performanceRoutes:Array<{deviceId:string;track:number}>=[];
 setPerformanceMidiRoutes(routes:Array<{deviceId:string;track:number}>){
  const key=JSON.stringify(routes);
  if(key===this.performanceRouteKey)return;
  this.performanceRouteKey=key;this.performanceRoutes=routes;
  this.send({op:'setPerformanceMidiRoutes',routes});
 }
 probeRequest=(command:NativeMessage)=>{
  if(this.closed)return Promise.reject(Error('Native session closed'));
  return this.bridge.request(command);
 };
 readonly meters=new NativeMeters(this.probeRequest);
 private readonly bridge:NativeBridge;
 private readonly engine:AudioEngine;
 private readonly failed:(e:Error)=>void;
 constructor(bridge:NativeBridge,engine:AudioEngine,failed:(e:Error)=>void,ended:(offset:number)=>void){
  this.bridge=bridge;this.engine=engine;this.failed=failed;
  this.off=bridge.onEvent(event=>{
   if(this.closed)return;
   if(event.event==='disconnected'||event.event==='deviceLost'||event.event==='error'){this.failed(Error(String(event.error??'Native audio disconnected')));return;}
   if(event.event==='midi'&&typeof event.status==='number'&&typeof event.data1==='number'&&typeof event.data2==='number'){
    const data=[event.status,event.data1,event.data2];
    if(typeof event.track==='number')engine.onNativeMidi?.(data,typeof event.position==='number'?event.position:this.position,event.track);
    if(typeof event.deviceId==='string'&&engine.onPerformanceMidiControl){
     engine.onPerformanceMidiControl({deviceId:event.deviceId,data:(event.status>>4)===13?data.slice(0,2):data});
    }
   }
   const count=this.count;
   if(count&&event.event==='position'&&event.countToken===count.wire.token&&typeof event.countBeat==='number'){
    const beat=event.countBeat;
    if(beat<count.wire.total){count.display('-'+Math.ceil((count.wire.total-beat)/count.wire.beats)+'.'+(1+beat%count.wire.beats));return;}
    count.finish();
   }
   if(event.event==='outputDefaultChanged'){
    this.pendingDefault=String(event.audioDevice??'');this.followDefault();return;
   }
   if(event.event==='devices'){this.readDetails(event);engine.onNativeDevices?.();}
   if(event.event==='position'&&this.running&&typeof event.position==='number'&&Number.isFinite(event.position)){
    this.clock=event.position;this.sessionTick=typeof event.sessionTick==='number'?event.sessionTick:undefined;this.sessionClock=typeof event.sessionPosition==='number'?event.sessionPosition:event.position;this.measured=performance.now();if(event.playing===false&&!this.endPending){this.running=false;ended(this.clock);}
   }
  });
 }
 private readDetails(message:NativeMessage){
  if(Array.isArray(message.midiInputs))this.details.midiInputs=message.midiInputs.filter((d):d is NativeInput=>!!d&&typeof d.id==='string'&&typeof d.name==='string'&&typeof d.enabled==='boolean');
  if(typeof message.audioDevice==='string')this.details.audioDevice=message.audioDevice;
  if(typeof message.sampleRate==='number')this.details.sampleRate=message.sampleRate;
  if(typeof message.bufferSize==='number')this.details.bufferSize=message.bufferSize;
 }
 async load(output?:NativeOutput){
  const prefs=await this.bridge.preferences();this.output=prefs.output??{...systemOutput};
  this.midiIds=[...prefs.midiInputs];
  if(output){await this.installOutput(output);return;}
  await this.bridge.request({op:'load',...nativeGraph(this.engine)});
  const status=await this.bridge.request({op:'status'});if(status.audioError)throw Error(String(status.audioError));
  this.readDetails(status);
  await this.devices(this.midiIds.filter(id=>this.details.midiInputs.some(d=>id===d.id)),false);
 }
 readyForOutputChanges(){this.outputReady=true;this.followDefault();}
 private followDefault(){
  if(this.closed||!this.outputReady||this.outputPending||this.pendingDefault===undefined)return;
  const device=this.pendingDefault;this.pendingDefault=undefined;
  if(this.output.device!==null||(device&&device===this.details.audioDevice))return;
  this.engine.pauseForOutputChange();
  void this.applyOutput(this.output).catch(error=>{if(!this.closed)this.failed(error);});
 }
 private async installOutput(output:NativeOutput){
  const status=await this.bridge.applyOutput({output,position:this.engine.position,graph:nativeGraph(this.engine),monitor:this.engine.nativeMonitor,midiInputs:this.midiIds});
  if(this.closed||this.engine.native!==this)throw Error('Native session changed');
  this.output={...output};this.readDetails(status);this.hardware.clear();
  if(this.performanceRoutes.length)await this.bridge.request({op:'setPerformanceMidiRoutes',routes:this.performanceRoutes});
 }
 async applyOutput(output:NativeOutput){
  if(this.closed||!this.outputReady||this.outputPending||this.engine.playing||this.count)throw Error('Stop playback before changing audio output.');
  this.outputPending=true;this.engine.onNativeDevices?.();
  try{
   await this.installOutput(output);
   this.engine.replayNativeControls();
  }finally{
   this.outputPending=false;
   if(!this.closed){this.engine.onNativeDevices?.();queueMicrotask(()=>this.followDefault());}
  }
 }
 async replace(track:ChannelTarget,preset:ReturnType<typeof nativeBus>|ReturnType<typeof nativePreset>){
  await this.bridge.request({op:'replaceRack',track,preset});
  if(this.closed)throw Error('Native engine changed while compiling');
  this.hardware.clear();
 }
 async refreshMidiInputs(){this.readDetails(await this.bridge.request({op:'status'}));}
 async devices(ids:string[],remember=true){const res=await this.bridge.request({op:'setMidiInputs',ids});if(remember)this.midiIds=[...ids];this.readDetails(res);this.readDetails(await this.bridge.request({op:'status'}));}
 send(command:NativeMessage){
  if(!this.closed)void this.bridge.request(command).catch(error=>{if(!this.closed)this.failed(error);});
 }
 get position(){
  let t=this.clock+(this.running?Math.max(0,Math.min(.15,(performance.now()-this.measured)/1000)):0);
  if(this.loop&&t>=this.loop.end)t=this.loop.start+(t-this.loop.start)%(this.loop.end-this.loop.start);
  return this.session.engaged?t:Math.min(t,this.limit);
 }
 configureLoop(enabled:boolean,range:{start:number;end:number}){
  this.loop=enabled&&range.end>range.start?range:null;
  if(this.running)this.send({op:'setLoop',loop:this.loop});
 }
 get sessionEngaged(){return this.session.engaged;}
 get sessionPosition(){return this.sessionClock+(this.running?Math.min(.15,Math.max(0,performance.now()-this.measured)/1000):0);}
 private musicalTickAt(sessionPosition:number){
  if(this.sessionTick===undefined||!this.timing)return undefined;
  return this.sessionTick+this.timing.unwrapped(this.clock+sessionPosition-this.sessionClock,this.loop)-this.timing.unwrapped(this.clock,this.loop);
 }
 liveState(track:number){const now=this.sessionPosition;return this.session.state(track,now,this.musicalTickAt(now));}
 currentLaunches(){const now=this.sessionPosition;return this.session.current(now,this.musicalTickAt(now));}
 async launch(slots:SessionSlot[],at:number,tick:number){
  const generation=this.generation;
  const runs=this.session.prepare(this.engine.timingProject!,slots,tick,at,this.loop,this.musicalTickAt(at)??tick,this.timing);
  await this.bridge.request({op:'launch',at,slots:runs.map(r=>r.payload)});
  if(!this.closed&&this.running&&generation===this.generation)this.session.queue(runs,this.sessionPosition);
 }
 backToArrangement(){
  const at=this.sessionPosition,slots=this.session.tracks().map(track=>({track,arrangement:true}));
  if(slots.length)this.send({op:'launch',at,slots});this.session.clear();
 }
 async play(position:number,slots?:SessionSlot[]){
  const now=this.sessionPosition,previousTick=this.musicalTickAt(now);
  const pending=slots?[]:this.session.pending(now,previousTick);
  const active=slots??this.session.current(now,previousTick,false);
  const timing=sessionTiming(this.engine.timingProject!),startTick=timing.tick(position);
  const runs=this.session.prepare(this.engine.timingProject!,active,startTick,position,this.loop,startTick,timing);
  const sequence=nativeSequence(this.engine);this.limit=sequence.end;
  const generation=++this.generation;
  this.endPending=true;
  const run=++this.sequenceId;
  const count=this.count;
  const project=this.engine.timingProject??this.engine.project!;
  try{
   await this.bridge.request({op:'play',...sequence,slots:runs.map(r=>r.payload),position,loop:this.loop??undefined,
    beatGrid:nativeBeatGrid(project),metronome:this.engine.metronome,...(count?{countIn:count.wire}:{})});
   if(count)await count.done;
  }
  finally{if(run===this.sequenceId)this.endPending=false;}
  if(this.closed||generation!==this.generation)return;
  this.timing=timing;this.sessionTick=startTick;this.session.clear();this.session.queue(runs,position);this.sessionClock=position;this.clock=position;this.measured=performance.now();this.running=true;
  for(const next of pending){
   if(this.closed||generation!==this.generation)return;
   const at=timing.unwrappedSeconds(startTick+next.afterTicks,this.loop);
   await this.launch([next.slot],at,startTick+next.afterTicks);
  }
  for(const lane of this.engine.project?.automation??[]){
   if(isTempoTarget(lane)||!this.engine.automationOverrides.has(lane.id))continue;
   const target=this.engine.automationTarget(lane);
   if(target&&lane.device!=='mixer')this.parameter(nativeChannel(this.engine,lane.trackId),lane.device,lane.address,this.engine.hardwareValues.get(hardwareKey(lane))?.value??target.base);
   if(lane.device==='mixer')this.mix(nativeChannel(this.engine,lane.trackId),lane.address);
  }
 }
 stop(position:number){this.count?.finish();this.count=undefined;this.session.clear();this.sessionClock=position;this.generation++;this.running=false;this.clock=position;this.send({op:'stop'});}
 seek(position:number){if(this.session.tracks().length){void this.play(position).catch(e=>this.failed(e));return;}this.sessionClock=position;this.clock=position;this.measured=performance.now();this.send({op:'seek',position});}
 hardwareParameter(mapping:HardwareMapping,target:number,base:number){
  const key=hardwareKey(mapping),now=performance.now(),last=this.hardware.get(key);
  const mix=mapping.device==='mixer';
  const track=nativeChannel(this.engine,mapping.trackId);
  if(mix)target=mixerValue(this.engine,track,mapping.address,target);
  let value=target;
  if(mapping.smoothingMs>0){
   const elapsed=last?Math.max(0,now-last.at):33;
   const from=last?.value??base;
   if(Math.abs(from-target)>1e-5*Math.max(1,Math.abs(target)))value=target+(from-target)*Math.exp(-elapsed/mapping.smoothingMs);
  }
  this.hardware.set(key,{at:now,value});
  if(last?.value===value)return;
  if(mix)this.setMix(track,mapping.address,value);
  else this.parameter(track,mapping.device,mapping.address,value);
 }
 releaseHardware(key:string){this.hardware.delete(key);}
 parameter(track:ChannelTarget,device:string,address:string,value:number){this.send({op:'setParam',track,device,address,value});}
 private setMix(track:ChannelTarget,address:string,value:number){
  const change=address.startsWith('send.')?{sends:{[address.slice(5)]:value}}:{[address]:value};
  this.send({op:'setMix',track,...change});
 }
 mix(track:ChannelTarget,address:string,physical?:number){
  const engine=this.engine,id=typeof track==='number'?engine.project!.tracks[track].id:track;
  const control=engine.mixerControls(track).find(c=>c.address===address);
  if(!control)return;
  const value=physical??engine.hardwareValues.get(hardwareKey({trackId:id,device:'mixer',address}))?.value??control.init;
  this.setMix(track,address,mixerValue(engine,track,address,value));
 }
 async close(){if(this.closed)return;this.closed=true;this.count?.finish();this.off();await this.bridge.stop();}
}
