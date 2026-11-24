import type {LibraryRef,LibraryEntry} from '../model/user-library';
import {libraryParameters} from './library-parameters';
import {LiveClips,type Launch} from './live-clips';
import {barRange,musicalPosition,meterMap} from '../model/meter';
import {bpmAtTick,retimePosition} from '../model/tempo';
import {hardwareKey,type HardwareMapping} from '../model/hardware';
import {secondsToTick,normalizedValue,physicalValue,type AutomationLane} from '../model/automation';
import {FaustPolyDspGenerator,type FaustPolyAudioWorkletNode,type FaustDspFactory} from '@grame/faustwasm';
import type {Project} from '../model/project';
import {chaseMidi} from './transport';
import {timeline,tickToSeconds,tempoMap,tempoTicks,isTempoTarget} from '../model/project';
import {EffectsRack,type TrackRack,type EffectKind,type ChannelTarget} from './effects';
import defaultCode from './synth.dsp?raw';
export {defaultCode};
import {assignedPatch,type SoundSet} from './patch-bank';
export interface Control {address:string;label:string;min:number;max:number;step:number;init:number}
export interface Compiled {voiceFactory:FaustDspFactory;mixerModule:WebAssembly.Module;effectFactory:FaustDspFactory|null}
interface Voice {libraryRef?:LibraryRef;compiled:Compiled;code:string;rack:TrackRack;trim:number;basePan:number;node:FaustPolyAudioWorkletNode;output:GainNode;gain:GainNode;pan:StereoPannerNode;analyser:AnalyserNode;values:Record<string,number>}
export class AudioEngine {
 context:AudioContext|null=null; voices:Voice[]=[]; controls:Control[]=[]; playing=false; loop=false; startTime=0; duration=0; project:Project|null=null;
 effects:EffectsRack|null=null; private master:GainNode|null=null; private tempoCursor=0;
 lastError=""; private playRequest=0;
 private stoppedPosition=0;
 timingProject:Project|null=null;
 private effectiveTiming(project:Project):Project{const hardware=this.hardwareValues.get(hardwareKey({trackId:'master',device:'mixer',address:'bpm'}));return {...project,timing:hardware?{...project.timing,bpm:hardware.value}:project.timing,automation:project.automation?.map(l=>isTempoTarget(l)&&(hardware||this.automationOverrides.has(l.id))?{...l,mode:'off'}:l)};}
 mixerOutput(track:ChannelTarget):AudioNode|null{
  if(typeof track==='number')return this.voices[track]?.pan??null;
  if(track==='master')return this.master;
  return this.effects?.returns[track]?.gain??null;
 }
 get bpm(){const p=this.timingProject??this.project;return p?bpmAtTick(p,secondsToTick(p,this.position)):120;}
 get tempoSource(){if(this.hardwareValues.has(hardwareKey({trackId:'master',device:'mixer',address:'bpm'})))return 'hardware';const p=this.timingProject??this.project;return p?.automation?.some(l=>isTempoTarget(l)&&l.mode==='read'&&l.points.length)?'automation':p?.timing.bpm!==undefined?'override':'midi';}
 hardwareValues=new Map<string,{mapping:HardwareMapping;value:number;param?:AudioParam;restore:number;overrides:string[];updated?:number}>();
 applyHardware(mapping:HardwareMapping,value:number){
  if(isTempoTarget(mapping)){
   if(!this.context||!this.project||mapping.outputMin<20||mapping.outputMax>300||!Number.isFinite(value))return false;
   const key=hardwareKey(mapping),entry=this.hardwareValues.get(key),now=performance.now()/1000;
   if(entry&&now-(entry.updated??0)<.08)return true;
   const start=entry?.value??this.bpm,dt=entry?now-(entry.updated??now):.08;
   const goal=Math.max(20,Math.min(300,value)),next=Math.round((Math.abs(goal-start)<.02||!mapping.smoothingMs?goal:start+(goal-start)*(1-Math.exp(-dt/(mapping.smoothingMs/1000))))*100)/100;
   this.hardwareValues.set(key,{mapping,value:next,restore:0,overrides:[],updated:now});
   if(!entry||entry.value!==next)this.setTempoProject(this.project);return true;
  }
  const key=hardwareKey(mapping),lane={...mapping,min:mapping.outputMin,max:mapping.outputMax} as unknown as AutomationLane,target=this.automationTarget(lane);if(!target?.param||!this.context)return false;
  if(mapping.outputMin<target.control.min||mapping.outputMax>target.control.max)return false;
  let entry=this.hardwareValues.get(key);
  if(entry&&entry.param!==target.param){this.releaseHardware(key);entry=undefined;}
  const overrides=entry?.overrides??(this.project?.automation??[]).filter(l=>l.trackId===mapping.trackId&&l.device===mapping.device&&l.address===mapping.address&&!this.automationOverrides.has(l.id)).map(l=>l.id);
  this.overrideAutomation(mapping.trackId,mapping.device,mapping.address);
  value=Math.max(target.control.min,Math.min(target.control.max,value));
  if(target.control.step>0)value=Math.max(target.control.min,Math.min(target.control.max,target.control.min+Math.round((value-target.control.min)/target.control.step)*target.control.step));
  const now=this.context.currentTime;target.param.cancelScheduledValues(now);if(mapping.smoothingMs)target.param.setTargetAtTime(target.mapValue(value),now,mapping.smoothingMs/1000);else target.param.setValueAtTime(target.mapValue(value),now);
  this.hardwareValues.set(key,{mapping,value,param:target.param,restore:target.base,overrides});return true;
 }
 releaseHardware(key:string){const entry=this.hardwareValues.get(key);if(!entry||!this.context)return;if(isTempoTarget(entry.mapping)){this.hardwareValues.delete(key);if(this.project)this.setTempoProject(this.project);return;}entry.param?.cancelScheduledValues(this.context.currentTime);entry.param?.setValueAtTime(entry.restore,this.context.currentTime);this.hardwareValues.delete(key);for(const id of entry.overrides)this.automationOverrides.delete(id);if(this.playing)this.scheduleAutomation();}
 automationOverrides=new Set<string>();
 private automated=new Map<AudioParam,number>();
 automationTarget(lane:AutomationLane){
  if(isTempoTarget(lane))return {param:undefined,control:{address:'bpm',label:'BPM',min:20,max:300,step:.01,init:this.bpm},base:this.bpm,mapValue:(n:number)=>n};
  const index=this.project?.tracks.findIndex(t=>t.id===lane.trackId)??-1;
  const channel=index>=0?index:['delay','reverb','master'].includes(lane.trackId)?lane.trackId as 'delay'|'reverb'|'master':null;
  if(channel===null)return null;
  if(lane.device==='mixer'){
   const voice=this.voices[index],track=this.project?.tracks[index],rack=this.effects;
   const control=this.mixerControls(channel).find(c=>c.address===lane.address);if(!control||!rack)return null;
   if(typeof channel==='number'&&voice&&track){
    if(lane.address.startsWith('send.')){const kind=lane.address.slice(5) as 'delay'|'reverb';return {param:rack.tracks[index].sends[kind].gain,control,base:rack.tracks[index].amounts[kind],mapValue:(n:number)=>n};}
    if(lane.address==='pan')return {param:voice.pan.pan,control,base:Math.max(-1,Math.min(1,track.pan+voice.basePan)),mapValue:(n:number)=>Math.max(-1,Math.min(1,n+voice.basePan))};
    const muted=track.mute||(this.project!.tracks.some(t=>t.solo)&&!track.solo),factor=muted?0:.2*voice.trim;return {param:voice.gain.gain,control,base:track.gain*factor,mapValue:(n:number)=>n*factor};
   }
   const bus=channel==='master'?rack.master:rack.returns[channel as 'delay'|'reverb'];return bus?{param:bus.gain.gain,control,base:bus.muted?0:bus.level,mapValue:(n:number)=>bus.muted?0:n}:null;
  }
  if(lane.device==='instrument'){const v=this.voices[index],c=v&&this.describe(v.node).find(c=>c.address===lane.address);return c?{param:v.node.parameters.get(c.address),control:c,base:v.values[c.address]??c.init,mapValue:(n:number)=>n}:null;}
  const fx=this.effects?.chain(channel).effects.find(d=>d.id===lane.device),c=fx?.controls.find(c=>c.address===lane.address);
  return fx&&c&&c.label!=='BPM'&&!(fx.wetOnly&&c.label==='Mix')?{param:fx.node.parameters.get(c.address),control:c,base:fx.values[c.address]??c.init,mapValue:(n:number)=>n}:null;
 }
 mixerControls(channel:ChannelTarget):Control[]{
  const track=typeof channel==='number'?this.project?.tracks[channel]:undefined,rack=this.effects;if(!rack)return [];
  const c=(address:string,label:string,min:number,max:number,init:number)=>({address,label,min,max,step:.01,init});
  if(track)return [c('gain','Volume',0,1.5,track.gain),c('pan','Pan',-1,1,track.pan),c('send.delay','Send A · Delay',0,1,rack.tracks[channel as number].amounts.delay),c('send.reverb','Send B · Reverb',0,1,rack.tracks[channel as number].amounts.reverb)];
  const bus=channel==='master'?rack.master:typeof channel==='string'?rack.returns[channel]:null;return bus?[c('gain','Volume',0,1.5,bus.level),...(channel==='master'?[c('bpm','BPM',20,300,this.bpm)]:[])]:[];
 }
 private releaseAutomation(){if(!this.context)return;for(const [param,base] of this.automated){param.cancelScheduledValues(this.context.currentTime);param.setValueAtTime(base,this.context.currentTime);}this.automated.clear();}
 overrideAutomation(trackId:string,device:string,address:string){for(const l of this.project?.automation??[])if(l.trackId===trackId&&l.device===device&&l.address===address){this.automationOverrides.add(l.id);const t=this.automationTarget(l);if(t?.param){t.param.cancelScheduledValues(this.context!.currentTime);this.automated.delete(t.param);}}}
 resumeAutomation(id:string){this.automationOverrides.delete(id);if(this.project?.automation?.some(l=>l.id===id&&isTempoTarget(l)))this.setTempoProject(this.project);else if(this.playing)this.scheduleAutomation();}
 automationDisplay(trackId:string,device:string,address:string,base:number){const hardware=this.hardwareValues.get(hardwareKey({trackId,device,address}));if(hardware)return hardware.value;const l=this.project?.automation?.find(l=>l.trackId===trackId&&l.device===device&&l.address===address);if(!this.playing||!l||l.mode==='off'||this.automationOverrides.has(l.id))return base;const n=normalizedValue(l,secondsToTick(this.timingProject??this.project!,this.position));return n===null?base:physicalValue(l,n);}
 setAutomationProject(project:Project){this.releaseAutomation();if(JSON.stringify(project.automation?.filter(isTempoTarget))!==JSON.stringify(this.project?.automation?.filter(isTempoTarget)))this.setTempoProject(project);else this.project=project;if(this.playing)this.scheduleAutomation();}
 private scheduleAutomation(){
  if(!this.context||!this.project||!this.playing||!this.duration)return;
  const now=this.context.currentTime,end=now+.25,active=new Set<AudioParam>();
  for(const lane of this.project.automation??[]){if(lane.mode!=='read'||!lane.points.length||this.automationOverrides.has(lane.id)||this.hardwareValues.has(hardwareKey(lane)))continue;const t=this.automationTarget(lane);if(!t?.param)continue;const param=t.param;active.add(param);this.automated.set(param,t.base);param.cancelScheduledValues(now);
   const elapsed=Math.max(0,now-this.startTime),firstCycle=this.cycleAt(elapsed),lastCycle=this.cycleAt(Math.max(0,end-this.startTime));
   const times=new Set<number>([now,end]);for(let time=now+.01;time<end;time+=.01)times.add(time);
   for(let c=firstCycle;c<=lastCycle;c++){for(const point of [...lane.points,...tempoMap(this.timingProject??this.project)]){const time=this.startTime+c*this.span+tickToSeconds(this.timingProject??this.project,point.tick);if(time>now&&time<end)times.add(time);}const boundary=this.startTime+c*this.span+this.loopEnd;if(boundary>now&&boundary<=end&&this.loop){times.add(Math.max(now,boundary-1/this.context.sampleRate));times.add(boundary);}}
   let previousCycle=firstCycle;
   for(const time of [...times].sort((a,b)=>a-b)){const elapsed=Math.max(0,time-this.startTime),cycle=this.cycleAt(elapsed),seconds=this.songTime(elapsed),n=normalizedValue(lane,secondsToTick(this.timingProject??this.project,seconds))!;const value=t.mapValue(Math.max(t.control.min,Math.min(t.control.max,physicalValue(lane,n))));if(time===now||cycle!==previousCycle||lane.interpolation==='step')param.setValueAtTime(value,time);else if(lane.scale==='log'&&value>0)param.exponentialRampToValueAtTime(value,time);else param.linearRampToValueAtTime(value,time);previousCycle=cycle;}
  }
  for(const [param,base] of this.automated)if(!active.has(param)){param.cancelScheduledValues(now);param.setValueAtTime(base,now);this.automated.delete(param);}
 }

 private timer=0; private worker:Worker|null=null; private requestId=0; private cache=new Map<string,Compiled>(); private soundSet:SoundSet='basic';
 private pending=new Map<number,{resolve:(c:Compiled)=>void;reject:(e:Error)=>void}>();
 private events:ReturnType<typeof timeline>=[]; private cursor=0; private cycle=0;
 private async compile(code:string,kind='instrument'):Promise<Compiled>{
  if(!this.worker){this.worker=new Worker(new URL('./compiler.worker.ts',import.meta.url),{type:'module'});
   this.worker.onmessage=({data})=>{const p=this.pending.get(data.id);if(!p)return;this.pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data);};
   this.worker.onerror=(e)=>{for(const p of this.pending.values())p.reject(new Error(e.message));this.pending.clear();};
  }
  const id=++this.requestId;
  return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker!.postMessage({id,code,kind});});
 }
 async resumeAudio(){
  this.context??=new AudioContext({latencyHint:'interactive'});
  const context=this.context;const isRunning=()=>context.state==='running';if(isRunning())return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([context.resume(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('浏览器阻止了音频启动，请点击顶部播放按钮后再试。 Browser audio permission required: click Play.')),2500);})]);}
  finally{clearTimeout(timer);}
  if(!isRunning())throw Error('Audio output is not running. Click Play to allow playback.');
 }
 async initialize(project:Project,soundSet:SoundSet='basic',projectId='',activate=true){
  if(activate)await this.resumeAudio();else{this.context??=new AudioContext({latencyHint:'interactive'});await this.context.suspend();}
  if(this.project===project&&this.soundSet===soundSet&&this.voices.length)return;
  const position=this.position;for(const key of this.hardwareValues.keys())this.releaseHardware(key);this.stop(true);this.releaseVoices();this.effects?.dispose();this.master?.disconnect();this.master=this.context!.createGain();this.master.gain.value=0;this.master.connect(this.context!.destination);this.effects=new EffectsRack(this.context!,async code=>(await this.compile(code,'effect')).voiceFactory,this.master,message=>{this.lastError=message;this.stop();});this.effects.onMix=(channel,address)=>{const id=typeof channel==='number'?this.project?.tracks[channel]?.id:channel;if(id)this.overrideAutomation(id,'mixer',address);};this.effects.onParameter=(device,address)=>{for(const l of this.project?.automation??[])if(l.device===device.id&&l.address===address)this.overrideAutomation(l.trackId,l.device,address);};this.project=project;this.timingProject=this.effectiveTiming(project);this.duration=tickToSeconds(this.timingProject,project.timing.end_tick);this.events=timeline(this.timingProject);this.stoppedPosition=Math.min(position,this.duration);
  this.soundSet=soundSet;
  try {await this.effects.initialize();for(const track of project.tracks){
   const {code,patch}=assignedPatch(projectId,track.id,soundSet);
   let compiled=this.cache.get(code);if(!compiled){compiled=await this.compile(code);this.cache.set(code,compiled);}
   this.voices.push(await this.createVoice(compiled,code,patch?.mix_gain??1,patch?.pan??0));
  }}
  catch(e){this.releaseVoices();this.effects?.dispose();throw e;}
  this.controls=this.voices[0]?this.describe(this.voices[0].node):[];this.updateMix(project);
 }
 private async createVoice(compiled:Compiled,code:string,trim=1,basePan=0){
  const ctx=this.context!;const generator=new FaustPolyDspGenerator();
  const node=await generator.createNode(ctx,16,'ShallowSynth',compiled.voiceFactory,compiled.mixerModule,compiled.effectFactory);
  if(!node)throw new Error('Unable to create Faust instrument');
  (node as AudioWorkletNode).onprocessorerror=()=>{this.lastError='Faust AudioWorklet stopped unexpectedly. Reload the page to reinitialize audio.';this.stop();};
  const gain=ctx.createGain(),pan=ctx.createStereoPanner(),analyser=ctx.createAnalyser();analyser.fftSize=256;
  // Conservative mix headroom for simultaneous polyphonic tracks.
  gain.gain.value=0;gain.connect(pan).connect(analyser).connect(this.effects!.master!.input);
  const rack=this.effects!.addTrack(pan);const output=ctx.createGain();node.connect(output).connect(rack.input);rack.output.connect(gain);
  return {compiled,code,node,output,gain,pan,analyser,values:{},trim,basePan,rack};
 }
 describe(node:FaustPolyAudioWorkletNode):Control[]{
  return node.getDescriptors().filter(d=>!['freq','gain','gate','key','vel','velocity'].includes(d.address.split('/').at(-1)??''))
   .filter(d=>['hslider','vslider','nentry'].includes(d.type)).map(d=>({address:d.address,label:d.label,min:d.min??0,max:d.max??1,step:d.step??0.01,init:d.init??0}));
 }
 async replaceInstrument(index:number,code:string,values?:Record<string,number>){
  if(!this.context||!this.project)throw new Error('Initialize audio first');
  const previous=this.voices[index];
  if(!previous)throw Error('Instrument not found');
  const originalNode=previous.node;
  const compiled=await this.compile(code);
  const node=await new FaustPolyDspGenerator().createNode(this.context,16,'ShallowSynth',compiled.voiceFactory,compiled.mixerModule,compiled.effectFactory);
  if(!node)throw Error('Unable to create Faust instrument');
  (node as AudioWorkletNode).onprocessorerror=()=>{this.lastError='Instrument AudioWorklet stopped';this.stop();};
  if(this.voices[index]!==previous||previous.node!==originalNode){node.destroy();throw Error('Project changed while compiling');}
  const controls=this.describe(node),applied=libraryParameters(controls,values??{});
  try{for(const [address,value] of Object.entries(applied))node.setParamValue(address,value);}
  catch(error){node.destroy();throw error;}
  const now=this.context.currentTime,output=this.context.createGain(),oldNode=previous.node,oldOutput=previous.output;
  output.gain.value=0;node.connect(output).connect(previous.rack.input);
  if(this.playing){
   const live=this.live.engaged?this.live.chase(index,this.liveTick(now)):null;
   const chase=live?chaseMidi(live.events,live.phase):chaseMidi(this.events,this.position);
   for(const msg of chase.messages)if(msg.trackIndex===index)node.midiMessage(msg.data,now);
   for(const m of this.scheduledMidi)if(m.track===index&&m.when>=now)node.midiMessage(m.data,m.when);
  }
  previous.compiled=compiled;previous.node=node;previous.output=output;previous.values=applied;previous.code=code;
  output.gain.linearRampToValueAtTime(1,now+.02);oldOutput.gain.cancelScheduledValues(now);oldOutput.gain.setValueAtTime(oldOutput.gain.value,now);oldOutput.gain.linearRampToValueAtTime(0,now+.02);
  window.setTimeout(()=>{oldNode.disconnect();oldNode.destroy();oldOutput.disconnect();},60);
  return controls;
 }
 private requireStopped(){if(!this.effects)throw Error('Click Play to initialize audio first');}
 async addEffect(index:ChannelTarget,kind:EffectKind,code?:string,presetId?:string,values?:Record<string,number>){this.requireStopped();const device=await this.effects!.add(index,kind,code,presetId,values);const tempo=device.controls.find(c=>c.label==='BPM');if(tempo)device.node.setParamValue(tempo.address,this.bpm,this.context!.currentTime);return device;}
 moveEffect(index:ChannelTarget,id:string,direction:number){this.requireStopped();return this.effects!.move(index,id,direction);}
 removeEffect(index:ChannelTarget,id:string){this.requireStopped();return this.effects!.remove(index,id);}
 async replaceEffect(index:ChannelTarget,id:string,code:string){this.requireStopped();return this.effects!.replace(index,id,code);}

 async loadLibraryPatch(target:ChannelTarget,entry:LibraryEntry,replaceEffectId?:string):Promise<string>{
  this.requireStopped();
  const libraryRef={id:entry.id,revision:entry.revision,name:entry.name};
  if(entry.kind==='instrument'){
   if(typeof target!=='number'||replaceEffectId)throw Error('Choose an instrument track');
   await this.replaceInstrument(target,entry.code,entry.values);
   this.voices[target].libraryRef=libraryRef;
   return 'instrument';
  }
  const rack=this.effects!;
  if(replaceEffectId){
   const old=rack.chain(target).effects.find(effect=>effect.id===replaceEffectId);
   if(!old||old.kind!==entry.kind)throw Error('Choose a matching effect to update');
   const effect=await rack.replace(target,replaceEffectId,entry.code,entry.values);
   const tempo=effect.controls.find(c=>c.label==='BPM');
   if(tempo)effect.node.setParamValue(tempo.address,this.bpm,this.context!.currentTime);
   effect.libraryRef=libraryRef;
   return effect.id;
  }
  const effect=await this.addEffect(target,entry.kind,entry.code,undefined,entry.values);
  effect.libraryRef=libraryRef;
  return effect.id;
 }

 setParameter(index:number,path:string,value:number){if(this.project?.tracks[index])this.overrideAutomation(this.project.tracks[index].id,'instrument',path);const v=this.voices[index];if(v){v.node.setParamValue(path,value);v.values[path]=value;}}
 updateMix(project:Project){const solo=project.tracks.some(t=>t.solo);this.project=project;
  project.tracks.forEach((t,i)=>{const voice=this.voices[i];if(!voice||!this.context)return;
   voice.gain.gain.setTargetAtTime(t.mute||(solo&&!t.solo)?0:t.gain*0.2*voice.trim,this.context.currentTime,0.01);
   voice.pan.pan.setTargetAtTime(Math.max(-1,Math.min(1,t.pan+voice.basePan)),this.context.currentTime,0.01);
  });
  for(const entry of [...this.hardwareValues.values()])if(!isTempoTarget(entry.mapping))this.applyHardware(entry.mapping,entry.value);
  if(this.playing)this.scheduleAutomation();
 }
 setTempoProject(project:Project){
  this.clearClicks();
  const next=this.effectiveTiming(project),wasPlaying=this.playing,position=this.project?retimePosition(this.timingProject??this.project,next,this.position):0;
  const liveTick=wasPlaying&&this.context&&this.live.engaged?this.liveTick(this.context.currentTime):null;
  // Flush future MIDI without clearing currently sounding voices or effect tails.
  this.releaseAutomation();if(this.timer)window.clearInterval(this.timer);this.timer=0;
  for(const voice of this.voices){voice.node.stop();voice.node.start();}this.effects?.retime();
  this.scheduledMidi=[];this.project=project;this.timingProject=next;this.duration=tickToSeconds(next,next.timing.end_tick);this.events=timeline(next);this.stoppedPosition=Math.min(position,this.duration);this.refreshLoopBounds();
  if(wasPlaying&&this.context&&(this.stoppedPosition<this.duration||liveTick!==null)){
   this.startTime=this.context.currentTime-this.stoppedPosition;this.cycle=0;this.cursor=chaseMidi(this.events,this.stoppedPosition).cursor;
   if(liveTick!==null)this.live.rebase(liveTick,this.liveTick(this.context.currentTime));
   this.tempoCursor=0;this.schedule();this.timer=window.setInterval(()=>this.schedule(),25);
  }else {if(wasPlaying)this.pause();if(this.context)this.effects?.tempo(this.bpm,this.context.currentTime);}
 }

 // Preserve queued audio and the playing clip snapshots across source edits.
 setClipProject(project:Project,reconcileNotes=false){
  const previous=this.events;
  this.project=project;this.timingProject=this.effectiveTiming(project);
  this.events=timeline(this.timingProject);this.duration=tickToSeconds(this.timingProject,project.timing.end_tick);
  this.refreshLoopBounds();
  if(this.playing){
   const elapsed=this.queuedUntil-this.startTime;
   this.cycle=this.cycleAt(elapsed);
   const at=elapsed-this.cycle*this.span;
   const next=chaseMidi(this.events,at+1e-9);
   this.cursor=next.cursor;
   if(reconcileNotes){
    const old=chaseMidi(previous,at+1e-9).messages;
    for(let track=0;track<project.tracks.length;track++){
     const notes=(messages:typeof old)=>messages.filter(m=>m.trackIndex===track&&[8,9].includes(m.data[0]>>4)).map(m=>m.data);
     const before=notes(old),after=notes(next.messages);
     if(JSON.stringify(before)===JSON.stringify(after))continue;
     // Repair notes crossing the end of the already scheduled audio window.
     const send=(data:number[])=>this.arrangementMessage(track,data,this.queuedUntil);
     for(const ch of new Set(before.map(data=>data[0]&15)))send([176+ch,64,0]);
     for(const [status,pitch] of before)if(status>>4===9)send([128+(status&15),pitch,0]);
     for(const m of next.messages)if(m.trackIndex===track)send(m.data);
    }
   }
  }
 }
 readonly live=new LiveClips();
 private queuedUntil=0;
 private scheduledMidi:{track:number;data:number[];when:number}[]=[];
 private sendTimed(track:number,data:number[],when:number){
  this.voices[track].node.midiMessage(data,when);
  this.scheduledMidi.push({track,data,when});
 }
 private pausedSlots:{track:number;launch:Launch}[]=[];
 currentLaunches(){
  if(!this.playing)return this.pausedSlots;
  return this.live.tracks().flatMap(track=>{
   const state=this.liveState(track),launch=state.active??state.pending;
   return launch?[{track,launch}]:[];
  });
 }
 private clockTick(seconds:number){
  const p=this.timingProject!;
  if(seconds<=this.duration)return secondsToTick(p,Math.max(0,seconds));
  const last=tempoMap(p).at(-1)!;
  return last.tick+tempoTicks(last,seconds-last.seconds,p.timing.ppqn);
 }
 private liveTick(when:number){
  const elapsed=when-this.startTime,cycle=this.cycleAt(elapsed);
  if(!cycle)return this.clockTick(elapsed);
  return this.clockTick(elapsed-cycle*this.span)+cycle*(this.clockTick(this.loopEnd)-this.clockTick(this.loopStart));
 }
 private liveTime(tick:number){
  const p=this.timingProject!;
  if(!this.loop)return this.startTime+tickToSeconds(p,tick);
  const start=this.clockTick(this.loopStart),length=this.clockTick(this.loopEnd)-start;
  const cycle=length>0?Math.max(0,Math.floor((tick-start)/length)):0;
  return this.startTime+cycle*this.span+tickToSeconds(p,tick-cycle*length);
 }
 liveState(track:number){return this.live.state(track,this.live.engaged&&this.context&&this.playing?this.liveTick(this.context.currentTime):0);}
 async launchSlots(slots:{track:number;launch:Launch}[]){
  if(!slots.length||!this.context||!this.timingProject)return;
  if(!this.playing){
   const tracks=new Set(slots.map(s=>s.track));
   await this.play({slots:[...this.pausedSlots.filter(s=>!tracks.has(s.track)),...slots]});return;
  }
  const when=Math.max(this.context.currentTime,this.startTime+this.stoppedPosition);
  const absolute=this.liveTick(when),elapsed=when-this.startTime;
  const local=this.clockTick(this.loop?this.songTime(elapsed):elapsed);
  const bar=musicalPosition(this.timingProject,local).bar;
  const next=barRange(this.timingProject,bar+1).startTick;
  const target=Math.min(next,this.loop?this.clockTick(this.loopEnd):Infinity)+(absolute-local);
  for(const s of slots)this.live.queue(s.track,s.launch,target);
  // A launch can arrive after the scheduler has already posted the next bar.
  // Replace only the affected voices' future MIDI, preserving the rest of this bar.
  const boundary=this.liveTime(target);
  if(boundary<=this.queuedUntil){
   const tracks=new Set(slots.map(s=>s.track));
   const retained=this.scheduledMidi.filter(m=>tracks.has(m.track)&&m.when>this.context!.currentTime&&m.when<boundary-1e-8);
   this.scheduledMidi=this.scheduledMidi.filter(m=>!tracks.has(m.track));
   for(const track of tracks){this.voices[track].node.stop();this.voices[track].node.start();}
   for(const m of retained)this.sendTimed(m.track,m.data,m.when);
   if(!Number.isFinite(this.live.through))this.live.through=target;
   const end=this.liveTick(this.queuedUntil);
   if(this.live.through>=end)this.scheduleLive(this.queuedUntil,{from:target,tracks});
   else this.scheduleLive(this.queuedUntil);
  }
 }
 backToArrangement(){
  if(!this.context||!this.live.engaged)return;
  const tick=this.liveTick(Math.max(this.context.currentTime+.005,this.queuedUntil+.00001));
  for(const track of this.live.tracks())this.live.queue(track,null,tick);
 }
 private arrangementMessage(track:number,data:number[],when:number){
  if(!this.live.engaged||!this.live.owns(track,this.liveTick(when)))this.sendTimed(track,data,when);
 }
 private scheduleLive(horizon:number,repair?:{from:number;tracks:Set<number>}){
  if(!this.live.engaged||!this.context)return;
  const now=this.liveTick(this.context.currentTime),to=this.liveTick(horizon);
  const send=(track:number,data:number[],tick:number)=>this.sendTimed(track,data,this.liveTime(tick));
  this.live.render(repair?.from??(Number.isFinite(this.live.through)?this.live.through:now),to,send,(track,tick,old,next)=>{
   const time=this.liveTime(tick),pos=this.songTime(time-this.startTime);
   const chased=(!old||!next)?chaseMidi(this.events,pos).messages.filter(m=>m.trackIndex===track):[];
   const pitches=new Set<number>(),channels=new Set<number>([this.project!.tracks[track].midi_channel-1]);
   if(old?.clip){
    for(const e of old.clip.events){
     const ch=((e.status??0)%16+old.channel-old.clip.channel+16)%16;
     channels.add(ch);if((e.status!>>4)===9&&e.data[1]>0)pitches.add(ch*128+e.data[0]);
    }
   }else for(const m of chased){channels.add(m.data[0]&15);if(m.data[0]>>4===9)pitches.add((m.data[0]&15)*128+m.data[1]);}
   for(const ch of channels)send(track,[176+ch,64,0],tick);
   for(const key of pitches)send(track,[128+(key>>7),key%128,0],tick);
   for(const ch of channels){send(track,[176+ch,121,0],tick);send(track,[224+ch,0,64],tick);}
   if(!next&&pos<this.duration)for(const m of chased)send(track,m.data,tick);
  },repair?.tracks);
  this.live.prune(now);
 }
 loopRange:{start:number;end:number}|null=null;
 private loopStart=0;
 private loopEnd=0;
 private get span(){return this.loop?this.loopEnd-this.loopStart:this.duration;}
 private cycleAt(elapsed:number){return this.loop&&this.span>0?Math.max(0,Math.floor((elapsed-this.loopStart)/this.span)):0;}
 private songTime(elapsed:number){return Math.min(this.duration,elapsed-this.cycleAt(elapsed)*this.span);}
 private refreshLoopBounds(){
  const p=this.timingProject??this.project,r=this.loopRange;
  this.loopStart=p&&r?tickToSeconds(p,r.start):0;
  this.loopEnd=p&&r?Math.min(this.duration,tickToSeconds(p,r.end)):this.duration;
  if(this.loopStart>=this.loopEnd){this.loopStart=0;this.loopEnd=this.duration;}
 }
 configureLoop(enabled:boolean,range=this.loopRange){
  if(!enabled&&!this.loop){
   this.loopRange=range;this.refreshLoopBounds();
   return;
  }
  const position=this.position,playing=this.playing;
  if(playing)this.pause();
  this.loop=enabled;this.loopRange=range;this.refreshLoopBounds();this.stoppedPosition=position;
  if(playing)this.beginPlayback(position,.05,this.pausedSlots);
 }
 async play({resume=false,slots=[],lead=.05}:{lead?:number;resume?:boolean;slots?:{track:number;launch:Launch}[]}={}){if(!this.context||!this.voices.length||this.playing)return;
  const request=++this.playRequest;await this.resumeAudio();if(request!==this.playRequest)return;
  this.refreshLoopBounds();
  const position=this.stoppedPosition>=this.duration?0:this.stoppedPosition;
  const outsideSelection=this.stoppedPosition<this.loopStart||this.stoppedPosition>=this.loopEnd;
  this.beginPlayback(this.loop&&!resume&&this.loopRange&&outsideSelection?this.loopStart:position,lead,slots.length?slots:this.pausedSlots);
 }
 seek(seconds:number,duration=this.duration){
  if(!Number.isFinite(seconds)||!Number.isFinite(duration))throw Error('Invalid playback position');
  const offset=Math.max(0,Math.min(seconds,Math.max(0,duration))),wasPlaying=this.playing;
  this.pause();this.stoppedPosition=offset;
  if(wasPlaying&&offset<this.duration)this.beginPlayback(offset,.05,this.pausedSlots);
 }
 private beginPlayback(offset:number,lead=.05,slots:{track:number;launch:Launch}[]=[]){
  if(!this.context||!this.project||!this.voices.length||this.duration<=0)return;
  this.stop(false);this.refreshLoopBounds();
  if(this.loop&&(offset<this.loopStart||offset>=this.loopEnd))offset=this.loopStart;
  this.stoppedPosition=offset;
  const when=this.context.currentTime+lead;this.startTime=when-offset;this.cycle=0;
  for(const s of slots)this.live.queue(s.track,s.launch,this.clockTick(offset));
  const chase=chaseMidi(this.events,offset);this.cursor=chase.cursor;
  const tempos=tempoMap(this.timingProject??this.project);this.tempoCursor=0;
  while(this.tempoCursor+1<tempos.length&&tempos[this.tempoCursor+1].seconds<=offset)this.tempoCursor++;
  this.effects?.tempo(bpmAtTick(this.timingProject??this.project,secondsToTick(this.timingProject??this.project,offset)),when);this.tempoCursor++;
  for(const message of chase.messages)this.arrangementMessage(message.trackIndex,message.data,when);
  this.playing=true;this.master!.gain.setTargetAtTime(1,when,.005);
  this.schedule();this.timer=window.setInterval(()=>this.schedule(),25);
 }
 metronome=false;
 private clickUntil=0;
 private clicks=new Set<OscillatorNode>();
 setMetronome(enabled:boolean){this.metronome=enabled;this.clearClicks();}
 private clearClicks(){for(const click of this.clicks)click.stop();this.clicks.clear();this.clickUntil=0;}
 private clickAt(ctx:AudioContext,when:number,accent:boolean){
     const osc=ctx.createOscillator(),gain=ctx.createGain();
     osc.frequency.value=accent?1500:950;
     gain.gain.setValueAtTime(.12,when);gain.gain.exponentialRampToValueAtTime(.0001,when+.045);
     osc.connect(gain).connect(ctx.destination);this.clicks.add(osc);
     osc.onended=()=>{this.clicks.delete(osc);osc.disconnect();gain.disconnect();};
     osc.start(when);osc.stop(when+.05);
 }
 async countIn(bars:number,signal:AbortSignal,display:(label:string)=>void){
  await this.resumeAudio();
  if(signal.aborted||!this.context||!this.project)return;
  const ctx=this.context,p=this.timingProject??this.project;
  const offset=this.loop&&(this.position<this.loopStart||this.position>=this.loopEnd)?this.loopStart:this.position>=this.duration?0:this.position;
  const tick=secondsToTick(p,offset),meter=musicalPosition(p,tick);
  const interval=60/bpmAtTick(p,tick)*4/meter.denominator,total=bars*meter.numerator,start=ctx.currentTime+.03;
  let next=0;
  await new Promise<void>(resolve=>{
   const done=()=>{clearInterval(timer);signal.removeEventListener('abort',cancel);resolve();};
   const cancel=()=>{this.clearClicks();done();};
   const update=()=>{
    const elapsed=ctx.currentTime-start,beat=Math.max(0,Math.floor(elapsed/interval));
    if(beat>=total){done();return;}
    display('-'+(bars-Math.floor(beat/meter.numerator))+'.'+(1+beat%meter.numerator));
    while(next<total&&next*interval<=elapsed+.15){this.clickAt(ctx,Math.max(ctx.currentTime,start+next*interval),next%meter.numerator===0);next++;}
   };
   const timer=window.setInterval(update,10);signal.addEventListener('abort',cancel,{once:true});update();
  });
 }
 private scheduleClicks(now:number,horizon:number){
  if(!this.metronome||!this.context||!this.project||this.span<=0)return;
  const p=this.timingProject??this.project,meters=meterMap(p),ctx=this.context;
  const from=Math.max(this.clickUntil,now,this.startTime+this.stoppedPosition);
  this.clickUntil=horizon;
  for(let cycle=this.cycleAt(from-this.startTime);cycle<=this.cycleAt(horizon-this.startTime);cycle++){
   const base=this.startTime+cycle*this.span,start=Math.max(from-base,this.loop?this.loopStart:0),end=Math.min(horizon-base,this.loop?this.loopEnd:this.duration);
   if(start>=end)continue;
   const first=secondsToTick(p,start),last=secondsToTick(p,end);
   for(let i=0;i<meters.length;i++){
    const m=meters[i],limit=Math.min(last,meters[i+1]?.tick??Infinity);
    for(let beat=Math.max(0,Math.ceil((first-m.tick)/m.ticksPerBeat-1e-8));;beat++){
     const tick=m.tick+beat*m.ticksPerBeat;if(tick>limit||tick===meters[i+1]?.tick)break;
     const seconds=tickToSeconds(p,tick);if(seconds>=end-1e-9)break;
     this.clickAt(ctx,Math.max(now,base+seconds),beat%m.numerator===0);
    }
   }
  }
 }
 monitorMidi(track:number,data:number[]){
  if(!this.context||!this.voices[track])return;
  if(!this.playing)this.master?.gain.setTargetAtTime(1,this.context.currentTime,.005);
  this.voices[track].node.midiMessage(data);
 }
 private schedule(){if(!this.context||!this.playing)return;this.scheduleAutomation();
  const now=this.context.currentTime;this.scheduledMidi=this.scheduledMidi.filter(m=>m.when>now);
  const horizon=now+0.25;this.scheduleClicks(now,horizon);this.queuedUntil=horizon;this.scheduleLive(horizon);
  for(let when=this.context.currentTime;when<=horizon;when+=.025){const elapsed=Math.max(0,when-this.startTime),seconds=this.songTime(elapsed),p=this.timingProject??this.project!;this.effects?.tempo(bpmAtTick(p,secondsToTick(p,seconds)),when);}
  while(this.playing){
   if(this.cursor>=this.events.length||(this.loop&&this.events[this.cursor].seconds>=this.loopEnd)){
    if(this.loop&&horizon>=this.startTime+this.cycle*this.span+this.loopEnd){const boundary=this.startTime+this.cycle*this.span+this.loopEnd;
      // Faust treats CC 120/123 as panic and cancels future queued notes,
      // including the next cycle. Release held notes without flushing that queue.
      this.voices.forEach((v,i)=>{const ch=this.project!.tracks[i].midi_channel-1;this.arrangementMessage(i,[0xB0|ch,64,0],boundary);});
      for(const message of chaseMidi(this.events,this.loopEnd).messages){
       if((message.data[0]>>4)===9)this.arrangementMessage(message.trackIndex,[0x80|(message.data[0]&15),message.data[1],0],boundary);
      }
      const head=chaseMidi(this.events,this.loopStart);
      this.voices.forEach((v,i)=>{const ch=this.project!.tracks[i].midi_channel-1;this.arrangementMessage(i,[0xb0|ch,121,0],boundary);this.arrangementMessage(i,[0xe0|ch,0,64],boundary);});
      for(const m of head.messages)this.arrangementMessage(m.trackIndex,m.data,boundary);
      this.cycle++;this.cursor=head.cursor;continue;}
    else {if(!this.loop&&this.context.currentTime>=this.startTime+this.duration&&!this.live.engaged)this.pause();break;}
   }
   const event=this.events[this.cursor];if(!event)break;
   const when=this.startTime+this.cycle*this.span+event.seconds;if(when>horizon)break;
   // Program changes are retained in the project; this prototype uses one editable patch per track.
   const kind=(event.status??0)>>4;
   if([8,9,11,14].includes(kind))this.arrangementMessage(event.trackIndex,[event.status!,...event.data],when);
   this.cursor++;
  }
 }
 pause(){const slots=this.currentLaunches();this.stop(false);this.pausedSlots=slots;}
 stop(reset=true){
  this.clearClicks();
  this.live.clear();this.scheduledMidi=[];this.pausedSlots=[];this.queuedUntil=0;
  this.releaseAutomation();
  const position=this.position;this.playRequest++;window.clearInterval(this.timer);this.playing=false;this.stoppedPosition=reset?0:position;this.cursor=0;this.cycle=0;
  for(let i=0;i<this.voices.length;i++){
   const v=this.voices[i],channel=(this.project?.tracks[i].midi_channel??1)-1;
   // stop flushes Faust's timestamped MIDI queue; allNotesOff alone does not.
   v.node.stop();v.node.allNotesOff(true);v.node.instanceClear();
   v.node.midiMessage([0xB0|channel,121,0]);v.node.midiMessage([0xB0|channel,64,0]);v.node.midiMessage([0xE0|channel,0,64]);
   for(const [address,value] of Object.entries(v.values))v.node.setParamValue(address,value);
   v.node.start();
  }
  this.effects?.reset();for(const entry of [...this.hardwareValues.values()])if(!isTempoTarget(entry.mapping))this.applyHardware(entry.mapping,entry.value);if(this.master&&this.context){this.master.gain.cancelScheduledValues(this.context.currentTime);this.master.gain.setValueAtTime(0,this.context.currentTime);}
 }
 get position(){
  if(!this.playing||!this.context)return this.stoppedPosition;
  const elapsed=Math.max(this.stoppedPosition,this.context.currentTime-this.startTime);
  return this.songTime(elapsed);
 }
 level(index:number){const v=this.voices[index];if(!v)return 0;const data=new Float32Array(256);v.analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length);}
 private releaseVoices(){for(const v of this.voices){v.node.disconnect();v.node.destroy();v.output.disconnect();v.gain.disconnect();v.pan.disconnect();v.analyser.disconnect();}this.voices=[];}
 async dispose(){for(const key of this.hardwareValues.keys())this.releaseHardware(key);this.stop(true);this.releaseVoices();this.effects?.dispose();this.effects=null;this.master?.disconnect();this.worker?.terminate();this.worker=null;await this.context?.close();this.context=null;}
}
