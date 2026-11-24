import type {LibraryRef} from '../model/user-library';
import {libraryParameters} from './library-parameters';
import {findPreset} from '../model/effect-library.ts';
import eq from '../../patches/effects/eq.dsp?raw';
import filter from '../../patches/effects/filter.dsp?raw';
import saturator from '../../patches/effects/saturator.dsp?raw';
import chorus from '../../patches/effects/chorus.dsp?raw';
import utility from '../../patches/effects/utility.dsp?raw';
import {FaustMonoDspGenerator,type FaustDspFactory,type FaustMonoAudioWorkletNode} from '@grame/faustwasm';
import compressor from '../../patches/effects/compressor.dsp?raw';
import delay from '../../patches/effects/delay.dsp?raw';
import reverb from '../../patches/effects/reverb.dsp?raw';
export const effectSources={compressor,delay,reverb,eq,filter,saturator,chorus,utility,custom:'process = _,_;'};
export type EffectKind=keyof typeof effectSources;
export type ReturnKind='delay'|'reverb';
export type ChannelTarget=number|ReturnKind|'master';
export interface EffectChain {input:GainNode;output:GainNode;effects:EffectDevice[]}
export interface EffectControl {address:string;label:string;min:number;max:number;step:number;init:number}
export interface EffectDevice {libraryRef?:LibraryRef;factory:FaustDspFactory;id:string;kind:EffectKind;code:string;node:FaustMonoAudioWorkletNode;input:GainNode;output:GainNode;dry:GainNode;wet:GainNode;controls:EffectControl[];values:Record<string,number>;bypassed:boolean;wetOnly:boolean}
export interface TrackRack {input:GainNode;output:GainNode;effects:EffectDevice[];sends:Record<ReturnKind,GainNode>;amounts:Record<ReturnKind,number>}
interface ReturnBus extends EffectChain {gain:GainNode;analyser:AnalyserNode;level:number;muted:boolean}
export class EffectsRack {
 beforeChainChange?:(channel:ChannelTarget,devices:EffectDevice[])=>Promise<void>;
 onDeviceValue?:(device:EffectDevice,address:string,value:number)=>void;
 onBypass?:(device:EffectDevice)=>void;
 onBusChange?:(channel:ChannelTarget,address:string,muteChanged?:boolean)=>void;
 onMix?:(channel:ChannelTarget,address:string)=>void;
 onParameter?:(device:EffectDevice,address:string)=>void;
 master:ReturnBus|null=null;
 tracks:TrackRack[]=[];returns={} as Record<ReturnKind,ReturnBus>;
 private disposed=false;
 private cache=new Map<string,FaustDspFactory>();
 constructor(private context:AudioContext,private compile:(code:string)=>Promise<FaustDspFactory>,private destination:AudioNode,private onError:(message:string)=>void){}
 private bus(destination:AudioNode):ReturnBus {const input=this.context.createGain(),output=this.context.createGain(),gain=this.context.createGain(),analyser=this.context.createAnalyser();analyser.fftSize=256;input.connect(output);output.connect(gain).connect(analyser).connect(destination);return {input,output,effects:[],gain,analyser,level:1,muted:false};}
 async initialize(){try{this.master=this.bus(this.destination);for(const kind of ['delay','reverb'] as const){const bus=this.bus(this.master.input);this.returns[kind]=bus;bus.effects.push(await this.create(kind,true));this.wire(bus);this.setReturn(kind,.65,false);}}catch(e){this.dispose();throw e;}}
 chain(target:ChannelTarget):EffectChain {const c=typeof target==='number'?this.tracks[target]:target==='master'?this.master:this.returns[target];if(!c)throw Error('Channel not initialized');return c;}
 async create(kind:EffectKind,wetOnly=false,code=effectSources[kind]):Promise<EffectDevice>{
  let factory=this.cache.get(code);if(!factory){factory=await this.compile(code);this.cache.set(code,factory);}
  const node=await new FaustMonoDspGenerator().createNode(this.context,'ShallowEffect',factory);if(!node)throw Error('Could not create effect');
  (node as AudioWorkletNode).onprocessorerror=()=>this.onError(`${kind}: AudioWorklet stopped`);
  const input=this.context.createGain(),output=this.context.createGain(),dry=this.context.createGain(),wet=this.context.createGain();
  input.connect(node).connect(wet).connect(output);input.connect(dry).connect(output);dry.gain.value=0;wet.gain.value=1;
  const controls=node.getDescriptors().filter(d=>['hslider','vslider','nentry'].includes(d.type)).map(d=>({address:d.address,label:d.label,min:d.min??0,max:d.max??1,step:d.step??.01,init:d.init??0}));
  const device={factory,id:crypto.randomUUID(),kind,code,node,input,output,dry,wet,controls,values:Object.fromEntries(controls.map(c=>[c.address,c.init])),bypassed:false,wetOnly};
  if(wetOnly){const mix=controls.find(c=>c.label==='Mix');if(!mix){this.destroyDevice(device);throw Error('Return effect requires a Mix control');}this.setParameter(device,mix.address,1);}
  return device;
 }
 addTrack(post:AudioNode){const input=this.context.createGain(),output=this.context.createGain(),sends={delay:this.context.createGain(),reverb:this.context.createGain()};input.connect(output);
  for(const kind of ['delay','reverb'] as const){sends[kind].gain.value=0;post.connect(sends[kind]).connect(this.returns[kind].input);}
  const rack={input,output,effects:[],sends,amounts:{delay:0,reverb:0}};this.tracks.push(rack);return rack;
 }
 private wire(track:EffectChain){track.input.disconnect();for(const e of track.effects)e.output.disconnect();let previous:AudioNode=track.input;for(const e of track.effects){previous.connect(e.input);previous=e.output;}previous.connect(track.output);track.output.gain.value=Object.values(this.returns).includes(track as ReturnBus)&&track.effects.length===0?0:1;}
 private async transition(track:EffectChain,change:()=>void){
  const now=this.context.currentTime;track.output.gain.cancelScheduledValues(now);track.output.gain.setValueAtTime(track.output.gain.value,now);track.output.gain.linearRampToValueAtTime(0,now+.008);
  await new Promise(resolve=>setTimeout(resolve,20));
  if(this.disposed)return;
  try{change();}finally{
   this.wire(track);const target=track.output.gain.value;
   track.output.gain.setValueAtTime(0,this.context.currentTime);track.output.gain.linearRampToValueAtTime(target,this.context.currentTime+.008);
  }
 }
 async add(index:ChannelTarget,kind:EffectKind,code?:string,presetId?:string,values?:Record<string,number>){
  const track=this.chain(index),preset=presetId===undefined?undefined:findPreset(kind,presetId);
  const wetOnly=(index==='delay'||index==='reverb')&&['delay','reverb','custom'].includes(kind);
  const effect=await this.create(kind,wetOnly,code);
  try{
   for(const [label,value] of Object.entries(preset?.values??{})){
    const control=effect.controls.find(c=>c.label===label);
    if(!control)throw Error('Missing preset control: '+label);
    this.setParameter(effect,control.address,value);
   }
   if(values)this.applyLibraryValues(effect,values);
   await this.beforeChainChange?.(index,[...track.effects,effect]);
   await this.transition(track,()=>track.effects.push(effect));
   if(this.disposed)throw Error('Rack disposed');
   return effect;
  }catch(error){this.destroyDevice(effect);throw error;}
 }
 async move(index:ChannelTarget,id:string,direction:number){const t=this.chain(index),from=t.effects.findIndex(e=>e.id===id),to=from+direction;if(from<0||to<0||to>=t.effects.length)return;const ordered=[...t.effects];ordered.splice(to,0,ordered.splice(from,1)[0]);await this.beforeChainChange?.(index,ordered);await this.transition(t,()=>{const [effect]=t.effects.splice(from,1);t.effects.splice(to,0,effect);});}
 async remove(index:ChannelTarget,id:string){const t=this.chain(index),e=t.effects.find(e=>e.id===id);if(!e)return;await this.beforeChainChange?.(index,t.effects.filter(x=>x!==e));await this.transition(t,()=>{this.destroyDevice(e);t.effects=t.effects.filter(x=>x!==e);});}
 async replace(index:ChannelTarget,id:string,code:string,values?:Record<string,number>){
  const track=this.chain(index),old=track.effects.find(e=>e.id===id);
  if(!old)throw Error('Device not found');
  const next=await this.create(old.kind,old.wetOnly,code);
  try{
   if(values)this.applyLibraryValues(next,values);
   else for(const c of next.controls){
    const before=old.controls.find(x=>x.address===c.address)??old.controls.find(x=>x.label===c.label);
    if(before)this.setParameter(next,c.address,old.values[before.address]);
   }
   this.bypass(next,old.bypassed);
   next.id=old.id;next.libraryRef=old.libraryRef;
   await this.beforeChainChange?.(index,track.effects.map(e=>e===old?next:e));
   await this.transition(track,()=>{
    const slot=track.effects.indexOf(old);
    if(slot<0)throw Error('Device changed while compiling');
    track.effects[slot]=next;old.output.disconnect();
   });
   if(this.disposed)throw Error('Rack disposed');
   this.destroyDevice(old);
   return next;
  }catch(error){this.destroyDevice(next);throw error;}
 }
 private applyLibraryValues(device:EffectDevice,values:Record<string,number>){
  for(const [address,value] of Object.entries(libraryParameters(device.controls,values))){
   this.setParameter(device,address,value);
  }
 }
 bypass(e:EffectDevice,value:boolean){e.bypassed=value;this.onBypass?.(e);const now=this.context.currentTime;e.dry.gain.setTargetAtTime(value&&!e.wetOnly?1:0,now,.01);e.wet.gain.setTargetAtTime(value?0:1,now,.01);}
 setParameter(e:EffectDevice,address:string,value:number){const c=e.controls.find(c=>c.address===address);if(!c||!Number.isFinite(value))throw Error('Invalid effect parameter');value=e.wetOnly&&c.label==='Mix'?1:Math.max(c.min,Math.min(c.max,value));this.onParameter?.(e,address);e.values[address]=value;e.node.setParamValue(address,value);this.onDeviceValue?.(e,address,value);}
 setSend(index:number,kind:ReturnKind,value:number){if(!Number.isFinite(value))throw Error('Invalid send');const t=this.tracks[index];value=Math.max(0,Math.min(1,value));this.onMix?.(index,'send.'+kind);t.amounts[kind]=value;this.onBusChange?.(index,'send.'+kind);t.sends[kind].gain.setTargetAtTime(value,this.context.currentTime,.01);}
 setReturn(kind:ReturnKind,level:number,muted:boolean){const r=this.returns[kind];if(!Number.isFinite(level))throw Error('Invalid return level');if(level!==r.level)this.onMix?.(kind,'gain');r.level=Math.max(0,Math.min(1.5,level));const muteChanged=r.muted!==muted;r.muted=muted;this.onBusChange?.(kind,'gain',muteChanged);r.gain.gain.setTargetAtTime(muted?0:r.level,this.context.currentTime,.01);}
 setMaster(level:number,muted:boolean){const m=this.master;if(!m||!Number.isFinite(level))return;if(level!==m.level)this.onMix?.('master','gain');m.level=Math.max(0,Math.min(1.5,level));const muteChanged=m.muted!==muted;m.muted=muted;this.onBusChange?.('master','gain',muteChanged);m.gain.gain.setTargetAtTime(muted?0:m.level,this.context.currentTime,.01);}
 devices(){return [...this.tracks.flatMap(t=>t.effects),...Object.values(this.returns).flatMap(r=>r.effects),...(this.master?.effects??[])];}
 retime(){for(const e of this.devices()){e.node.stop();e.node.start();}}
 tempo(bpm:number,time:number){for(const e of this.devices()){const c=e.controls.find(c=>c.label==='BPM');if(c)e.node.setParamValue(c.address,Math.max(c.min,Math.min(c.max,bpm)),time);}}
 reset(){for(const e of this.devices()){e.node.stop();e.node.instanceClear();for(const c of e.controls){e.node.parameters.get(c.address)?.cancelScheduledValues(this.context.currentTime);e.node.setParamValue(c.address,e.values[c.address]);}e.node.start();}}
 meter(kind:ReturnKind|'master'){const r=kind==='master'?this.master:this.returns[kind];if(!r)return 0;const samples=new Float32Array(256);r.analyser.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/256);}
 private destroyDevice(e:EffectDevice){e.input.disconnect();e.node.disconnect();e.node.destroy();e.dry.disconnect();e.wet.disconnect();e.output.disconnect();}
 dispose(){this.disposed=true;for(const t of this.tracks){t.input.disconnect();t.output.disconnect();Object.values(t.sends).forEach(n=>n.disconnect());t.effects.forEach(e=>this.destroyDevice(e));}for(const r of [...Object.values(this.returns),...(this.master?[this.master]:[])]){r.input.disconnect();r.output.disconnect();r.effects.forEach(e=>this.destroyDevice(e));r.gain.disconnect();r.analyser.disconnect();}this.master=null;this.tracks=[];this.returns={} as Record<ReturnKind,ReturnBus>;}
}
