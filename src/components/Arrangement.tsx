import {autoDivision,gridTick,gridMarks,type Grid,type Division} from '../model/arrangement-grid';
import {TimelineViewContext,wholeTimeline,panTimeline,zoomTimeline,type TimelineView} from './timeline-view';
import {meterPercent,type StereoLevel} from '../audio/stereo-meter';
import {barGrid,meterMap,musicalLabel} from '../model/meter';
import {secondsToTick,type AutomationLane} from '../model/automation';
import {memo,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type PointerEvent,type KeyboardEvent} from 'react';
import {indexNoteOverview,overviewPaths,overviewWindow} from '../model/note-overview';
import {isTempoTarget,tempoMap,tempoSeconds,type Project,type Track} from '../model/project';
import type {Locale} from '../model/descriptions';
function timeLabel(seconds:number){const ms=Math.round(seconds*1000);return `${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000)%60<10?'0':''}${Math.floor(ms/1000)%60}.${(ms%1000).toString().padStart(3,'0')}`;}
const ArrangementPlayhead=memo(function ArrangementPlayhead({view,duration,stoppedPosition,readPosition}:{view:TimelineView;duration:number;stoppedPosition:number|null;readPosition:()=>number}){
 const marker=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const el=marker.current;if(!el)return;
  let frame=0;
  function draw(){
   const seconds=stoppedPosition??readPosition();
   const fraction=(seconds/(duration||1)-view.start)/view.span;
   el!.style.transform=`translateX(${fraction*100}%)`;
   if(stoppedPosition===null)frame=requestAnimationFrame(draw);
  }
  draw();return()=>cancelAnimationFrame(frame);
 },[view,duration,stoppedPosition,readPosition]);
 return <div ref={marker} className="arrangement-playhead"><i className="playhead"/><i className="timeline-current-head"/></div>;
});
const NoteLane=memo(function NoteLane({events,end,duration,toSeconds,left,right}:{events:Track['events'];end:number;duration:number;toSeconds:(tick:number)=>number;left:number;right:number}){
 const svg=useRef<SVGSVGElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{
  const el=svg.current;if(!el)return;
  // Observe the untransformed lane; its child SVG scales with the time ruler.
  const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{root:el.closest('.track-list'),rootMargin:'80px 0px'});
  observer.observe(el.parentElement!);return ()=>observer.disconnect();
 },[]);
 const getIndex=useMemo(()=>{
  let index:ReturnType<typeof indexNoteOverview>;
  return ()=>index??=indexNoteOverview(events,end,duration,toSeconds);
 },[events,end,duration,toSeconds]);
 const index=visible?getIndex():null;
 const paths=useMemo(()=>index?overviewPaths(index,left,right):[],[index,left,right]);
 return <svg ref={svg} className="note-lane" viewBox="0 0 1000 42" preserveAspectRatio="none" aria-label={index?`${index.notes.length} notes`:'MIDI'}>
  {paths.map(p=><path key={p.velocity} d={p.d} opacity={.35+p.velocity/200}/>)}
 </svg>;
});
const ClipPlacements=memo(function ClipPlacements({refs,clips,focusedRef,duration,view,toSeconds}:{
 refs:Track['clipRefs'];clips:ReadonlyMap<string,NonNullable<Project['clips']>[number]>;focusedRef?:string;duration:number;view:TimelineView;toSeconds:(tick:number)=>number;
}){
 return refs?.map(ref=>{
    const clip=clips.get(ref.clipId);if(!clip)return null;
    const start=toSeconds(ref.start),end=toSeconds(ref.start+clip.length);
    return <span key={ref.id} className={'clip-placement'+(focusedRef===ref.id?' focused':'')} data-clip-ref={ref.id} data-clip-id={clip.id} title={clip.name} style={{left:(start/(duration||1)-view.start)/view.span*100+'%',width:(end-start)/(duration||1)/view.span*100+'%'}}>{clip.name}</span>;
   })??null;
});
const EnvelopePreview=memo(function EnvelopePreview({lane,duration,toSeconds}:{lane:AutomationLane;duration:number;toSeconds:(tick:number)=>number}){
 if(!lane.points.length)return null;
 const y=(value:number)=>1+40*(1-value);
 let path='M 0 '+y(lane.points[0].value);
 for(const p of lane.points){
  const x=1000*toSeconds(p.tick)/(duration||1);
  path+=lane.interpolation==='step'?` H ${x} V ${y(p.value)}`:` L ${x} ${y(p.value)}`;
 }
 return <svg className="envelope-preview" aria-label={lane.label} viewBox="0 0 1000 42" preserveAspectRatio="none"><title>{lane.label}</title><path d={path+' H 1000'}/></svg>;
});
type Range={start:number;end:number};
export function Arrangement({playing,readPosition,armed,onArm,grid,onAuto,clipMenu,focusedRef,onFocusClip,automationChoice,onFold,loop,range,onRange,isExpanded,automationAt,renderTrackMix,renderBusMix,onAdd,onTrackMenu,project,selected,onSelect,onChange,position,duration,levels,onSeek,seekingDisabled,locale}:{playing:boolean;readPosition:()=>number;armed:string|null;onArm:(id:string)=>void;grid:Grid;onAuto:(value:Division)=>void;clipMenu:React.ReactNode;focusedRef?:string;onFocusClip:(index:number,id?:string)=>void;automationChoice:(id:string)=>string|undefined;onFold:(i:number)=>void;loop:boolean;range:Range|null;onRange:(range:Range|null)=>void;isExpanded:(index:number)=>boolean;automationAt:(index:number)=>React.ReactNode;renderTrackMix:(index:number)=>React.ReactNode;renderBusMix:()=>React.ReactNode;onAdd:()=>void;onTrackMenu:(index:number)=>void;project:Project;selected:number;onSelect:(n:number)=>void;onChange:(n:number,patch:Partial<Track>)=>void;position:number;duration:number;levels:StereoLevel[];onSeek:(seconds:number)=>void;seekingDisabled:boolean;locale:Locale}){
 const clipsById=useMemo(()=>new Map(project.clips?.map(c=>[c.id,c])),[project.clips]);
 const [rulerWidth,setRulerWidth]=useState(800);
 const [trackHeight,setTrackHeight]=useState(32);
 const [hover,setHover]=useState<number|null>(null),[scrollbar,setScrollbar]=useState(0);const list=useRef<HTMLDivElement>(null);
 const tempoLane=project.automation?.find(l=>isTempoTarget(l)&&l.mode==='read'&&l.points.length);
 const toSeconds=useMemo(()=>{const points=tempoMap(project);return (tick:number)=>{let point=points[0];for(const p of points){if(p.tick>tick)break;point=p;}return point.seconds+tempoSeconds(point,tick-point.tick,project.timing.ppqn);};},[project.timing.ppqn,project.timing.default_tempo_us_per_quarter,project.timing.bpm,project.global_events,tempoLane]);
 useEffect(()=>{const el=list.current;if(!el)return;const resize=new ResizeObserver(()=>{setScrollbar(el.offsetWidth-el.clientWidth);if(ruler.current?.clientWidth)setRulerWidth(ruler.current.clientWidth);});resize.observe(el);return()=>resize.disconnect();},[]);
 const [view,setView]=useState(wholeTimeline);
 const noteWindow=overviewWindow(view.start,view.span);
 const ruler=useRef<HTMLDivElement>(null);
 useEffect(()=>{setView(wholeTimeline);setHover(null);},[project.title]);
 useEffect(()=>{
  const el=ruler.current,tracks=list.current;
  if(!el||!tracks)return;
  function wheel(e:WheelEvent){
   if(drag.current)return;
   const onRuler=e.currentTarget===el;
   if(!onRuler&&!(e.target instanceof Element&&e.target.closest('.lane,.automation-canvas')))return;
   const rect=el!.getBoundingClientRect();
   const scale=e.deltaMode===1?16:e.deltaMode===2?rect.width:1;
   const horizontal=Math.abs(e.deltaX)>Math.abs(e.deltaY);
   const pan=e.shiftKey||horizontal;
   if(!pan&&!onRuler&&!e.metaKey&&!e.ctrlKey)return;
   e.preventDefault();
   const anchor=Math.max(0,Math.min(1,(e.clientX-rect.left)/Math.max(1,rect.width)));
   const delta=(horizontal?e.deltaX:e.deltaY)*scale;
   setHover(null);
   setView(current=>pan?panTimeline(current,delta/Math.max(1,rect.width)*current.span)
    :zoomTimeline(current,anchor,Math.exp(delta*.004)));
  }
  el.addEventListener('wheel',wheel,{passive:false});
  tracks.addEventListener('wheel',wheel,{passive:false});
  return()=>{el.removeEventListener('wheel',wheel);tracks.removeEventListener('wheel',wheel);};
 },[]);
 const fraction=(x:number,el:HTMLElement)=>{const rect=el.getBoundingClientRect();return Math.max(0,Math.min(1,(x-rect.left)/Math.max(1,rect.width)));};
 const at=(x:number,el:HTMLElement)=>(view.start+fraction(x,el)*view.span)*duration;
 function move(e:PointerEvent<HTMLElement>){if(e.pointerType!=='touch')setHover(at(e.clientX,e.currentTarget));}
 function keyboard(e:KeyboardEvent<HTMLElement>){let next:number;if(e.key==='Home')next=0;else if(e.key==='End')next=duration;else if(e.key==='ArrowLeft'||e.key==='ArrowRight')next=position+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?10:1);else return;e.preventDefault();if(!seekingDisabled)onSeek(Math.max(0,Math.min(duration,next)));}
 const bars=useMemo(()=>barGrid(project,12/view.span).filter(mark=>{const t=toSeconds(mark.tick);return t>=duration*view.start&&t<=duration*(view.start+view.span);}),[project.timing,project.global_events,toSeconds,view,duration]);
 const [preview,setPreview]=useState<Range|null>(null);
 const drag=useRef<{x:number;y:number;view:TimelineView;anchor:number;tick:number;mode:'zoom'|'new'|'start'|'end'|'move';moved:boolean}|null>(null);
 const shown=preview??range;
 const whole={start:0,end:project.timing.end_tick};
 const brace=shown??whole;
 const meters=useMemo(()=>meterMap(project),[project.global_events,project.timing.ppqn]);
 const gridView=useMemo(()=>{
  const start=secondsToTick(project,view.start*duration),end=secondsToTick(project,(view.start+view.span)*duration);
  const meter=meters.reduce((last,m)=>m.tick<=start?m:last,meters[0]);
  const auto=autoDivision((end-start)/Math.max(1,rulerWidth),project.timing.ppqn,meter,grid.triplet);
  const unit=grid.mode==='auto'?auto:grid.mode;
  return {auto,unit,marks:gridMarks(meters,project.timing.ppqn,start,end,unit,grid.triplet,rulerWidth)};
 },[meters,project.timing,project.global_events,project.automation,view,duration,rulerWidth,grid]);
 useEffect(()=>onAuto(gridView.auto),[gridView.auto,onAuto]);
 function snapped(tick:number,bypass:boolean){return gridTick(meters,project.timing.ppqn,tick,bypass?'off':gridView.unit,grid.triplet,whole.end);}
 function bypass(e:PointerEvent){return /Mac|iPhone|iPad/.test(navigator.platform)?e.metaKey:e.altKey;}
 function beginDrag(e:PointerEvent<HTMLDivElement>){
  if(e.button!==0||seekingDisabled)return;
  const el=e.currentTarget,seconds=at(e.clientX,el);
  const part=(e.target as HTMLElement).closest<HTMLElement>('[data-brace]')?.dataset.brace;
  const mode=!e.shiftKey&&(part==='start'||part==='end'||part==='move')?part:'new';
  el.focus();el.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,view,anchor:fraction(e.clientX,el),tick:secondsToTick(project,seconds),mode,moved:false};
 }
 function dragValue(e:PointerEvent<HTMLDivElement>){
  const d=drag.current;if(!d)return null;
  const dx=Math.abs(e.clientX-d.x),dy=e.clientY-d.y;
  if(!d.moved){
   if(d.mode==='new'&&Math.abs(dy)>dx&&Math.abs(dy)>=4)d.mode='zoom';
   else if(dx<4)return null;
  }
  if(d.mode==='zoom'){
   d.moved=true;setHover(null);setView(zoomTimeline(d.view,d.anchor,Math.exp(-dy*.012)));return null;
  }
  d.moved=true;
  const tick=secondsToTick(project,at(e.clientX,e.currentTarget)),free=bypass(e),point=snapped(tick,free),original=range??whole;
  if(d.mode==='move'){
   const length=original.end-original.start,start=Math.min(whole.end-length,snapped(original.start+tick-d.tick,free));
   return {start,end:start+length};
  }
  if(d.mode==='start')return point<original.end?{start:point,end:original.end}:original;
  if(d.mode==='end')return point>original.start?{start:original.start,end:point}:original;
  const anchor=snapped(d.tick,free);
  return point===anchor?null:{start:Math.min(anchor,point),end:Math.max(anchor,point)};

 }
 function finishDrag(e:PointerEvent<HTMLDivElement>){
  if(!drag.current)return;
  const value=dragValue(e);const isSeek=drag.current.mode==='new'&&!drag.current.moved;drag.current=null;setPreview(null);
  if(value)onRange(value);else if(isSeek)onSeek(at(e.clientX,e.currentTarget));
 }
 const location=(seconds:number)=>`${musicalLabel(project,secondsToTick(project,seconds))} · ${timeLabel(seconds)}`;
 const percent=(value:number)=>`${(value/(duration||1)-view.start)/view.span*100}%`;
 return <TimelineViewContext.Provider value={view}><div className="arrangement" style={{'--time-scale':1/view.span,'--time-offset':(-view.start*100)+'%','--track-height':`${trackHeight}px`} as CSSProperties} onPointerLeave={()=>setHover(null)}>
  <div className="arrangement-toolbar"><span>{locale==='zh-CN'?'轨道高度':'Track height'}</span><button aria-label="Decrease track height" disabled={trackHeight<=24} onClick={()=>setTrackHeight(h=>Math.max(24,h-8))}>−</button><input aria-label="Track height" type="range" min="24" max="96" step="8" value={trackHeight} onChange={e=>setTrackHeight(Number(e.target.value))}/><button aria-label="Increase track height" disabled={trackHeight>=96} onClick={()=>setTrackHeight(h=>Math.min(96,h+8))}>＋</button><output>{trackHeight}px</output>{clipMenu}{shown&&<><span>{locale==='zh-CN'?'选区':'Range'} {musicalLabel(project,shown.start)}–{musicalLabel(project,shown.end)}</span><button aria-label="Clear time selection" onClick={()=>onRange(null)}>×</button></>}</div>
  <div className="ruler"><span onPointerEnter={()=>setHover(null)}>{locale==='zh-CN'?'小节 / 轨道':'BARS / TRACKS'} · {project.tracks.length}</span><div className="ruler-scroll-space" style={{paddingRight:scrollbar}}><div className="timeline-ruler" ref={ruler} role="slider" tabIndex={0} aria-label={locale==='zh-CN'?'时间线位置':'Timeline position'} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={position} aria-valuetext={location(position)} aria-disabled={seekingDisabled} onKeyDown={keyboard} title={locale==='zh-CN'?'滚轮或上下拖动缩放，左右拖动选择时间范围，Shift + 滚轮平移':'Wheel or drag vertically to zoom, drag horizontally to select, Shift-wheel to pan'} onPointerDown={beginDrag} onPointerMove={e=>{move(e);if(drag.current)setPreview(dragValue(e));}} onPointerUp={finishDrag} onLostPointerCapture={()=>{drag.current=null;setPreview(null);}}>
   <div className={'loop-brace'+(loop?' enabled':'')} data-brace="move" title={locale==='zh-CN'?'移动循环范围':'Move loop range'} style={{left:percent(toSeconds(brace.start)),width:(toSeconds(brace.end)-toSeconds(brace.start))/(duration||1)/view.span*100+"%"}}>
    <i data-brace="start" title={locale==='zh-CN'?'拖动循环起点':'Drag loop start'}/>
    <i data-brace="end" title={locale==='zh-CN'?'拖动循环终点':'Drag loop end'}/>
   </div>
   {bars.map(mark=><span className="bar-ruler-mark" key={mark.tick} style={{left:percent(toSeconds(mark.tick))}}>{mark.bar}{mark.change?` · ${mark.meter}`:''}</span>)}</div></div></div>
  <div className="track-list" ref={list} tabIndex={0} role="region" aria-label="Arrangement tracks">{project.tracks.map((t,i)=>{
   const expanded=isExpanded(i);
   const automation=expanded?automationAt(i):null;
   const lanes=project.automation?.filter(l=>l.trackId===t.id&&l.points.length);
   const previewLane=lanes?.find(l=>JSON.stringify([l.device,l.address])===automationChoice(t.id))??lanes?.find(l=>l.mode==='read')??lanes?.[0];
   return <div key={t.id} className={`track ${expanded?'unfolded':''} ${automation?'has-envelope':''} ${selected===i?'selected':''}`} data-track={i} onContextMenu={e=>{e.preventDefault();onTrackMenu(i);}}>
   <div className="track-controls" onPointerEnter={()=>setHover(null)}><button className="track-fold" aria-label={`${locale==='zh-CN'?'展开或收起轨道':'Expand or collapse track'} · ${t.name}`} aria-expanded={expanded} onClick={()=>onFold(i)}>{expanded?'▾':'▸'}</button><button className="track-name" title={`Channel ${t.midi_channel} · ${t.annotation?.instrument??t.name}`} onClick={()=>onSelect(i)}><span className="track-number">{String(i+1).padStart(2,'0')}</span><span className="track-label">{t.name}</span></button>
    <button className="track-switch solo" aria-label={`Solo ${t.name}`} aria-pressed={t.solo} title={locale==='zh-CN'?'独奏':'Solo'} onClick={()=>onChange(i,{solo:!t.solo})}>S</button>
    <button className="track-switch mute" aria-label={`Mute ${t.name}`} aria-pressed={t.mute} title={locale==='zh-CN'?'静音':'Mute'} onClick={()=>onChange(i,{mute:!t.mute})}>M</button>
    <button className="track-arm" aria-pressed={armed===t.id} onClick={()=>onArm(t.id)} aria-label={`Arm ${t.name} for MIDI recording`} title={locale==='zh-CN'?'MIDI 录音准备':'Arm for MIDI recording'}>●</button>
    <div className="track-stereo" role="img" aria-label={`Stereo level · ${t.name}`} title="L / R · −60…0 dBFS RMS">{[0,1].map(ch=><span key={ch}><i style={{height:meterPercent(levels[i]?.[ch]??0)+'%'}}/></span>)}</div>
   </div>
   <button className="lane" aria-label={`Select ${t.name}`} onPointerMove={move} onKeyDown={keyboard} onClick={e=>{const id=(e.target as Element).closest<HTMLElement>('[data-clip-ref]')?.dataset.clipRef;onFocusClip(i,id);if(e.detail>0&&!seekingDisabled)onSeek(at(e.clientX,e.currentTarget));}}><NoteLane left={noteWindow.left} right={noteWindow.right} events={t.events} end={project.timing.end_tick} duration={duration} toSeconds={toSeconds}/><ClipPlacements refs={t.clipRefs} clips={clipsById} focusedRef={focusedRef} duration={duration} view={view} toSeconds={toSeconds}/>{previewLane&&!automation&&<EnvelopePreview lane={previewLane} duration={duration} toSeconds={toSeconds}/>}</button>
   {expanded&&<div className="arrangement-track-mix" data-track-mix={i} onPointerEnter={()=>setHover(null)}>{renderTrackMix(i)}</div>}
   {automation&&<div className="track-envelope" onPointerEnter={()=>setHover(null)}>{automation}</div>}
  </div>;})}
   <button className="add-track" onPointerEnter={()=>setHover(null)} onClick={onAdd}>{locale==='zh-CN'?'＋ 添加轨道':'＋ Add track'}</button>
   <div className="arrangement-buses" onPointerEnter={()=>setHover(null)}>{renderBusMix()}</div>
  </div>
  <div className="timeline-overlay" style={{right:scrollbar}} aria-hidden="true">{shown&&<div className={loop?"time-selection enabled":"time-selection"} style={{left:percent(toSeconds(shown.start)),width:(toSeconds(shown.end)-toSeconds(shown.start))/(duration||1)/view.span*100+"%"}}/>}<div className="bar-grid">{gridView.marks.map(tick=><i key={tick} style={{left:percent(toSeconds(tick))}}/>)}</div><ArrangementPlayhead view={view} duration={duration} stoppedPosition={playing?null:position} readPosition={readPosition}/>{hover!==null&&<div className="timeline-hover" style={{left:percent(hover)}}><span className={hover>duration*(view.start+view.span*.85)?'align-end':hover<duration*(view.start+view.span*.15)?'align-start':''}>{location(hover)}</span></div>}</div>
 </div></TimelineViewContext.Provider>;
}
