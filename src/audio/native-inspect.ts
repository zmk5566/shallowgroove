import type {ChannelTarget} from './effects';
import type {InspectFrame,Mode} from './inspect';
import type {StereoLevel} from './stereo-meter';

export type ProbeRequest=(command:Record<string,unknown>)=>Promise<Record<string,unknown>>;
function lines(field:unknown):Uint8Array[]{
 if(!Array.isArray(field))return [];
 return field.map(text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0)));
}

// One native tap and one FFT feed any combination of plots for this source.
export function nativeInspector(request:ProbeRequest,track:ChannelTarget,device:string,current:()=>boolean){
 const listeners=new Map<Mode,Set<(frame:InspectFrame)=>void>>();
 let running=false,timer:ReturnType<typeof setTimeout>|undefined,token='';
 const publish=(frame:InspectFrame)=>{for(const callback of listeners.get(frame.mode)??[])callback(frame);};
 async function read(id:string){
  if(id!==token||!running||!current())return;
  const wave=listeners.has('wave'),spectrum=listeners.has('spectrum')||listeners.has('spectrogram');
  try{
   const frame=await request({op:'inspectRead',token:id,track,device,wave,spectrum,performance:listeners.has('performance')});
   if(id!==token||!running||!current())return;
   const seconds=Number(frame.seconds);
   if(wave)publish({mode:'wave',lines:lines(frame.wave),seconds});
   if(spectrum){
    const bins=lines(frame.spectrum);
    if(bins.length){
     publish({mode:'spectrum',lines:bins,seconds});
     publish({mode:'spectrogram',lines:bins.slice(-1),seconds});
    }
   }
   if(typeof frame.average==='number'&&typeof frame.peak==='number')publish({mode:'performance',average:frame.average,peak:frame.peak});
  }catch(error){
   if(id===token && current())for(const mode of listeners.keys())publish({mode,error:String(error)});
  }
  if(id===token&&running&&current())timer=setTimeout(()=>void read(id),50);
 }
 return (mode:Mode,callback:(frame:InspectFrame)=>void)=>{
  let set=listeners.get(mode);
  if(!set){set=new Set();listeners.set(mode,set);}
  set.add(callback);
  if(!running){running=true;token=crypto.randomUUID();timer=setTimeout(()=>void read(token),0);}
  return ()=>{
   set.delete(callback);
   if(!set.size)listeners.delete(mode);
   if(listeners.size||!running)return;
   clearTimeout(timer);running=false;
   // A closing old inspector must never start a new engine process.
   void request({op:'inspectClose',token,track,device}).catch(()=>{});
  };
 };
}

export class NativeMeters {
 private pending=false;
 levels:StereoLevel[]=[];
 private readonly request:ProbeRequest;
 constructor(request:ProbeRequest){this.request=request;}
 poll(){
  if(this.pending||document.hidden)return;
  this.pending=true;
  void this.request({op:'meters'}).then(data=>{
   if(!Array.isArray(data.tracks)||!Array.isArray(data.buses))return;
   this.levels=[...data.tracks,...data.buses].map(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(Number.isFinite)?[pair[0],pair[1]]:[0,0]);
  }).catch(()=>{this.levels=[];}).finally(()=>{this.pending=false;});
 }
}
