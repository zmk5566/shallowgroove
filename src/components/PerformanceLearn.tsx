import {useEffect,useRef,useState} from 'react';
import type {LearnedInput,PerformanceSignals} from '../hardware/performance-signals';
import type {PerformanceNode} from '../model/performance';

export function PerformanceLearn({signals,zh,onClose,onAdd}:{signals:PerformanceSignals;zh:boolean;onClose:()=>void;onAdd:(nodes:PerformanceNode[])=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [waiting,setWaiting]=useState(true),[rows,setRows]=useState<LearnedInput[]>([]);
 const [selected,setSelected]=useState(new Set<string>());
 const t=(en:string,cn:string)=>zh?cn:en;
 useEffect(()=>{
  const el=dialog.current!;
  el.showModal();signals.beginLearn();
  return ()=>{signals.endLearn();el.close();};
 },[signals]);
 useEffect(()=>{
  if(!waiting)return;
  const timer=window.setInterval(()=>setRows(signals.learnedInputs()),100);
  return ()=>clearInterval(timer);
 },[signals,waiting]);
 function stop(){setRows(signals.endLearn());setWaiting(false);}
 return <dialog ref={dialog} className="perf-learn project-dialog" onCancel={onClose} aria-label="Learn" onKeyDown={e=>e.stopPropagation()}>
  <header><strong>Learn</strong><button aria-label={t('Close','关闭')} onClick={onClose}>×</button></header>
  <p role="status">{waiting?t('Listening for OSC, MIDI CC and HexBlocks…','正在等待 OSC、MIDI CC 和 HexBlocks 输入…'):
    rows.length?t('Select inputs to add to the canvas.','勾选要添加到画布的输入。'):t('No input received.','没有收到输入。')}</p>
  <div className="perf-learn-list">{rows.map(row=><label key={row.key}>
   {!waiting&&<input type="checkbox" checked={selected.has(row.key)} onChange={e=>{
    const next=new Set(selected);if(e.target.checked)next.add(row.key);else next.delete(row.key);setSelected(next);
   }}/>}
   <small>{row.node.kind==='osc-input'?'OSC':row.node.kind==='sensor'?'HexBlocks':'MIDI'}</small>
   <span>{row.source}</span><output>{row.value===null?'—':String(row.value)}</output>
  </label>)}</div>
  <footer>{waiting?<button onClick={stop}>{t('Stop Learn','停止 Learn')}</button>:
   <button disabled={!selected.size} onClick={()=>{
    onAdd(rows.filter(r=>selected.has(r.key)).map(r=>({...r.node,id:crypto.randomUUID()})));onClose();
   }}>{t('Add selected','添加选中项')} ({selected.size})</button>}</footer>
 </dialog>;
}
