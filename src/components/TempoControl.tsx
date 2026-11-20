import {useEffect,useRef,useState} from 'react';
import {MIN_BPM,MAX_BPM,validBpm} from '../model/tempo';
type Drag={x:number;y:number;start:number;value:number;applied:number;last:number};
export function TempoControl({bpm,overridden,disabled,zh,onBegin,onChange,onFinish,source,resumable,onResume}:{bpm:number;source?:string;resumable?:boolean;onResume?:()=>void;overridden:boolean;disabled:boolean;zh:boolean;onBegin:()=>void;onChange:(bpm:number|null)=>void;onFinish:(cancel?:boolean)=>void}){
 const [preview,setPreview]=useState<number|null>(null),[editing,setEditing]=useState(false),[text,setText]=useState(''),[error,setError]=useState('');
 const drag=useRef<Drag|null>(null),input=useRef<HTMLInputElement>(null),accept=useRef(false),finishRef=useRef(onFinish);finishRef.current=onFinish;
 useEffect(()=>{if(editing){input.current?.focus();input.current?.select();}},[editing]);
 useEffect(()=>()=>{if(drag.current)finishRef.current(true);},[]);
 function end(cancel=false){if(!drag.current)return;const state=drag.current;drag.current=null;setPreview(null);try{if(!cancel&&state.value!==state.applied)onChange(state.value);onFinish(cancel);}catch(e){onFinish(true);setError(String(e));}}
 useEffect(()=>{if(disabled)end(true);},[disabled]);
 function apply(value:number|null){try{setError('');if(value!==null)validBpm(value);onBegin();try{onChange(value);onFinish();}catch(e){onFinish(true);throw e;}}catch(e){setError(String(e));}}
 function submit(){if(!accept.current)return;accept.current=false;const value=Number(text);try{validBpm(value);setEditing(false);apply(value);}catch(e){setError(String(e));setEditing(false);}}
 disabled=disabled||source==='hardware';
 const shown=preview??bpm;
 return <div className="tempo-control" onContextMenu={e=>{e.preventDefault();window.dispatchEvent(new CustomEvent('shallowgroove-parameter-menu',{detail:{trackId:'master',device:'mixer',address:'bpm',x:e.clientX,y:e.clientY}}));}}>
  {source==='hardware'&&<small title={zh?'由 Hexblocks 控制':'Controlled by Hexblocks'}>HEX</small>}{source==='automation'&&<small title={zh?'速度自动化正在读取':'Reading tempo automation'}>AUTO</small>}
  {resumable&&<button aria-label="Resume tempo automation" disabled={disabled} onClick={onResume}>Read</button>}
  {editing?<input ref={input} aria-label="Enter BPM" className="tempo-input" type="text" inputMode="decimal" value={text} onChange={e=>setText(e.target.value)} onBlur={submit} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();submit();}if(e.key==='Escape'){accept.current=false;setEditing(false);setError('');}}}/>:<div className="tempo-value" role="spinbutton" aria-label="Project BPM" aria-valuemin={MIN_BPM} aria-valuemax={MAX_BPM} aria-valuenow={Number(shown.toFixed(2))} aria-disabled={disabled} tabIndex={disabled?-1:0} title={zh?'拖动调整 BPM · Shift 精调 · 双击输入 · 右键自动化 / 硬件映射':'Drag to change BPM · Shift for fine adjustment · Double-click to type · Right-click for automation / hardware mapping'}
   onDoubleClick={()=>{if(!disabled){setError('');setText(bpm.toFixed(2));accept.current=true;setEditing(true);}}}
   onPointerDown={e=>{if(disabled||e.button!==0)return;e.preventDefault();e.currentTarget.focus();try{onBegin();setError('');drag.current={x:e.clientX,y:e.clientY,start:bpm,value:bpm,applied:bpm,last:performance.now()};e.currentTarget.setPointerCapture(e.pointerId);}catch(error){setError(String(error));}}}
   onPointerMove={e=>{const d=drag.current;if(!d)return;const distance=(d.y-e.clientY)+(e.clientX-d.x),step=e.shiftKey?.1:1;d.value=Math.round(Math.max(MIN_BPM,Math.min(MAX_BPM,d.start+Math.round(distance/4)*step))*100)/100;setPreview(d.value);if(performance.now()-d.last>=80&&d.value!==d.applied){try{onChange(d.value);d.applied=d.value;d.last=performance.now();}catch(error){end(true);setError(String(error));}}}}
   onPointerUp={()=>end()} onPointerCancel={()=>end(true)} onLostPointerCapture={()=>end(true)}
   onKeyDown={e=>{if(disabled)return;if(e.key==='Escape'){e.stopPropagation();end(true);return;}if(e.key==='Enter'){e.preventDefault();setText(bpm.toFixed(2));accept.current=true;setEditing(true);return;}if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();apply(Math.max(MIN_BPM,Math.min(MAX_BPM,bpm+(e.key==='ArrowUp'?1:-1)*(e.shiftKey?.1:1))));}}}
  ><strong>{shown.toFixed(2)}</strong><small>BPM</small></div>}
  <button className="tempo-midi" aria-label="Restore MIDI tempo" disabled={disabled||!overridden} title={zh?'恢复 MIDI 原始速度变化':'Restore original MIDI tempo changes'} onClick={()=>apply(null)}>MIDI</button>
  {error&&<span className="tempo-error" role="alert">{error}</span>}
 </div>;
}
