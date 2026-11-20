import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {registerInspector,type InspectRequest,type Mode} from '../audio/inspect';
import {drawInspector} from '../../public/inspect-plots.js';
import {createSpectrogram} from '../../public/spectrogram.js';

const labels={wave:['Waveform','波形'],spectrum:['Spectrum','频谱'],spectrogram:['Spectrogram','声谱图'],performance:['Performance','性能']};
const plots:Mode[]=['wave','spectrum','spectrogram'];
type Card={id:string;source:InspectRequest;mode:Mode};

function Plot({card,zh}:{card:Card;zh:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),result=useRef<HTMLOutputElement>(null);
 const {source,mode}=card;
 useEffect(()=>{
  if(!source.current())return;
  const theme=getComputedStyle(document.documentElement);
  const color=(name:string)=>theme.getPropertyValue('--'+name).trim();
  const colors={grid:color('line'),input:color('muted'),output:color('signal')};
  const paint=mode==='spectrogram'?createSpectrogram(canvas.current!,source.rate,[color('bg'),colors.grid,colors.output,color('ink')]):null;
  return source.subscribe(mode,frame=>{
   if(result.current){
    result.current.value=frame.error??((zh?'平均 ':'Mean ')+frame.average?.toFixed(2)+'% · '+(zh?'峰值 ':'Peak ')+frame.peak?.toFixed(2)+'%');
   }else if(canvas.current&&frame.lines){
    if(paint)paint(frame.lines[0],frame.seconds!);
    else drawInspector(canvas.current,mode,frame.lines,source.rate,source.effect,colors);
   }
  });
 },[source,mode,zh]);
 if(mode==='performance')return <output ref={result}>{zh?'离线 DSP 测量中…':'Measuring offline DSP…'}</output>;
 const axis=mode==='wave'?`0–${(1024/source.rate*1000).toFixed(1)} ms`:`20 Hz–${(source.rate/2000).toFixed(1)} kHz`;
 return <><canvas ref={canvas} role="img" aria-label={labels[mode][+zh]}/><small>{mode==='spectrogram'?'8 s → · ':source.effect?(zh?'虚线输入 · 实线输出 · ':'In ┄ Out ━ · '):''}{axis}</small></>;
}

export function InspectorSection({zh,visible,reveal}:{zh:boolean;visible:boolean;reveal:()=>void}){
 const [cards,setCards]=useState<Card[]>([]),[expanded,setExpanded]=useState(true);
 const [request,setRequest]=useState<InspectRequest|null>(null),[selected,setSelected]=useState<Mode[]>([]);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>registerInspector(source=>{
  const existing=cards.filter(c=>c.source.identity===source.identity);
  setSelected(existing.length?existing.map(c=>c.mode):plots);
  setRequest(source);
 }),[cards]);
 useEffect(()=>{if(request)dialog.current?.showModal();},[request]);
 useEffect(()=>{
  if(!cards.length&&!request)return;
  const timer=setInterval(()=>{
   if(cards.some(c=>!c.source.current()))setCards(prev=>prev.filter(c=>c.source.current()));
   if(request&&!request.current())setRequest(null);
  },250);
  return ()=>clearInterval(timer);
 },[cards,request]);
 function apply(){
  if(!request?.current()){setRequest(null);return;}
  const additions=selected.filter(mode=>!cards.some(c=>c.source.identity===request.identity&&c.mode===mode))
   .map(mode=>({id:crypto.randomUUID(),source:request,mode}));
  setCards(prev=>[...prev.filter(c=>c.source.identity!==request.identity||selected.includes(c.mode)),...additions]);
  setRequest(null);setExpanded(true);reveal();
 }
 const name=(mode:Mode)=>labels[mode][+zh];
 return <>
 {cards.length>0&&<section className="inspect-section">
  <button className="hexblocks-heading" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><strong>{expanded?'▾':'▸'} {zh?'检查器':'Inspector'}</strong><span>{cards.length}</span></button>
  {expanded&&visible&&<div className="inspect-grid">{cards.map(card=><article key={card.id} className={'inspect-card '+card.mode}>
   <header><b>{name(card.mode)}</b><button aria-label={(zh?'关闭 ':'Close ')+card.source.title+' · '+name(card.mode)} onClick={()=>setCards(prev=>prev.filter(c=>c.id!==card.id))}>×</button></header>
   <div className="inspect-source" title={card.source.title}>{card.source.title}</div><Plot card={card} zh={zh}/>
  </article>)}</div>}
 </section>}
 {request&&createPortal(<dialog ref={dialog} className="project-dialog inspect-picker" aria-labelledby="inspect-picker-title" onCancel={()=>setRequest(null)}>
  <h2 id="inspect-picker-title">{zh?'检查信号':'Inspect signal'}</h2><p>{request.title}</p>
  {(request.canBenchmark?[...plots,'performance' as const]:plots).map(mode=><label key={mode}><input type="checkbox" checked={selected.includes(mode)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,mode]:prev.filter(m=>m!==mode))}/>{name(mode)}</label>)}
  <div className="project-dialog-actions"><button onClick={()=>setRequest(null)}>{zh?'取消':'Cancel'}</button><button onClick={()=>{request.openWindow(selected);setRequest(null);}}>{zh?'独立窗口':'Separate window'}</button><button className="primary" onClick={apply} disabled={!selected.length&&!cards.some(c=>c.source.identity===request.identity)}>{zh?'更新侧栏':'Update sidebar'}</button></div>
 </dialog>,document.body)}
 </>;
}
