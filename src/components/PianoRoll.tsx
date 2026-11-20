import {clipReferenceCount} from '../model/clips';
import type {Clip,ClipRef} from '../model/clips';
import {useEffect,useEffectEvent,useLayoutEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import type {Project,Note} from '../model/project';
import {noteSnapshot,type NoteEdit} from '../model/notes';
import {gridTicks,snapTick,moveNotes,resizeNotes,pointToNote,type RollNote} from '../model/piano-roll';
import {meterMap,positionInMeter} from '../model/meter';
const keys=48,ruler=24;
const pitchName=(pitch:number)=>`${['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][pitch%12]}${Math.floor(pitch/12)-1}`;
const signature=(n:Note)=>`${n.tick}/${n.end}/${n.pitch}/${n.velocity}`;
type Gesture={kind:'move'|'resize'|'box';x:number;y:number;notes:RollNote[];revision:string;shift:boolean;selected:string[];deltaTick:number;deltaPitch:number};
export function PianoRoll({referenceCount,clip,clipRef,onExitClip,project,index,zh,disabled,playhead,onCommit,onSeek}:{referenceCount?:number;clip?:Clip;clipRef?:ClipRef;onExitClip:()=>void;project:Project;index:number;zh:boolean;disabled:boolean;playhead:number;onCommit:(edit:NoteEdit)=>Promise<unknown>;onSeek?:(tick:number)=>void}){
 const track=project.tracks[index],ppqn=project.timing.ppqn;
 const snapshot=useMemo(()=>{
  const all=noteSnapshot(project,index);
  if(!clipRef)return all;
  return {...all,notes:all.notes.filter(n=>track.events[Number(n.id.slice(5))].clipRef===clipRef.id)};
 },[track.events,track.clipRefs,track.id,track.midi_channel,project.timing.end_tick,index,clipRef?.id]);
 const [quarter,setQuarter]=useState(64),[row,setRow]=useState(16),[division,setDivision]=useState(16),[velocity,setVelocity]=useState(96);
 const [selected,setSelected]=useState<string[]>([]),[preview,setPreview]=useState<RollNote[]|null>(null),[box,setBox]=useState<{x:number;y:number;w:number;h:number}|null>(null);
 const [waiting,setWaiting]=useState(false),[error,setError]=useState(''),[view,setView]=useState({left:0,top:0,width:800,height:180});
 const root=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null),surface=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null),pendingSelection=useRef<Set<string>|null>(null),centered=useRef(false);
 const [tool,setTool]=useState<'select'|'draw'|'hand'>('select');
 const menu=useRef<HTMLDivElement>(null);
 const pan=useRef<{x:number;y:number;left:number;top:number}|null>(null);
 const stroke=useRef<{revision:string;notes:Map<string,RollNote>;last:{tick:number;pitch:number};origin:number}|null>(null);
 const labels={select:zh?'选择':'Select',draw:zh?'画笔':'Draw',hand:zh?'手形平移':'Hand pan'};
 function showMenu(x:number,y:number){
  const el=menu.current;if(!el)return;
  el.style.left=Math.max(0,Math.min(x,window.innerWidth-160))+'px';el.style.top=Math.max(0,Math.min(y,window.innerHeight-116))+'px';
  el.showPopover();el.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
 }
 function choose(next:typeof tool){cancel();setTool(next);menu.current?.hidePopover();root.current?.focus({preventScroll:true});}
 const step=gridTicks(ppqn,division),blocked=disabled||waiting,chosen=snapshot.notes.filter(n=>selected.includes(n.id));
 const localClip=clip&&!clipRef?clip:undefined;
 const extent=localClip?project.timing.end_tick:snapshot.notes.reduce((end,n)=>Math.max(end,n.end),Math.max(project.timing.end_tick,ppqn*16))+ppqn*16;
 const width=keys+extent/ppqn*quarter,height=ruler+128*row;
 const updateView=()=>{const el=scroll.current;if(el)setView({left:el.scrollLeft,top:el.scrollTop,width:el.clientWidth,height:el.clientHeight});};
 useEffect(()=>{const el=scroll.current;if(!el)return;const observer=new ResizeObserver(updateView);observer.observe(el);return()=>observer.disconnect();},[]);
 useEffect(()=>{centered.current=false;},[clipRef?.id]);
 useEffect(()=>{const el=scroll.current;if(!el||centered.current||view.height<10)return;const first=snapshot.notes[0],pitch=first?.pitch??60;el.scrollTop=Math.max(0,ruler+(127-pitch)*row-el.clientHeight/2);el.scrollLeft=Math.max(0,(clipRef?.start??first?.tick??0)/ppqn*quarter-quarter);centered.current=true;updateView();},[view.height,clipRef?.id]);
 useEffect(()=>{
  setSelected(pendingSelection.current?snapshot.notes.filter(n=>pendingSelection.current!.has(signature(n))).map(n=>n.id):[]);pendingSelection.current=null;
  gesture.current=null;pan.current=null;stroke.current=null;setPreview(null);setBox(null);
 },[snapshot.revision,clipRef?.id]);
 useEffect(()=>{if(blocked){gesture.current=null;pan.current=null;stroke.current=null;setPreview(null);setBox(null);}},[blocked]);
 function cancel(){gesture.current=null;pan.current=null;stroke.current=null;setPreview(null);setBox(null);}
 async function commit(edit:Omit<NoteEdit,'revision'>,revision=snapshot.revision){
  if(blocked)return;setWaiting(true);setError('');
  const expected=[...(edit.add??[]),...(edit.update??[]).map(p=>({...snapshot.notes.find(n=>n.id===p.id)!,...p}))];pendingSelection.current=new Set(expected.map(signature));
  try{
   if(clipRef&&clip&&[...(edit.add??[]),...(edit.update??[])].some(n=>n.tick!==undefined&&(n.tick<clipRef.start||n.tick>=clipRef.start+clip.length)))throw Error(zh?'音符起点超出当前 Clip':'Note starts outside the current clip');
   await onCommit({...edit,revision});}catch(e){pendingSelection.current=null;setError(String(e));}finally{setWaiting(false);requestAnimationFrame(()=>root.current?.focus({preventScroll:true}));}
 }
 function coordinates(clientX:number,clientY:number){const rect=surface.current!.getBoundingClientRect();return {x:clientX-rect.left,y:clientY-rect.top};}
 function noteDown(e:ReactPointerEvent<HTMLElement>,note:RollNote,resize=false){
  if(blocked||e.button!==0||e.ctrlKey)return;e.preventDefault();e.stopPropagation();root.current?.focus({preventScroll:true});
  const ids=e.shiftKey?(selected.includes(note.id)?selected.filter(id=>id!==note.id):[...selected,note.id]):selected.includes(note.id)?selected:[note.id];
  if(ids.length>512){setError(zh?'一次最多选择 512 个音符':'Select at most 512 notes');return;}
  setSelected(ids);if(!ids.includes(note.id))return;
  const notes=snapshot.notes.filter(n=>ids.includes(n.id)),point=coordinates(e.clientX,e.clientY);
  gesture.current={kind:resize?'resize':'move',...point,notes,revision:snapshot.revision,shift:e.shiftKey,selected:ids,deltaTick:0,deltaPitch:0};e.currentTarget.setPointerCapture(e.pointerId);
 }
 function backgroundDown(e:ReactPointerEvent<HTMLDivElement>){
  if(blocked||e.button!==0||e.ctrlKey||(e.target as HTMLElement).closest('button,.piano-header,.piano-keys'))return;
  const point=coordinates(e.clientX,e.clientY);if(point.x<keys||point.y<ruler)return;
  root.current?.focus({preventScroll:true});e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  gesture.current={kind:'box',...point,notes:[],revision:snapshot.revision,shift:e.shiftKey,selected,deltaTick:0,deltaPitch:0};
 }
 function paint(x:number,y:number){
  const g=stroke.current;if(!g)return;
  const at=pointToNote(x,y,keys,ruler,row,quarter,ppqn),unit=division?step:ppqn;
  const cell=(tick:number)=>Math.floor((tick-g.origin)/unit);
  const from=cell(g.last.tick),to=cell(at.tick),distance=Math.abs(to-from);
  const start=clipRef?.start??0,limit=clipRef&&clip?start+clip.length:localClip?.length??extent;
  for(let i=0;i<=Math.min(distance,512)&&g.notes.size<512;i++){
   const tick=g.origin+(from+i*Math.sign(to-from))*unit,end=Math.min(tick+unit,limit);
   const pitch=distance?Math.round(g.last.pitch+(at.pitch-g.last.pitch)*i/distance):at.pitch;
   const id=tick+'/'+pitch;
   if(tick>=start&&end>tick&&!g.notes.has(id)&&!snapshot.notes.some(n=>n.pitch===pitch&&n.tick<end&&n.end>tick))g.notes.set(id,{id,tick,end,pitch,velocity});
  }
  g.last=at;setPreview([...g.notes.values()]);
 }
 function toolDown(e:ReactPointerEvent<HTMLDivElement>){
  const target=e.target as HTMLElement,el=scroll.current!;
  if(blocked||!e.isPrimary||e.ctrlKey&&e.button===0||target.closest('.piano-header,.piano-keys')||!(e.button===1||e.button===0&&tool!=='select'))return;
  const p=coordinates(e.clientX,e.clientY),bounds=el.getBoundingClientRect();
  if(e.clientX<bounds.left+keys||e.clientY<bounds.top+ruler||e.clientX>=bounds.left+el.clientWidth||e.clientY>=bounds.top+el.clientHeight)return;
  e.preventDefault();e.stopPropagation();root.current?.focus({preventScroll:true});el.setPointerCapture(e.pointerId);
  if(tool==='hand'||e.button===1){pan.current={x:e.clientX,y:e.clientY,left:el.scrollLeft,top:el.scrollTop};return;}
  const id=target.closest<HTMLElement>('[data-note-id]')?.dataset.noteId;
  if(id){void commit({remove:[id]});return;}
  const at=pointToNote(p.x,p.y,keys,ruler,row,quarter,ppqn);
  stroke.current={revision:snapshot.revision,notes:new Map(),last:at,origin:division?0:at.tick};paint(p.x,p.y);
 }
 function move(e:ReactPointerEvent){
  if(pan.current&&scroll.current){scroll.current.scrollLeft=pan.current.left+pan.current.x-e.clientX;scroll.current.scrollTop=pan.current.top+pan.current.y-e.clientY;return;}
  if(stroke.current){const p=coordinates(e.clientX,e.clientY);paint(p.x,p.y);return;}
  const g=gesture.current;if(!g||blocked)return;const point=coordinates(e.clientX,e.clientY);
  if(g.kind==='box'){setBox({x:Math.min(g.x,point.x),y:Math.min(g.y,point.y),w:Math.abs(point.x-g.x),h:Math.abs(point.y-g.y)});return;}
  const raw=(point.x-g.x)/quarter*ppqn;g.deltaTick=Math.round(raw/step)*step;g.deltaPitch=Math.round((g.y-point.y)/row);
  const changes=g.kind==='move'?moveNotes(g.notes,g.deltaTick,g.deltaPitch):resizeNotes(g.notes,g.deltaTick,step);
  setPreview(g.notes.map(n=>({...n,...changes.find(p=>p.id===n.id)})));
 }
 function finish(e:ReactPointerEvent){
  if(pan.current){pan.current=null;return;}
  if(stroke.current){const g=stroke.current;stroke.current=null;setPreview(null);if(!blocked&&g.notes.size)void commit({add:[...g.notes.values()].map(({id,...note})=>note)},g.revision);return;}
  const g=gesture.current;if(!g)return;gesture.current=null;pan.current=null;stroke.current=null;setPreview(null);setBox(null);
  if(blocked||g.revision!==snapshot.revision)return;
  if(g.kind==='box'){
   const p=coordinates(e.clientX,e.clientY),left=Math.min(g.x,p.x),right=Math.max(g.x,p.x),top=Math.min(g.y,p.y),bottom=Math.max(g.y,p.y);
   const hits=Math.abs(p.x-g.x)<3&&Math.abs(p.y-g.y)<3?[]:snapshot.notes.filter(n=>keys+n.end/ppqn*quarter>left&&keys+n.tick/ppqn*quarter<right&&ruler+(128-n.pitch)*row>top&&ruler+(127-n.pitch)*row<bottom).map(n=>n.id);
   const ids=[...new Set([...(g.shift?g.selected:[]),...hits])];if(ids.length>512){setError(zh?'选区超过 512 个音符，请缩小范围':'Selection exceeds 512 notes; select a smaller range');return;}setSelected(ids);return;
  }
  if(!g.deltaTick&&(g.kind==='resize'||!g.deltaPitch))return;
  void commit({update:g.kind==='move'?moveNotes(g.notes,g.deltaTick,g.deltaPitch):resizeNotes(g.notes,g.deltaTick,step)},g.revision);
 }
 const pendingZoom=useRef<{quarter:number;left:number}|null>(null);
 const rulerDrag=useRef<{id:number;y:number;x:number;anchor:number;quarter:number;beat:number;moved:boolean}|null>(null);
 function setTimeScale(scale:number,anchor:number,beat:number){
  const el=scroll.current;if(!el)return;
  const next=Math.max(.25,Math.min(256,scale));
  const left=Math.max(0,Math.min(Math.max(0,keys+extent/ppqn*next-el.clientWidth),keys+beat*next-anchor));
  if(next===quarter){pendingZoom.current=null;setQuarter(next);el.scrollLeft=left;return;}
  pendingZoom.current={quarter:next,left};setQuarter(next);
 }
 useLayoutEffect(()=>{
  const target=pendingZoom.current;
  if(target&&scroll.current){scroll.current.scrollLeft=target.left;pendingZoom.current=null;updateView();}
 },[quarter]);
 function zoomTime(factor:number,pointerX?:number){
  const el=scroll.current;if(!el)return;
  const anchor=pointerX===undefined?(keys+el.clientWidth)/2:Math.max(keys,Math.min(el.clientWidth,pointerX-el.getBoundingClientRect().left));
  const scale=pendingZoom.current?.quarter??quarter,left=pendingZoom.current?.left??el.scrollLeft;
  setTimeScale(scale*factor,anchor,(left+anchor-keys)/scale);
 }
 const wheel=useEffectEvent((e:WheelEvent)=>{
  const el=scroll.current;
  if(!el||gesture.current||pan.current||stroke.current||rulerDrag.current||!(e.target instanceof Element))return;
  const onRuler=!!e.target.closest('.piano-ruler');
  if(!onRuler&&!e.ctrlKey&&!e.metaKey)return;
  const horizontal=Math.abs(e.deltaX)>Math.abs(e.deltaY);
  const delta=(horizontal?e.deltaX:e.deltaY)*(e.deltaMode===1?16:e.deltaMode===2?el.clientWidth:1);
  e.preventDefault();
  if(horizontal||e.shiftKey)el.scrollLeft+=delta;
  else zoomTime(Math.exp(-delta*.004),e.clientX);
 });
 useEffect(()=>{
  const el=scroll.current;if(!el)return;
  const handle=(event:WheelEvent)=>wheel(event);
  el.addEventListener('wheel',handle,{passive:false});
  return ()=>el.removeEventListener('wheel',handle);
 },[]);
 function rulerDown(e:ReactPointerEvent<HTMLDivElement>){
  const el=scroll.current;if(!el||e.button!==0||rulerDrag.current||gesture.current)return;
  e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  const anchor=e.clientX-el.getBoundingClientRect().left;
  rulerDrag.current={id:e.pointerId,x:e.clientX,y:e.clientY,anchor,quarter,beat:(el.scrollLeft+anchor-keys)/quarter,moved:false};
 }
 function rulerMove(e:ReactPointerEvent<HTMLDivElement>){
  const drag=rulerDrag.current;if(!drag||drag.id!==e.pointerId)return;
  const dy=e.clientY-drag.y;
  if(!drag.moved&&Math.abs(dy)<4)return;
  drag.moved=true;setTimeScale(drag.quarter*Math.exp(dy*.012),drag.anchor,drag.beat);
 }
 function rulerUp(e:ReactPointerEvent<HTMLDivElement>){
  const drag=rulerDrag.current;if(!drag||drag.id!==e.pointerId)return;
  rulerDrag.current=null;
  if(!blocked&&!drag.moved&&Math.abs(e.clientX-drag.x)<4)onSeek?.(Math.min(project.timing.end_tick,snapTick(drag.beat*ppqn,step)));
 }
 function zoomPitch(factor:number){const el=scroll.current;if(!el)return;const next=Math.max(8,Math.min(28,Math.round(row*factor))),center=(el.scrollTop+el.clientHeight/2-ruler)/row;setRow(next);requestAnimationFrame(()=>{el.scrollTop=Math.max(0,ruler+center*next-el.clientHeight/2);updateView();});}
 function focusNotes(){const el=scroll.current;if(!el)return;const notes=chosen.length?chosen:snapshot.notes,first=notes.reduce((v,n)=>Math.min(v,n.tick),notes[0]?.tick??0),last=notes.reduce((v,n)=>Math.max(v,n.end),first+ppqn*4),pitch=notes.reduce((sum,n)=>sum+n.pitch,0)/(notes.length||1)||60;
  const next=Math.max(.25,Math.min(256,(el.clientWidth-keys-48)/Math.max(4,(last-first)/ppqn)));setQuarter(next);requestAnimationFrame(()=>{el.scrollLeft=Math.max(0,first/ppqn*next-24);el.scrollTop=Math.max(0,ruler+(127-pitch)*row-el.clientHeight/2);updateView();});
 }
 function duplicate(){if(!chosen.length)return;const delta=Math.max(step,Math.ceil((Math.max(...chosen.map(n=>n.end))-Math.min(...chosen.map(n=>n.tick)))/step)*step);void commit({add:chosen.map(n=>({tick:n.tick+delta,end:n.end+delta,pitch:n.pitch,velocity:n.velocity}))});}
 const visible=snapshot.notes.filter(n=>keys+n.end/ppqn*quarter>=view.left+keys&&keys+n.tick/ppqn*quarter<=view.left+view.width&&ruler+(128-n.pitch)*row>=view.top&&ruler+(127-n.pitch)*row<=view.top+view.height);
 const meters=useMemo(()=>meterMap(project),[project.global_events,ppqn]);
 const leftTick=Math.max(0,(view.left-keys)/quarter*ppqn),rightTick=(view.left+view.width)/quarter*ppqn;
 const marks=meters.flatMap((m,i)=>{const end=Math.min(extent,meters[i+1]?.tick??extent,rightTick),stride=Math.max(1,Math.ceil(48/(m.ticksPerBar/ppqn*quarter))),start=Math.max(0,Math.floor((leftTick-m.tick)/m.ticksPerBar/stride)*stride),items=[];for(let bar=start;m.tick+bar*m.ticksPerBar<=end;bar+=stride)items.push({tick:m.tick+bar*m.ticksPerBar,label:String(m.bar+bar),meter:`${m.numerator}/${m.denominator}`});return items;});
 return <div ref={root} className="piano-roll" tabIndex={0} aria-label={zh?'MIDI 音符编辑器':'MIDI note editor'} onKeyDown={e=>{
  if((e.target as HTMLElement).closest('input,select,[popover]')||blocked)return;
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.repeat&&['b','h','v'].includes(e.key.toLowerCase())){
   e.preventDefault();e.stopPropagation();choose(e.key.toLowerCase()==='b'&&tool!=='draw'?'draw':e.key.toLowerCase()==='h'?'hand':'select');return;
  }
  if(e.key==='Escape'){e.stopPropagation();cancel();setSelected([]);return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();if(snapshot.notes.length<=512)setSelected(snapshot.notes.map(n=>n.id));else setError(zh?'音符超过 512 个，请框选一段':'More than 512 notes; select a region');return;}
  if(!chosen.length)return;
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();void commit({remove:selected});}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();e.stopPropagation();duplicate();}
  else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();void commit({update:moveNotes(chosen,e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?(e.shiftKey?12:1):e.key==='ArrowDown'?-(e.shiftKey?12:1):0)});}
 }}>
  <div className="piano-toolbar">
   <span className="piano-track">CH {index+1} · {track.name}</span>
   {clip&&<button data-clip-id={clip.id} onClick={onExitClip} title={zh?'返回整轨音符':'Show all track notes'}>{clip.name} · {referenceCount??clipReferenceCount(project,clip.id)} {zh?'处引用':'refs'} ×</button>}
   <button aria-haspopup="menu" title={zh?'编辑工具（右键）':'Editing tool (right-click)'} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();showMenu(r.left,r.bottom);}}>{labels[tool]} ▾</button>
   <div ref={menu} popover="auto" role="menu" className="piano-tool-menu">{(['select','draw','hand'] as const).map((id,i)=><button key={id} role="menuitemradio" aria-checked={tool===id} onClick={()=>choose(id)}>{labels[id]} <kbd>{['V','B','H'][i]}</kbd></button>)}</div>
   <label>{zh?'吸附':'Grid'} <select aria-label="Note grid" value={division} onChange={e=>setDivision(Number(e.target.value))}>{[4,8,16,32,0].map(d=><option key={d} value={d}>{d?`1/${d}`:zh?'关闭':'Off'}</option>)}</select></label>
   <button aria-label="Zoom time out" onClick={()=>zoomTime(.5)}>−</button><span>{zh?'时间':'Time'}</span><button aria-label="Zoom time in" onClick={()=>zoomTime(2)}>＋</button>
   <button aria-label="Zoom pitch out" onClick={()=>zoomPitch(.8)}>−</button><span>{zh?'音高':'Pitch'}</span><button aria-label="Zoom pitch in" onClick={()=>zoomPitch(1.25)}>＋</button>
   <button onClick={focusNotes} aria-label="Fit notes">{zh?'定位音符':'Fit notes'}</button>
   <label>{zh?'力度':'Velocity'} <input aria-label="Note velocity" type="number" min={1} max={127} value={velocity} onChange={e=>setVelocity(Math.max(1,Math.min(127,Number(e.target.value)||1)))}/></label>
   <button disabled={blocked||!chosen.length} onClick={()=>void commit({update:chosen.map(n=>({id:n.id,velocity}))})}>{zh?'应用':'Apply'}</button>
   <button aria-label="Duplicate notes" disabled={blocked||!chosen.length} onClick={duplicate}>{zh?'复制':'Duplicate'}</button>
   <button aria-label="Delete notes" disabled={blocked||!chosen.length} onClick={()=>void commit({remove:selected})}>{zh?'删除':'Delete'}</button>
  </div>
  <div ref={scroll} className="piano-scroll" data-tool={tool} onContextMenu={e=>{e.preventDefault();if(!blocked)showMenu(e.clientX,e.clientY);}} onPointerDownCapture={toolDown} onScroll={updateView} onPointerDown={backgroundDown} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onDoubleClick={e=>{
   if(blocked||tool!=='select'||(e.target as HTMLElement).closest('button,.piano-header,.piano-keys'))return;
   const p=coordinates(e.clientX,e.clientY);if(p.x<keys||p.y<ruler)return;const n=pointToNote(p.x,p.y,keys,ruler,row,quarter,ppqn),tick=snapTick(n.tick,step);
   if(localClip&&tick>=localClip.length)return;
   void commit({add:[{tick,end:Math.min(tick+(division?step:ppqn),localClip?.length??Infinity),pitch:n.pitch,velocity}]});
  }}>
   <div ref={surface} className="piano-surface" data-quarter-width={quarter} data-row-height={row} data-ppqn={ppqn} style={{width,height}}>
    <div className="piano-grid" style={{left:keys,top:ruler,width:width-keys,height:height-ruler,backgroundSize:`${Math.max(4,step/ppqn*quarter)}px ${row}px`}}/>
    {Array.from({length:128},(_,i)=>{const pitch=127-i;return <div key={pitch} className={`piano-row ${[1,3,6,8,10].includes(pitch%12)?'black':''}`} style={{top:ruler+i*row,left:keys,width:width-keys,height:row}}/>;})}
    {marks.map(m=><div className="piano-bar-line" key={m.tick} style={{left:keys+m.tick/ppqn*quarter,top:ruler,height:height-ruler}}/>)}
    <div className="piano-header" style={{height:ruler}}>
    <div className="piano-ruler" style={{top:0,height:ruler,left:keys,width:width-keys}} title={zh?'滚轮或上下拖动缩放时间，Shift＋滚轮平移':'Scroll or drag vertically to zoom time; Shift + scroll to pan'} onPointerDown={rulerDown} onPointerMove={rulerMove} onPointerUp={rulerUp} onPointerCancel={()=>{rulerDrag.current=null;}} onLostPointerCapture={()=>{rulerDrag.current=null;}}>{marks.map(m=><span key={m.tick} title={m.meter} style={{left:m.tick/ppqn*quarter}}>{m.label}</span>)}</div>
    <div className="piano-corner" style={{width:keys,height:ruler}}>MIDI</div>
    </div>
    <div className="piano-keys" style={{width:keys,height:height-ruler}}>{Array.from({length:128},(_,i)=>{const pitch=127-i;return <span key={pitch} className={[1,3,6,8,10].includes(pitch%12)?'black':''} style={{top:i*row,height:row}}>{pitchName(pitch)}</span>;})}</div>

    {visible.map(n=><button key={n.id} type="button" className={`piano-note ${selected.includes(n.id)?'selected':''} ${preview?.some(p=>p.id===n.id)?'dragging':''}`} aria-label={`${pitchName(n.pitch)} · ${positionInMeter(meters,n.tick).bar}:${positionInMeter(meters,n.tick).beat} · velocity ${n.velocity}`} aria-pressed={selected.includes(n.id)} data-note-id={n.id} data-pitch={n.pitch} data-tick={n.tick} data-end={n.end} data-velocity={n.velocity} title={`${pitchName(n.pitch)} · ${n.tick}–${n.end} · ${n.velocity}`} style={{left:keys+n.tick/ppqn*quarter,top:ruler+(127-n.pitch)*row+1,width:Math.max(5,(n.end-n.tick)/ppqn*quarter),height:row-2,opacity:.45+n.velocity/127*.55}} onPointerDown={e=>noteDown(e,n)}><span>{pitchName(n.pitch)}</span><span className="piano-resize" aria-hidden="true" onPointerDown={e=>noteDown(e,n,true)}/></button>)}
    {preview?.map(n=><div key={n.id} className="piano-ghost" style={{left:keys+n.tick/ppqn*quarter,top:ruler+(127-n.pitch)*row+1,width:Math.max(5,(n.end-n.tick)/ppqn*quarter),height:row-2}}/>)}
    {box&&<div className="piano-marquee" style={{left:box.x,top:box.y,width:box.w,height:box.h}}/>}
    <div className="piano-playhead" style={{left:keys+playhead/ppqn*quarter,top:ruler,height:height-ruler}}/>
   </div>
  </div>
  <div className="piano-help"><span>{waiting?(zh?'正在应用…':'Applying…'):tool==='hand'?(zh?'拖动以平移卷帘':'Drag to pan the piano roll'):tool==='draw'?(zh?'单击或拖动画音符 · 点音符擦除':'Click or drag to draw · Click a note to erase'):zh?`${snapshot.notes.length} 音符 · 已选 ${selected.length} · 双击添加 · 拖动移动 / 拉右边缘改时长 · Shift 多选 · Delete 删除`:`${snapshot.notes.length} notes · ${selected.length} selected · Double-click to add · Drag to move / resize right edge · Shift-select · Delete`}</span>{error&&<span role="alert">{error}</span>}</div>
 </div>;
}
