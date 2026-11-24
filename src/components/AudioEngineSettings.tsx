import {useState} from 'react';
import {NativeOutputSettings} from './NativeOutputSettings';
import type {AudioEngine} from '../audio/engine';
import {nativeRackFile} from '../audio/native-preview';

export function AudioEngineSettings({open,engine,selectedTrack,disabled,zh,changed,onWorking}:{open:boolean;selectedTrack:number|null;engine:AudioEngine;disabled:boolean;zh:boolean;changed:()=>void;onWorking:(working:boolean)=>void}){
 const [working,setWorking]=useState(false),[issue,setIssue]=useState('');
 const [available,setAvailable]=useState<boolean>();
 const bridge=window.sgNativeAudio;
 if(!bridge)return null;
 const native=engine.native;
 if(!open)return null;
 async function select(enable:boolean){
  if(working||disabled||engine.playing)return;
  setWorking(true);onWorking(true);setIssue('');
  try{
   const status=await bridge!.status();setAvailable(status.available);
   await engine.selectNative(enable);changed();await bridge!.savePreferences({engine:enable?'native':'web'});
  }catch(error){setIssue(String(error));}finally{setWorking(false);onWorking(false);}
 }
 function exportRack(){
  try{
   const data=nativeRackFile(engine,selectedTrack??0),a=document.createElement('a');
   a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
   a.download='ShallowGroove.rack.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }catch(error){setIssue(String(error));}
 }
 return <section className="native-audio-settings">
  <label>{zh?'音频引擎':'Audio engine'} <select aria-label="Audio engine" value={native?'native':'web'} disabled={working||disabled||engine.playing} onChange={e=>void select(e.target.value==='native')}>
   <option value="web">Web Audio</option><option value="native" disabled={available===false}>Native · JUCE / Faust</option>
  </select></label>
  <small>{engine.playing?(zh?'停止后可切换引擎。':'Stop playback to switch engines.'):(zh?'原生引擎支持编曲、现场片段和多轨混音。':'Native audio supports Arrangement, Session clips and multitrack mixing.')}</small>
  {!native&&engine.nativeIssue&&<small>{engine.nativeIssue}</small>}
  {(native||engine.nativeIssue)&&<NativeOutputSettings engine={engine} disabled={working||disabled} zh={zh} changed={changed} onWorking={onWorking}/>}
  <button disabled={selectedTrack===null} onClick={exportRack}>{zh?'保存乐器机架 JSON…':'Save instrument rack JSON…'}</button>
  {issue&&<p role="alert">{issue}</p>}
 </section>;
}
