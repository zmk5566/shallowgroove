import {inspectChannel} from '../audio/inspect';
import {useEffect,useRef,type MouseEvent} from 'react';
import './arrangement-mixer.css';
import {parameterMenu,parameterEdited} from '../model/parameter-focus';
import type {AudioEngine} from '../audio/engine';
import type {ChannelTarget} from '../audio/effects';
import type {Project,Track} from '../model/project';
const db=(v:number)=>v<=0?'−∞ dB':`${(20*Math.log10(v)).toFixed(1)} dB`;
function Meter({value,label}:{value:number;label:string}){return <div className="channel-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={Math.min(1,value)}><i style={{height:`${Math.min(100,value*600)}%`}}/></div>;}
function InspectButton({engine,channel,name,zh,disabled}:{engine:AudioEngine;channel:ChannelTarget;name:string;zh:boolean;disabled:boolean}){
 const label=(zh?'检查通道输出':'Inspect channel output')+' · '+name;
 return <button type="button" className="channel-inspect" title={label} aria-label={label} disabled={disabled} onClick={()=>inspectChannel(engine,channel,name,zh)}>
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.3"/><path d="m10 10 4.2 4.2"/></svg>
 </button>;
}
type MixCommon={locale:string;project:Project;engine:AudioEngine;ready:boolean;busy:boolean;refresh:()=>void};
type TrackMixProps=MixCommon & {index:number;onChange:(index:number,patch:Partial<Track>)=>void;onShowAutomation:(address:string)=>void};
type BusKind='delay'|'reverb'|'master';
type BusMixProps=MixCommon & {kind:BusKind;selected:ChannelTarget;onSelect:(target:ChannelTarget)=>void;levels:number[];
 expanded:boolean;onFold:()=>void;onShowAutomation:(address:string)=>void};
type TrackAddress='gain'|'pan'|'send.delay'|'send.reverb';
function trackMix({project,engine,ready,onChange,refresh}:Pick<TrackMixProps,'project'|'engine'|'ready'|'onChange'|'refresh'>,index:number){
 const track=project.tracks[index],rack=ready?engine.effects?.tracks[index]:undefined;
 function value(address:TrackAddress){
  const base=address==='gain'?track.gain:address==='pan'?track.pan:rack?.amounts[address==='send.delay'?'delay':'reverb']??0;
  return engine.automationDisplay(track.id,'mixer',address,base);
 }
 function set(address:TrackAddress,v:number){
  if(address==='gain'||address==='pan')onChange(index,{[address]:v});
  else engine.effects!.setSend(index,address==='send.delay'?'delay':'reverb',v);
  parameterEdited({trackId:track.id,device:'mixer',address},v);
  if(address==='send.delay'||address==='send.reverb')refresh();
 }
 return {value,set};
}
function busMix({project,engine,ready,refresh,levels}:Pick<BusMixProps,'project'|'engine'|'ready'|'refresh'|'levels'>,kind:BusKind){
 const bus=ready?(kind==='master'?engine.effects?.master:engine.effects?.returns[kind]):undefined;
 const title=kind==='delay'?'A · Delay':kind==='reverb'?'B · Reverb':'Master',level=bus?.level??(kind==='master'?1:.65);
 const gain=engine.automationDisplay(kind,'mixer','gain',level);
 const meter=ready?(engine.native?levels[project.tracks.length+({delay:0,reverb:1,master:2}[kind])]??0:engine.effects?.meter(kind)??0):0;
 function set(gain:number,muted:boolean){if(kind==='master')engine.effects!.setMaster(gain,muted);else engine.effects!.setReturn(kind,gain,muted);refresh();}
 function setGain(value:number){set(value,bus?.muted??false);parameterEdited({trackId:kind,device:'mixer',address:'gain'},value);}
 return {title,gain,meter,muted:bus?.muted??false,effectCount:bus?.effects.length??0,setGain,toggleMute:()=>set(level,!bus?.muted)};
}
function showMixAutomation(e:MouseEvent,trackId:string,address:string,show:(address:string)=>void){
 if(e.shiftKey){parameterMenu(e,{trackId,device:'mixer',address});return;}
 e.preventDefault();e.stopPropagation();show(address);
}
const mixHelp=(zh:boolean)=>zh?'右键显示自动化，Shift + 右键打开参数菜单':'Right-click for automation, Shift + right-click for parameter menu';
export function ArrangementTrackMix(props:TrackMixProps){
 const {index,project,engine,locale,ready,busy,onShowAutomation}=props;
 const {value,set}=trackMix(props,index),track=project.tracks[index],zh=locale==='zh-CN';
 const knobDrag=useRef<{y:number;value:number;pointer:number}|null>(null);
 const controls=[
  {address:'gain',title:zh?'音量':'Vol',name:'volume',min:0,max:1.5},
  {address:'pan',title:zh?'声像':'Pan',name:'pan',min:-1,max:1},
  {address:'send.delay',title:'A · Delay',name:'delay send',min:0,max:1},
  {address:'send.reverb',title:'B · Reverb',name:'reverb send',min:0,max:1}
 ] as const;
 return <div className="arr-track-mix" data-channel={index}>{controls.map(({address,title,name,min,max})=>{
  const current=value(address);
  const reading=address==='gain'?db(current):address==='pan'?(current===0?'C':(current<0?'L':'R')+Math.round(Math.abs(current)*100)):Math.round(current*100)+'%';
  if(address==='send.delay'||address==='send.reverb')return <label className="arr-send" key={address} title={title+' · '+reading+' · '+mixHelp(zh)} onContextMenu={e=>showMixAutomation(e,track.id,address,onShowAutomation)}>
   {address==='send.delay'?'A':'B'}<span className="arr-dial"><i style={{transform:`rotate(${current*270-135}deg)`}}/>
    <input type="range" data-address={address} aria-label={`Channel ${index+1} ${name}`} aria-valuetext={reading} min={0} max={1} step={.01} disabled={!ready||busy} value={current}
     onChange={e=>set(address,e.target.valueAsNumber)} onPointerDown={e=>{
      if(e.button!==0||knobDrag.current)return;
      e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
      knobDrag.current={y:e.clientY,value:current,pointer:e.pointerId};
     }} onPointerMove={e=>{
      const drag=knobDrag.current;if(drag?.pointer!==e.pointerId)return;
      set(address,Math.max(0,Math.min(1,Math.round(drag.value*100+drag.y-e.clientY)/100)));
     }} onLostPointerCapture={()=>{knobDrag.current=null;}}/>
   </span></label>;
  return <label className="arr-track-fader" key={address} title={title+' · '+reading+' · '+mixHelp(zh)} onContextMenu={e=>showMixAutomation(e,track.id,address,onShowAutomation)}>
   <span>{title}</span><input type="range" aria-label={`Channel ${index+1} ${name}`} aria-valuetext={reading} data-address={address}
     min={min} max={max} step={.01} disabled={!ready||busy} value={current} onChange={e=>set(address,e.target.valueAsNumber)}/><output>{reading}</output>
  </label>;
 })}<InspectButton engine={engine} channel={index} name={track.name} zh={zh} disabled={!ready||busy}/></div>;
}
export function ArrangementBusMix(props:BusMixProps){
 const {kind,engine,locale,ready,busy,selected,onSelect,expanded,onFold,onShowAutomation}=props;
 const {title,gain,meter,muted,effectCount,setGain,toggleMute}=busMix(props,kind),zh=locale==='zh-CN';
 return <div className={'arr-bus-mix'+(selected===kind?' selected':'')} data-channel={kind}
   onPointerDownCapture={e=>{if(!(e.target as Element).closest('button'))onSelect(kind);}}
   onFocusCapture={e=>{if(!(e.target as Element).closest('button'))onSelect(kind);}}>
  <button data-action="fold" aria-expanded={expanded} aria-label={(zh?'展开或收起自动化':'Toggle automation')+' · '+title} onClick={onFold}>{expanded?'▾':'▸'}</button>
  <button data-action="select" aria-label={`Select ${kind} channel`} aria-pressed={selected===kind} onClick={()=>onSelect(kind)}>{title}</button>
  <button data-action="mute" aria-label={`Mute ${kind} channel`} aria-pressed={muted} disabled={!ready||busy} onClick={()=>{onSelect(kind);toggleMute();}}>M</button>
  <label className="arr-bus-fader" title={mixHelp(zh)} onContextMenu={e=>showMixAutomation(e,kind,'gain',onShowAutomation)}>
   <span>{zh?'音量':'Vol'}</span><input type="range" data-address="gain" aria-label={`${kind} channel volume`} aria-valuetext={db(gain)}
    min={0} max={1.5} step={.01} disabled={!ready||busy} value={gain} onChange={e=>setGain(e.target.valueAsNumber)}/>
  </label><output>{db(gain)}</output><Meter value={meter} label={`${kind} channel level`}/>
  <span>{effectCount} FX</span><InspectButton engine={engine} channel={kind} name={title} zh={zh} disabled={!ready||busy}/>
 </div>;
}
export function Mixer({locale,onAdd,onTrackMenu,project,engine,selected,onSelect,onChange,ready,busy,levels,refresh}:{locale:string;onAdd:()=>void;onTrackMenu:(index:number)=>void;project:Project;engine:AudioEngine;selected:ChannelTarget;onSelect:(t:ChannelTarget)=>void;onChange:(i:number,p:Partial<Track>)=>void;ready:boolean;busy:boolean;levels:number[];refresh:()=>void}){
 const scroll=useRef<HTMLDivElement>(null);
 useEffect(()=>{const el=scroll.current;if(!el)return;const wheel=(event:WheelEvent)=>{if(event.ctrlKey)return;const target=event.target instanceof Element?event.target:null,strip=target?.closest('.channel-strip');if(strip&&strip.scrollHeight>strip.clientHeight&&!target?.closest('.channel-heading')&&Math.abs(event.deltaY)>Math.abs(event.deltaX)&&!event.shiftKey)return;if(el.scrollWidth<=el.clientWidth)return;const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;if(!delta)return;event.preventDefault();el.scrollLeft+=delta*(event.deltaMode===1?16:event.deltaMode===2?el.clientWidth:1);};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
 function automation(e:React.MouseEvent,channel:ChannelTarget,address:string){parameterMenu(e,{trackId:typeof channel==='number'?project.tracks[channel].id:channel,device:'mixer',address});}

 return <section className="mixer" aria-label="Mixer"><div className="mixer-tracks" ref={scroll} tabIndex={0} role="region" aria-label="Mixer tracks" title={locale==='zh-CN'?'滚轮或触控板左右浏览轨道':'Scroll to browse mixer tracks'}>{project.tracks.map((t,i)=>{const {value,set}=trackMix({project,engine,ready,onChange,refresh},i);return <div className={`channel-strip ${selected===i?'selected':''}`} key={t.id} onContextMenu={e=>{e.preventDefault();onTrackMenu(i);}} data-channel={i} onPointerDownCapture={e=>{if(!(e.target as Element).closest('.channel-inspect'))onSelect(i);}} onFocusCapture={e=>{if(!(e.target as Element).closest('.channel-inspect'))onSelect(i);}}><div className="channel-heading"><button className="channel-title" aria-label={`Select channel ${i+1}`} aria-pressed={selected===i} title={t.name} onClick={()=>onSelect(i)}><b>{String(i+1).padStart(2,'0')}</b> {t.name}</button><InspectButton engine={engine} channel={i} name={t.name} zh={locale==='zh-CN'} disabled={!ready||busy}/></div><div className="channel-route">MIDI {t.midi_channel} → Master</div><fieldset disabled={!ready||busy} className="channel-sends">{(['delay','reverb'] as const).map((kind,n)=><label key={kind}><span>{n?'B':'A'}</span><input aria-label={`Channel ${i+1} ${kind} send`} type="range" min="0" max="1" step="0.01" onContextMenu={e=>automation(e,i,'send.'+kind)} value={value(`send.${kind}`)} onChange={e=>{set(`send.${kind}`,+e.target.value);}}/><output>{Math.round(value(`send.${kind}`)*100)}</output></label>)}</fieldset><label className="channel-pan">Pan<input aria-label={`Channel ${i+1} pan`} type="range" min="-1" max="1" step="0.01" onContextMenu={e=>automation(e,i,'pan')} value={value('pan')} onChange={e=>{set('pan',+e.target.value);}}/></label><div className="channel-fader"><input aria-label={`Channel ${i+1} volume`} type="range" min="0" max="1.5" step="0.01" onContextMenu={e=>automation(e,i,'gain')} value={value('gain')} onChange={e=>{set('gain',+e.target.value);}}/><Meter value={levels[i]??0} label={`Channel ${i+1} level`}/></div><output className="channel-db">{db(value('gain'))}</output><div className="channel-switches"><button aria-label={`Mute channel ${i+1}`} aria-pressed={t.mute} onClick={()=>onChange(i,{mute:!t.mute})}>M</button><button aria-label={`Solo channel ${i+1}`} aria-pressed={t.solo} onClick={()=>onChange(i,{solo:!t.solo})}>S</button></div></div>;})}<button className="add-track" onClick={onAdd}>{locale==='zh-CN'?'＋ 添加轨道':'＋ Add track'}</button></div>
 <div className="mixer-buses">{(['delay','reverb','master'] as const).map(kind=>{const {title,gain,meter,muted,effectCount,setGain,toggleMute}=busMix({project,engine,ready,refresh,levels},kind);return <div key={kind} data-channel={kind} onPointerDownCapture={e=>{if(!(e.target as Element).closest('.channel-inspect'))onSelect(kind);}} onFocusCapture={e=>{if(!(e.target as Element).closest('.channel-inspect'))onSelect(kind);}} className={`channel-strip bus-strip ${kind==='master'?'master-strip':''} ${selected===kind?'selected':''}`}><div className="channel-heading"><button className="channel-title" aria-label={`Select ${kind} channel`} aria-pressed={selected===kind} onClick={()=>onSelect(kind)}>{title}</button><InspectButton engine={engine} channel={kind} name={title} zh={locale==='zh-CN'} disabled={!ready||busy}/></div><div className="channel-route">{kind==='master'?'ALL → OUTPUT':'RETURN → MASTER'}</div><div className="bus-source">{kind==='master'?'Σ':'SEND '+(kind==='delay'?'A':'B')}<small>{kind==='master'?'Stereo sum':'Post-fader'}</small></div><fieldset disabled={!ready||busy}><div className="channel-fader"><input aria-label={`${kind} channel volume`} type="range" min="0" max="1.5" step="0.01" onContextMenu={e=>automation(e,kind,'gain')} value={gain} onChange={e=>{setGain(+e.target.value);}}/><Meter value={meter} label={`${kind} channel level`}/></div><output className="channel-db">{db(gain)}</output><div className="channel-switches"><button aria-label={`Mute ${kind} channel`} aria-pressed={muted} onClick={toggleMute}>M</button><span>{effectCount} FX</span></div></fieldset></div>;})}</div>
 </section>;
}
