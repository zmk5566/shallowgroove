import {useEffect,useRef,useState} from 'react';

const rates=[44100,48000,88200,96000];
const depths=[16,24];
const key='shallowgroove.wavExport';
export type ExportFormat={sampleRate:number;bitDepth:number};

function readFormat():ExportFormat {
 try {
  const saved=JSON.parse(localStorage.getItem(key)??'null');
  if(rates.includes(saved?.sampleRate)&&depths.includes(saved?.bitDepth))return saved;
 } catch {}
 return {sampleRate:48000,bitDepth:24};
}

export function ExportSettings({zh,close,confirm}:{zh:boolean;close:()=>void;confirm:(format:ExportFormat)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [format,setFormat]=useState(readFormat);
 useEffect(()=>{dialog.current?.showModal();},[]);
 return <dialog ref={dialog} className="versions-dialog wav-settings" aria-labelledby="wav-export-title" onCancel={close}>
  <form onSubmit={event=>{
   event.preventDefault();
   try{localStorage.setItem(key,JSON.stringify(format));}catch{}
   confirm(format);
  }}>
   <header><strong id="wav-export-title">{zh?'导出立体声 WAV':'Export stereo WAV'}</strong></header>
   <label>{zh?'采样率':'Sample rate'}<select aria-label={zh?'采样率':'Sample rate'} value={format.sampleRate} onChange={e=>setFormat({...format,sampleRate:Number(e.target.value)})}>
    {rates.map(rate=><option key={rate} value={rate}>{rate/1000} kHz</option>)}
   </select></label>
   <label>{zh?'位深':'Bit depth'}<select aria-label={zh?'位深':'Bit depth'} value={format.bitDepth} onChange={e=>setFormat({...format,bitDepth:Number(e.target.value)})}>
    {depths.map(bits=><option key={bits} value={bits}>{bits}{zh?' 位':'-bit'} PCM</option>)}
   </select></label>
   <div className="project-dialog-actions"><button type="button" onClick={close}>{zh?'取消':'Cancel'}</button><button className="primary">{zh?'选择保存位置…':'Choose save location…'}</button></div>
  </form>
 </dialog>;
}
