import {useRef,useState} from 'react';
import type {Project} from '../model/project';
import {fillArrangementSlots,sceneRows,type Scene} from '../model/scenes';
import type {Launch} from '../audio/live-clips';

type Props={project:Project;zh:boolean;selected:number;disabled:boolean;onScenes:(rows:Scene[])=>void;onCreate:(scene:string,track:string,bars:number)=>void;onEdit:(track:number,id:string,scene:string)=>void;onEmpty:(track:number,scene:Scene)=>void;focus?:{track:string;scene:string}|null;onLaunch:(scene:Scene,track?:string)=>void;state:(track:number)=>{active?:Launch|null;pending?:Launch|null}};
export function SessionView({project,zh,selected,disabled,onScenes,onCreate,onEdit,onLaunch,onEmpty,focus,state}:Props){
 const rows=sceneRows(project),clips=project.clips??[];
 const [picker,setPicker]=useState<{scene:string;track:string}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),lengthInput=useRef<HTMLInputElement>(null);
 const target=useRef<{scene:string;track:string}|null>(null);
 const [error,setError]=useState('');
 function newClip(scene:string,track:string){
  target.current={scene,track};setError('');
  if(lengthInput.current)lengthInput.current.value='1';
  dialog.current?.showModal();lengthInput.current?.select();
 }
 function assign(scene:Scene,trackId:string,clipId:string){
  const slots=scene.slots.filter(s=>s.trackId!==trackId);
  if(clipId)slots.push({trackId,clipId});
  onScenes(rows.map(s=>s===scene?{...s,slots}:s));setPicker(null);
 }
 return <section className="session-view" aria-label={zh?'现场视图':'Session view'}>
 <div className="session-tools"><button disabled={disabled} onClick={()=>onScenes([...rows,{id:crypto.randomUUID(),name:String(rows.length+1),slots:[]}])}>{zh?'＋ 场景':'＋ Scene'}</button>{project.tracks.some(track=>track.clipRefs?.length)&&<button disabled={disabled} onClick={()=>{const next=fillArrangementSlots(project);if(next!==project.scenes)onScenes(next);}}>{zh?'补齐编曲 Clip':'Fill from Arrangement'}</button>}</div>
 <div className="session-rows" onScroll={e=>e.currentTarget.style.setProperty('--scene-scroll-top',e.currentTarget.scrollTop+'px')}><div className="session-scroll" tabIndex={0} role="region" aria-label={zh?'现场轨道':'Session tracks'}><table><thead><tr>{project.tracks.map((t,i)=><th key={t.id} className={i===selected?'selected':''} scope="col">{t.name}</th>)}</tr></thead>
 <tbody>{rows.map(scene=><tr key={scene.id}>{project.tracks.map((t,i)=>{
  const slot=scene.slots.find(s=>s.trackId===t.id),clip=clips.find(c=>c.id===slot?.clipId),status=state(i);
  const queued=status.pending?.sceneId===scene.id&&status.pending.clip?.id===clip?.id;
  const active=status.active?.sceneId===scene.id&&status.active.clip?.id===clip?.id;
  const choosing=picker?.scene===scene.id&&picker.track===t.id;
  return <td key={t.id} data-clip-id={clip?.id} className={queued?'queued':active?'sounding':''}>{choosing?
   <select autoFocus aria-label={zh?'槽位 Clip':'Slot clip'} defaultValue={slot?.clipId??''} onBlur={()=>setPicker(null)} onKeyDown={e=>{if(e.key==='Escape')setPicker(null);}} onChange={e=>assign(scene,t.id,e.target.value)}>
   <option value="">{zh?'空槽位':'Empty slot'}</option>{clips.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select>:
   <div className="session-cell">{slot&&clip&&<><button disabled={disabled} title={queued?(zh?'等待下一小节':'Queued for next bar'):clip.name} aria-label={`Launch ${clip.name} · ${scene.name}`} onClick={()=>onLaunch(scene,t.id)}>{queued?'◷':'▶'}</button><button className="slot-name" onClick={()=>onEdit(i,clip.id,scene.id)}>{clip.name}</button></>}
   {!slot&&<button className="slot-empty" disabled={disabled} aria-label={`${zh?'空槽位':'Empty slot'} · ${t.name} · ${scene.name}`} aria-pressed={focus?.track===t.id&&focus.scene===scene.id} onClick={()=>onEmpty(i,scene)} onContextMenu={e=>{e.preventDefault();newClip(scene.id,t.id);}} onKeyDown={e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();newClip(scene.id,t.id);}}}/>}
   {clips.length>0&&<button disabled={disabled} className="slot-assign" title={zh?'引用已有 Clip':'Use existing clip'} aria-label={`Assign clip · ${t.name} · ${scene.name}`} onClick={()=>setPicker({scene:scene.id,track:t.id})}>▾</button>}</div>}</td>;
 })}</tr>)}</tbody></table></div>
 <div className="session-scenes"><div className="scene-heading">{zh?'场景':'Scenes'}</div>{rows.map(scene=><div key={scene.id} className="scene-launch"><button disabled={disabled} aria-label={`Launch scene ${scene.name}`} onClick={()=>onLaunch(scene)}>▶</button><input key={scene.id+scene.name} aria-label={zh?'场景名称':'Scene name'} defaultValue={scene.name} disabled={disabled} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} onBlur={e=>{const name=e.target.value.trim()||scene.name;if(name!==scene.name)onScenes(rows.map(s=>s===scene?{...s,name}:s));else e.target.value=name;}}/></div>)}</div></div>
 <dialog ref={dialog} aria-label={zh?'新建 Clip':'Create clip'} className="clip-menu">
 <form onSubmit={e=>{
  e.preventDefault();const slot=target.current;
  if(!slot||!lengthInput.current)return;
  try{onCreate(slot.scene,slot.track,lengthInput.current.valueAsNumber);dialog.current?.close();}
  catch(err){setError(err instanceof Error?err.message:String(err));}
 }}>
 <fieldset><label>{zh?'长度（小节）':'Length (bars)'}<input ref={lengthInput} autoFocus type="number" min="1" step="1" defaultValue="1" required/></label>
 <div><button type="button" onClick={()=>dialog.current?.close()}>{zh?'取消':'Cancel'}</button><button type="submit" disabled={disabled}>{zh?'创建并编辑':'Create and edit'}</button></div></fieldset>
 {error&&<p role="alert">{error}</p>}</form></dialog></section>;
}
