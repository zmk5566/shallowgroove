import {tempoMap,tempoSeconds,tempoTicks,type Project} from '../model/project.ts';
import type {Launch} from './live-clips';

export type SessionSlot={track:number;launch:Launch;phase?:number};
type Midi={tick:number;time:number;status:number;data1:number;data2:number};
type NativeSlot={track:number;duration:number;events:Midi[];phase:number;lengthTicks:number;phaseTicks:number};
type Run={slot:SessionSlot;at:number;startTick:number;payload:NativeSlot;tickAt:(seconds:number)=>number};

function lastAt<T extends {seconds:number;tick:number}>(points:T[],value:number,key:'seconds'|'tick'){
 let lo=0,hi=points.length;
 while(hi-lo>1){const mid=(lo+hi)>>>1;if(points[mid][key]<=value)lo=mid;else hi=mid;}
 return points[lo];
}
type LoopRange={start:number;end:number}|null;
export function sessionTiming(project:Project){
 const tempo=tempoMap(project),ppqn=project.timing.ppqn;
 function seconds(tick:number){
  const p=lastAt(tempo,tick,'tick');return p.seconds+tempoSeconds(p,tick-p.tick,ppqn);
 }
 function tick(t:number){
  const p=lastAt(tempo,t,'seconds');return p.tick+tempoTicks(p,t-p.seconds,ppqn);
 }
 function unwrapped(t:number,loop:LoopRange){
  if(!loop||loop.end<=loop.start||t<loop.end)return tick(t);
  const span=loop.end-loop.start,cycles=Math.floor((t-loop.start)/span);
  return tick(t-cycles*span)+cycles*(tick(loop.end)-tick(loop.start));
 }
 function unwrappedSeconds(t:number,loop:LoopRange){
  if(!loop||loop.end<=loop.start||t<tick(loop.end))return seconds(t);
  const start=tick(loop.start),span=tick(loop.end)-start,cycles=Math.floor((t-start)/span);
  return seconds(t-cycles*span)+cycles*(loop.end-loop.start);
 }
 return {seconds,tick,unwrapped,unwrappedSeconds};
}
export function projectSlot(project:Project,slot:SessionSlot,start:number,at:number,loop:LoopRange=null,startTick=start,timing=sessionTiming(project)):Run{
 const {seconds,unwrapped}=timing,origin=seconds(start),firstTick=unwrapped(origin,loop);
 function tickAt(elapsed:number){return unwrapped(origin+elapsed,loop)-firstTick;}
 const clip=slot.launch.clip,duration=clip?seconds(start+clip.length)-origin:0;
 const events:Midi[]=[];
 for(const e of clip?.events??[]){
  if(e.status===undefined||![8,9,11,14].includes(e.status>>4)||e.tick>=clip!.length)continue;
  const channel=((e.status&15)+slot.launch.channel-clip!.channel+16)%16;
  events.push({tick:e.tick,time:seconds(start+e.tick)-origin,status:(e.status&240)|channel,data1:e.data[0],data2:e.data[1]??0});
 }
 const lengthTicks=clip?.length??0,phaseTicks=lengthTicks?(slot.phase??0)%lengthTicks:0;
 const phase=duration>0?(seconds(start+phaseTicks)-origin)%duration:0;
 return {slot,at,startTick,payload:{track:slot.track,duration,phase,events,lengthTicks,phaseTicks},tickAt};
}

// Keep the editor's scene selection in sync with the native transport's unwrapped clock.
export class NativeSession{
 private runs=new Map<number,Run[]>();
 prepare(project:Project,slots:SessionSlot[],tick:number,at:number,loop:LoopRange=null,startTick=tick,timing=sessionTiming(project)){return slots.map(slot=>projectSlot(project,slot,tick,at,loop,startTick,timing));}
 queue(runs:Run[],now:number){
  for(const run of runs){
   const track=run.slot.track,current=this.runs.get(track)?.filter(r=>r.at<=now&&r.at<run.at).at(-1);
   this.runs.set(track,current?[current,run]:[run]);
  }
 }
 state(track:number,now:number,absoluteTick?:number){
  const runs=this.runs.get(track)??[],current=runs.filter(r=>r.at<=now).at(-1),pending=runs.find(r=>r.at>now);
  const elapsed=current?(absoluteTick===undefined?current.tickAt(now-current.at):Math.max(0,absoluteTick-current.startTick)):0;
  const phase=current&&current.payload.lengthTicks?(elapsed+current.payload.phaseTicks)%current.payload.lengthTicks:0;
  return {active:current?.slot.launch,pending:pending?.slot.launch,phase};
 }
 get engaged(){return this.runs.size>0;}
 tracks(){return [...this.runs.keys()];}
 current(now:number,absoluteTick?:number,includePending=true):SessionSlot[]{
  return this.tracks().flatMap(track=>{const s=this.state(track,now,absoluteTick);const launch=s.active??(includePending?s.pending:undefined);return launch?[{track,launch,phase:s.phase}]:[];});
 }
 pending(now:number,absoluteTick?:number){
  return [...this.runs.values()].flatMap(runs=>runs.filter(r=>r.at>now).map(r=>({
   slot:r.slot,afterTicks:absoluteTick===undefined?-r.tickAt(now-r.at):Math.max(0,r.startTick-absoluteTick)
  })));
 }
 clear(){this.runs.clear();}
}
