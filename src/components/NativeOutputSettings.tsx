import {useEffect,useState} from 'react';
import type {AudioEngine} from '../audio/engine';
import {bufferDuration,sameOutput,supportedOutput,systemOutput,type NativeOutput,type OutputOptions} from '../audio/native-output';

export function NativeOutputSettings({engine,disabled,zh,changed,onWorking}:{engine:AudioEngine;disabled:boolean;zh:boolean;changed:()=>void;onWorking:(v:boolean)=>void}){
 const bridge=window.sgNativeAudio!,native=engine.native,details=native?.details;
 const [draft,setDraft]=useState<NativeOutput>(native?.output??systemOutput);
 const [loaded,setLoaded]=useState(!!native),[options,setOptions]=useState<OutputOptions>(),[deviceNames,setNames]=useState<string[]>([]);
 const [issue,setIssue]=useState(''),[saving,setSaving]=useState(false),[revision,refresh]=useState(0);
 useEffect(()=>{
  let current=true;
  if(native){setDraft(native.output);setLoaded(true);}
  else void bridge.preferences().then(p=>{if(current){setDraft(p.output??systemOutput);setLoaded(true);}},e=>{if(current)setIssue(String(e));});
  return ()=>{current=false;};
 },[bridge,native,native?.output]);
 useEffect(()=>{
  const focus=()=>refresh(n=>n+1);window.addEventListener('focus',focus);
  return ()=>window.removeEventListener('focus',focus);
 },[]);
 useEffect(()=>{
  if(!loaded)return;
  let current=true;
  setOptions(undefined);setIssue('');
  async function query(){
   try{
    const data=await bridge.outputOptions(draft.device);
    if(!current)return;
    setNames(data.devices);setOptions(data);
    setDraft(prev=>prev.device===draft.device?supportedOutput(prev,data):prev);
   }catch(error){
    if(!current)return;setIssue(String(error));
    if(draft.device!==null)try{
     const fallback=await bridge.outputOptions(null);if(current)setNames(fallback.devices);
    }catch{/* The selected device error is shown below. */}
   }
  }
  void query();return ()=>{current=false;};
 },[loaded,bridge,draft.device,revision,details?.audioDevice]);
 async function apply(){
  if(disabled||engine.playing||saving||!options)return;
  setSaving(true);onWorking(true);setIssue('');
  try{await engine.changeNativeOutput(draft);changed();}
  catch(error){setIssue(String(error));}
  finally{setSaving(false);onWorking(false);}
 }
 const locked=disabled||engine.playing||saving||!loaded;
 const val=(n:string)=>n===''?null:Number(n);
 const deviceMissing=draft.device!==null&&!deviceNames.includes(draft.device);
 const rate=draft.sampleRate??(draft.device===details?.audioDevice||(native?.output.device===draft.device)?details?.sampleRate:undefined);
 function duration(frames:number){
  if(rate)return bufferDuration(frames,rate)+' ms';
  const rates=options?.sampleRates??[];
  if(!rates.length)return '';
  const low=bufferDuration(frames,Math.max(...rates)),high=bufferDuration(frames,Math.min(...rates));
  return low===high?low+' ms':low+'–'+high+' ms';
 }
 const auto=zh?'设备默认':'Device default',frames=zh?'帧':'frames';
 return <div className="native-output-settings">
  <label>{zh?'输出设备':'Output device'}<select aria-label="Output device" disabled={locked} value={draft.device??''} onChange={e=>{setOptions(undefined);setDraft({...draft,device:e.target.value||null});}}>
   <option value="">{zh?'跟随系统默认':'Follow system default'}</option>{deviceMissing&&<option value={draft.device!}>{draft.device}</option>}{deviceNames.map(d=><option key={d}>{d}</option>)}
  </select></label>
  <label>{zh?'采样率':'Sample rate'}<select aria-label="Sample rate" disabled={locked||!options} value={draft.sampleRate??''} onChange={e=>setDraft({...draft,sampleRate:val(e.target.value)})}>
   <option value="">{auto}</option>{options?.sampleRates.map(n=><option key={n} value={n}>{n} Hz</option>)}
  </select></label>
  <label>{zh?'缓冲区':'Buffer size'}<select aria-label="Buffer size" disabled={locked||!options} value={draft.bufferSize??''} onChange={e=>setDraft({...draft,bufferSize:val(e.target.value)})}>
   <option value="">{auto}</option>{options?.bufferSizes.map(n=><option key={n} value={n}>{n} {frames} · {duration(n)}</option>)}
  </select></label>
  {details?.audioDevice&&<output>{details.audioDevice} · {details.sampleRate} Hz · {details.bufferSize} {frames}{details.bufferSize&&details.sampleRate?' · '+bufferDuration(details.bufferSize,details.sampleRate)+(zh?' ms / 单缓冲':' ms / buffer'):''}</output>}
  <button aria-label="Apply audio output" onClick={()=>void apply()} disabled={locked||!options||deviceMissing||!!native&&sameOutput(draft,native.output)}>{native?(zh?'应用输出设置':'Apply audio output'):(zh?'应用并切换到原生音频':'Apply and switch to Native')}</button>
  {issue&&<p role="alert">{issue}</p>}
 </div>;
}
