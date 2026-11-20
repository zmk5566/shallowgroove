import {TimelineViewContext} from './timeline-view';
import {musicalLabel} from '../model/meter';
import {useRef,useState,useContext,type PointerEvent} from 'react';
import {tickToSeconds,type Project} from '../model/project';
import {secondsToTick,physicalValue,normalize,normalizedValue,type AutomationLane,type AutomationPoint} from '../model/automation';
export type AutomationOption={key:string;lane:AutomationLane;current:number;valid:boolean;deviceLabel?:string};
export function AutomationEditor({project,timingProject=project,options,choice,onChoice,onChange,onDelete,overridden,onResume,onClose,zh}:{project:Project;timingProject?:Project;options:AutomationOption[];choice:string;onChoice:(key:string)=>void;onChange:(lane:AutomationLane)=>void;onDelete:(id:string)=>void;overridden:(id:string)=>boolean;onResume:(id:string)=>void;onClose:()=>void;zh:boolean}){
 const view=useContext(TimelineViewContext);
 const option=options.find(o=>o.key===choice)??options[0],lane=option?.lane;
 const [hover,setHover]=useState<AutomationPoint|null>(null);
 const [draft,setDraft]=useState<AutomationPoint[]|null>(null),[point,setPoint]=useState<number|null>(null);const svg=useRef<SVGSVGElement>(null),drag=useRef<{index:number;points:AutomationPoint[];pointer:number}|null>(null);
 if(!lane)return <div className="automation-empty">{zh?'点击播放初始化音频，再选择轨道或设备，以显示可自动化的参数。':'Click Play to initialize audio, then select a channel to show parameters.'}<button onClick={onClose}>×</button></div>;
 const points=draft??lane.points,duration=tickToSeconds(timingProject,timingProject.timing.end_tick)||1;
 const x=(tick:number)=>(tickToSeconds(timingProject,tick)/duration-view.start)/view.span*1000,y=(value:number)=>100-value*100;
 function at(e:PointerEvent<SVGSVGElement>){const r=svg.current!.getBoundingClientRect();return {tick:Math.round(secondsToTick(timingProject,(view.start+Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*view.span)*duration)),value:Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height))};}
 function commit(ps:AutomationPoint[]){const dedup=new Map<number,AutomationPoint>();for(const p of ps)dedup.set(p.tick,p);onChange({...lane!,points:[...dedup.values()].sort((a,b)=>a.tick-b.tick)});}
 function cancel(){drag.current=null;setDraft(null);}
 const groups=new Map<string,AutomationOption[]>();
 for(const entry of options){
  const entries=groups.get(entry.lane.device);
  if(entries)entries.push(entry);
  else groups.set(entry.lane.device,[entry]);
 }
 function choose(key:string){cancel();setPoint(null);setHover(null);onChoice(key);}
 const baselineY=y(normalize(lane,option.current));
 const path=points.map((p,i)=>`${i===0?'M':lane.interpolation==='step'?'H':'L'} ${x(p.tick)} ${i&&lane.interpolation==='step'?'V':''} ${y(p.value)}`).join(' ');
 return <div className={`automation-lane ${option.valid?'':'target-missing'}`}><div className="automation-controls"><strong>AUTOMATION</strong><select aria-label="Automation device" value={lane.device} onChange={e=>choose(groups.get(e.target.value)![0].key)}>
 {Array.from(groups,([device,entries],i)=><option key={device} value={device}>{device==='mixer'?(zh?'混音器':'Mixer'):device==='instrument'?(zh?'乐器':'Instrument'):entries.find(entry=>entry.deviceLabel)?.deviceLabel??(zh?`缺失设备 ${i+1}`:`Missing device ${i+1}`)}</option>)}
 </select>
 <select aria-label="Automation parameter" value={option.key} onChange={e=>choose(e.target.value)}>
 {groups.get(lane.device)!.map(o=><option key={o.key} value={o.key}>{o.lane.label}{!o.valid?(zh?'（目标缺失）':' (missing)'):''}</option>)}
 </select><div><button disabled={!option.valid} aria-pressed={lane.mode==='read'} title={zh?'播放时按这条曲线调整参数':'Follow this curve during playback'} onClick={()=>onChange({...lane,mode:lane.mode==='read'?'off':'read'})}>{zh?(lane.mode==='read'?'跟随曲线：开':'跟随曲线：关'):(lane.mode==='read'?'Follow curve: On':'Follow curve: Off')}</button><button aria-label="Clear automation" onClick={()=>{cancel();setPoint(null);onChange({...lane,points:[],mode:'off'});}}>{zh?'清除点':'Clear points'}</button><button aria-label="Delete automation" disabled={!project.automation?.some(l=>l.id===lane.id)} onClick={()=>{cancel();onDelete(lane.id);}}>{zh?'删除自动化':'Delete lane'}</button></div>{option.valid&&overridden(lane.id)&&<button onClick={()=>onResume(lane.id)}>{zh?'恢复自动化':'Resume automation'}</button>}{!option.valid&&<small>{zh?'效果器或参数已移除，曲线已保留。':'Effect or parameter missing. Curve retained.'}</small>}</div><div className="automation-canvas"><svg ref={svg} tabIndex={0} role="application" aria-label="Automation curve" viewBox="0 0 1000 100" preserveAspectRatio="none" onDoubleClick={e=>{if(!option.valid)return;const r=svg.current!.getBoundingClientRect(),p={tick:Math.round(secondsToTick(timingProject,(view.start+Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*view.span)*duration)),value:Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height))};commit([...lane.points,p]);}} onPointerDown={e=>{svg.current?.focus();const i=(e.target as Element).getAttribute('data-point');if(i===null||!option.valid)return;e.preventDefault();setPoint(+i);drag.current={index:+i,points:lane.points.map(p=>({...p})),pointer:e.pointerId};svg.current!.setPointerCapture(e.pointerId);}} onPointerLeave={()=>{if(!drag.current)setHover(null);}} onPointerMove={e=>{const d=drag.current;if(!d){const index=(e.target as Element).getAttribute('data-point');setHover(index!==null?points[+index]:at(e));return;}const p=at(e),left=d.points[d.index-1]?.tick??-1,right=d.points[d.index+1]?.tick??project.timing.end_tick+1;p.tick=Math.max(left+1,Math.min(right-1,p.tick));d.points[d.index]=p;setHover(p);setDraft([...d.points]);}} onPointerUp={()=>{if(drag.current)commit(drag.current.points);cancel();}} onPointerCancel={cancel} onKeyDown={e=>{if(e.key==='Escape'){cancel();e.preventDefault();}if((e.key==='Delete'||e.key==='Backspace')&&point!==null){e.preventDefault();commit(lane.points.filter((_,i)=>i!==point));setPoint(null);}}}>
 {[0,25,50,75,100].map(n=><line key={n} x1="0" x2="1000" y1={n} y2={n} className="automation-grid"/>)}
 {points.length===0&&<line x1="0" x2="1000" y1={baselineY} y2={baselineY} className="automation-line automation-baseline"/>}
 {points.length>0&&<><path d={`M 0 ${y(points[0].value)} L ${x(points[0].tick)} ${y(points[0].value)}`} className="automation-line"/><path d={path} className="automation-line"/><path d={`M ${x(points.at(-1)!.tick)} ${y(points.at(-1)!.value)} L 1000 ${y(points.at(-1)!.value)}`} className="automation-line"/></>}
 {points.map((p,i)=><circle key={i} data-point={i} cx={x(p.tick)} cy={y(p.value)} r="5" className={point===i?'selected':''}><title>{musicalLabel(project,p.tick)} · {p.tick} ticks · {physicalValue(lane,p.value).toFixed(2)}</title></circle>)}
 {hover&&<g className="automation-crosshair"><line x1={x(hover.tick)} x2={x(hover.tick)} y1="0" y2="100"/><line x1="0" x2="1000" y1={y(hover.value)} y2={y(hover.value)}/></g>}
 </svg>{hover&&<div className={`automation-hover-label ${x(hover.tick)>700?'align-end':''}`} style={{left:`${Math.max(0,Math.min(100,x(hover.tick)/10))}%`}}><strong>{musicalLabel(project,hover.tick)} · {new Date(tickToSeconds(project,hover.tick)*1000).toISOString().slice(14,23)} · {hover.tick} ticks</strong><span>{zh?'指针':'Pointer'} · {lane.label}: {physicalValue(lane,hover.value).toFixed(2)}{/cutoff|frequency|high cut/i.test(lane.label)?' Hz':''}</span>{normalizedValue({...lane,points},hover.tick)!==null&&<span>{zh?'曲线值':'Curve'}: {physicalValue(lane,normalizedValue({...lane,points},hover.tick)!).toFixed(2)}</span>}</div>}</div></div>;
}
