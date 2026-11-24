import {nativeInspector} from './native-inspect.ts';
import type {AudioEngine} from './engine';
import type {ChannelTarget,EffectDevice} from './effects';

export type Mode='wave'|'spectrum'|'spectrogram'|'performance';
export function inspectDevice(engine:AudioEngine,track:ChannelTarget,effect:EffectDevice|undefined,name:string,zh:boolean){
 openInspector(engine,track,effect,name,zh);
}
export function inspectChannel(engine:AudioEngine,track:ChannelTarget,name:string,zh:boolean){
 const output=engine.mixerOutput(track);
 if(output)openInspector(engine,track,undefined,name,zh,output);
}
function openInspector(engine:AudioEngine,track:ChannelTarget,effect:EffectDevice|undefined,name:string,zh:boolean,channelOutput?:AudioNode){
 const voice=typeof track==='number'?engine.voices[track]:undefined;
 const ctx=engine.context;
 if(!ctx||(!channelOutput&&!effect&&!voice))return;
 const rack=engine.effects, instrument=voice?.node;
 const prefix=typeof track==='number'?'CH '+(track+1)+' · ':channelOutput?'':track+' · ';
 const title=prefix+name+(channelOutput?(zh?' · 通道输出':' · Channel output'):'');
 // Summing the wet and dry gains gives the device output, including bypass,
 // without attaching to the rack edge that changes when devices are reordered.
 const native=engine.native;
 if(native){
  const current=()=>engine.native===native && engine.effects===rack && (channelOutput?engine.mixerOutput(track)===channelOutput:effect?!!rack?.devices().includes(effect):voice?.node===instrument && engine.voices.includes(voice!));
  const source:InspectSource={title,rate:native.details.sampleRate??ctx.sampleRate,effect:!!effect,canBenchmark:!channelOutput,
   livePerformance:true,identity:channelOutput??effect??instrument!,current,
   subscribe:nativeInspector(native.probeRequest,track,channelOutput?'channel':effect?.id??'instrument',current)};
  present(source,zh);return;
 }
 const sources:AudioNode[][]=channelOutput?[[channelOutput]]:effect?[[effect.input],[effect.dry,effect.wet]]:[[voice!.output]];
 const source={
  title,rate:ctx.sampleRate,effect:!!effect,canBenchmark:!channelOutput,identity:channelOutput??effect??instrument!,
  current:()=>!engine.native&&engine.effects===rack&&(channelOutput?engine.mixerOutput(track)===channelOutput:effect?!!rack?.devices().includes(effect):voice?.node===instrument&&engine.voices.includes(voice!)),
  subscribe(mode:Mode,publish:(data:InspectFrame)=>void):()=>void {
  if(mode==='performance'){
   if(channelOutput)return ()=>{};
   const worker=new Worker(new URL('./inspect-benchmark.worker.ts',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{publish({mode,...data});worker.terminate();};
   worker.onerror=e=>{publish({mode,error:e.message});worker.terminate();};
   worker.postMessage({rate:ctx!.sampleRate,factory:effect?.factory??voice!.compiled.voiceFactory,compiled:effect?undefined:voice!.compiled,values:effect?.values??voice!.values});
   return ()=>worker.terminate();
  }
  const selectedSources=mode==='spectrogram'?sources.slice(-1):sources;
  const taps=selectedSources.map(nodes=>{
   const tap=ctx!.createAnalyser();
   tap.fftSize=mode==='wave'?1024:4096;
   if(mode==='spectrogram')tap.smoothingTimeConstant=0;
   nodes.forEach(node=>node.connect(tap));
   return {tap,nodes,data:new Uint8Array(mode==='wave'?tap.fftSize:tap.frequencyBinCount)};
  });
  const timer=window.setInterval(()=>{
   for(const {tap,data} of taps){
    if(mode==='wave')tap.getByteTimeDomainData(data);else tap.getByteFrequencyData(data);
   }
   publish({mode,seconds:ctx!.currentTime,lines:taps.map(t=>t.data)});
  },50);
  return ()=>{clearInterval(timer);for(const {nodes,tap} of taps){for(const node of nodes){try{node.disconnect(tap);}catch{/* Device already removed. */}}tap.disconnect();}};
 }
 };
 present(source,zh);
}
function present(source:InspectSource,zh:boolean){
 const openWindow=(modes?:Mode[])=>openInspectorWindow(source,zh,modes);
 if(!sidebarInspect){openWindow();return;}
 sidebarInspect({...source,openWindow});
}
export interface InspectFrame { mode:Mode; lines?:Uint8Array[]; seconds?:number; average?:number; peak?:number; error?:string }
export interface InspectSource {
 title:string;rate:number;effect:boolean;canBenchmark:boolean;livePerformance?:boolean;identity:object;current:()=>boolean;
 subscribe:(mode:Mode,publish:(frame:InspectFrame)=>void)=>()=>void;
}
export type InspectRequest=InspectSource & {openWindow:(modes?:Mode[])=>void};
let sidebarInspect:((request:InspectRequest)=>void)|undefined;
export function registerInspector(handler:(request:InspectRequest)=>void){
 sidebarInspect=handler;
 return ()=>{if(sidebarInspect===handler)sidebarInspect=undefined;};
}
function openInspectorWindow(source:InspectSource,zh:boolean,modes?:Mode[]){
 const id='sg-'+crypto.randomUUID();
 const bus=new BroadcastChannel(id);
 const desktop=window.shallowgrooveDesktop;
 let popup:Window|null=null,unsubscribe:(()=>void)|undefined,closed=false;
 const stop=new Map<Mode,()=>void>();
 function disable(mode:Mode){stop.get(mode)?.();stop.delete(mode);}
 function enable(mode:Mode){disable(mode);stop.set(mode,source.subscribe(mode,data=>bus.postMessage(data)));}
 function close(){
  if(closed)return;
  closed=true;unsubscribe?.();desktop?.closeInspector(id);
  for(const mode of stop.keys())disable(mode);
  clearInterval(lifetime);window.removeEventListener('pagehide',close);
  bus.close();if(popup&&!popup.closed)popup.close();
 }
 const lifetime=window.setInterval(()=>{
  if(popup?.closed||!source.current())close();
 },250);
 window.addEventListener('pagehide',close);
 bus.onmessage=({data})=>{
  if(data.ready)bus.postMessage({title:source.title,zh,canBenchmark:source.canBenchmark,livePerformance:source.livePerformance,effect:source.effect,rate:source.rate,modes});
  else if(data.close)close();
  else if(['wave','spectrum','spectrogram','performance'].includes(data.mode))data.enabled?enable(data.mode):disable(data.mode);
 };
 if(desktop){
  unsubscribe=desktop.onInspectorClosed(closedId=>{if(closedId===id)close();});
  void desktop.openInspector(id).catch(error=>{close();window.alert(String(error));});
 }else{
  popup=window.open('/inspect.html#'+id,'_blank','popup,width=600,height=500');
  if(!popup){close();window.alert(zh?'请允许弹出检查窗口。':'Allow pop-ups to inspect this device.');}
 }
}
