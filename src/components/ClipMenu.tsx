import {gridTick,type Division} from '../model/arrangement-grid';
import {clipReferenceCount} from '../model/clips';
import {useRef,useState} from 'react';
import type {Clip,ClipAction,ClipRef} from '../model/clips';
import type {Project} from '../model/project';
import {barRange,meterMap,musicalPosition} from '../model/meter';

export type MenuAction=ClipAction|{kind:'copyBars';start:number;end:number;destination:number};
type Props={unit:Division|'off';triplet:boolean;project:Project;index:number;range:{start:number;end:number}|null;active?:ClipRef;cursor:number;zh:boolean;disabled:boolean;onAction:(action:MenuAction)=>Promise<void>};

function treeRows(clips:Clip[]){
 const children=new Map<string|undefined,Clip[]>();
 for(const c of clips){const parent=c.source?.id;children.set(parent,[...(children.get(parent)??[]),c]);}
 const rows:{clip:Clip;depth:number}[]=[],stack=(children.get(undefined)??[]).map(clip=>({clip,depth:0})).reverse();
 while(stack.length){const row=stack.pop()!;rows.push(row);for(const child of [...(children.get(row.clip.id)??[])].reverse())stack.push({clip:child,depth:row.depth+1});}
 return rows;
}
export function ClipMenu({unit,triplet,project,index,range,active,cursor,zh,disabled,onAction}:Props){
 const dlg=useRef<HTMLDialogElement>(null);
 const [picked,setPicked]=useState(''),[name,setName]=useState(''),[bar,setBar]=useState('1'),[error,setError]=useState(''),[waiting,setWaiting]=useState(false);
 const clips=project.clips??[],current=clips.find(c=>c.id===active?.clipId);
 const chosen=clips.find(c=>c.id===picked);
 const label=(cn:string,en:string)=>zh?cn:en;
 function open(){
  const after=active&&current?active.start+current.length:range?.end??cursor;
  const target=gridTick(meterMap(project),project.timing.ppqn,after,unit,triplet);
  const pos=musicalPosition(project,target);
  setBar(pos.tick?`${pos.bar}.${pos.beat}.${pos.tick}`:pos.beat>1?`${pos.bar}.${pos.beat}`:String(pos.bar));setName('');setPicked(current?.id??clips[0]?.id??'');setError('');dlg.current?.showModal();
 }
 async function run(action:()=>MenuAction){
  if(waiting)return;setWaiting(true);
  try{await onAction(action());dlg.current?.close();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWaiting(false);}
 }
 function destination(){
  if(!/^\d+(?:\.\d+){0,2}$/.test(bar))throw Error(label('请输入 小节.拍.tick','Enter bar.beat.tick'));
  const [measure,beat=1,tick=0]=bar.split('.').map(Number);
  const meters=meterMap(project),range=barRange(project,measure),meter=meters.reduce((last,m)=>m.bar<=measure?m:last,meters[0]);
  const at=range.startTick+(beat-1)*meter.ticksPerBeat+tick;
  if(beat<1||tick>=meter.ticksPerBeat||at>=range.endTick)throw Error(label('位置超出小节','Position outside bar'));
  return gridTick(meters,project.timing.ppqn,at,unit,triplet);
 }
 const count=current?clipReferenceCount(project,current.id):0;
 return <><button disabled={disabled||index<0} onClick={open}>{current?`${current.name} · ${count} ${label('处引用','refs')} ▾`:'Clip ▾'}</button>
 <dialog ref={dlg} className="clip-menu" aria-label="Clips"><form onSubmit={e=>e.preventDefault()}>
 <header><strong>{project.tracks[index]?.name} · Clips</strong><button type="button" onClick={()=>dlg.current?.close()} aria-label="Close">×</button></header>
 <fieldset disabled={waiting}>
 {clips.length>0&&<label>{label('Clip 变奏树','Clip variations')}<select value={picked} onChange={e=>setPicked(e.target.value)}>{treeRows(clips).map(({clip,depth})=><option key={clip.id} value={clip.id}>{'　'.repeat(Math.min(depth,16))}{depth?'↳ ':''}{clip.name}</option>)}</select></label>}
 <label>{label('新名称','New name')}<input value={name} onChange={e=>setName(e.target.value)} placeholder={label('Clip 或变奏名称','Clip or variation name')}/></label>
 <div><button disabled={!range} onClick={()=>run(()=>({kind:'create',...range!,name:name.trim()||`Clip ${clips.length+1}`}))}>{label('从选区建立 Clip','Create clip from selection')}</button>
 {active&&current&&<button onClick={()=>run(()=>({kind:'fork',refId:active.id,name:name.trim()||`${current.name} · ${clips.filter(c=>c.source?.id===current.id).length+1}`}))}>{label('从当前引用创建变奏','Fork current reference')}</button>}</div>
 {active&&chosen&&chosen.id!==active.clipId&&<button onClick={()=>run(()=>({kind:'switch',refId:active.id,clipId:chosen.id}))}>{label('将当前引用切换到所选版本','Switch this reference to selected version')}</button>}
 <label>{label('目标位置（小节.拍.tick）','Destination (bar.beat.tick)')}<input type="text" value={bar} onChange={e=>setBar(e.target.value)}/></label>
 <div><button disabled={!chosen} onClick={()=>run(()=>({kind:'insert',clipId:picked,start:destination()}))}>{label('插入所选 Clip 引用','Insert clip reference')}</button>
 <button disabled={!range} onClick={()=>run(()=>({kind:'copyBars',...range!,destination:destination()}))}>{label('独立复制选区','Copy selection independently')}</button></div>
 </fieldset>{error&&<p role="alert">{error}</p>}</form></dialog></>;
}
