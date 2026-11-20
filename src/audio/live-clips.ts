import type {Clip} from '../model/clips';
import type {MidiEvent} from '../model/project';
export type Launch={sceneId:string;clip:Clip|null;channel:number};
type Run={tick:number;launch:Launch|null;events:MidiEvent[]};
type Send=(track:number,data:number[],tick:number)=>void;

export class LiveClips{
 private runs=new Map<number,Run[]>();
 through=-Infinity;
 clear(){this.runs.clear();this.through=-Infinity;}
 rebase(from:number,to:number){
  for(const runs of this.runs.values())for(const r of runs)r.tick+=to-from;
  this.through=to;
 }
 get engaged(){return this.runs.size>0;}
 tracks(){return [...this.runs.keys()];}
 state(track:number,tick:number){
  const runs=this.runs.get(track)??[];
  const current=runs.filter(r=>r.tick<=tick).at(-1);
  return {active:current?.launch,pending:runs.find(r=>r.tick>tick)?.launch,phase:current?.launch?.clip?(tick-current.tick)%current.launch.clip.length:0};
 }
 owns(track:number,tick:number){return !!this.state(track,tick).active;}
 chase(track:number,tick:number){
  const run=this.runs.get(track)?.filter(r=>r.tick<=tick).at(-1);
  if(!run?.launch)return null;
  return {events:run.events.map(e=>({...e,seconds:e.tick,trackIndex:track})),phase:run.launch.clip?(tick-run.tick)%run.launch.clip.length:0};
 }
 queue(track:number,launch:Launch|null,tick:number){
  const clip=launch?.clip;
  const events=clip?.events.filter(e=>e.status!==undefined&&[8,9,11,14].includes(e.status>>4)&&e.tick<clip.length).map(e=>({...e,status:(e.status!&240)|((e.status!%16+launch!.channel-clip.channel+16)%16)}))??[];
  const runs=(this.runs.get(track)??[]).filter(r=>r.tick<tick&&r.tick<=this.through);
  runs.push({tick,launch,events});this.runs.set(track,runs);
 }
 // Render half-open tick windows; events at a boundary belong to the new clip.
 render(from:number,to:number,send:Send,transition:(track:number,tick:number,previous:Launch|null,next:Launch|null)=>void,only?:Set<number>){
  if(!only)from=Math.max(from,this.through);if(from>=to)return;
  for(const [track,runs] of this.runs){
   if(only&&!only.has(track))continue;
   for(let i=0;i<runs.length;i++){
    const run=runs[i],stop=Math.min(to,runs[i+1]?.tick??Infinity);
    if(stop<=from||run.tick>=to)continue;
    if(run.tick>=from)transition(track,run.tick,runs[i-1]?.launch??null,run.launch);
    if(!run.launch?.clip)continue;
    const length=run.launch.clip.length,first=Math.max(0,Math.floor((from-run.tick)/length));
    for(let start=run.tick+first*length;start<stop;start+=length){
     if(start>run.tick&&start>=from)transition(track,start,run.launch,run.launch);
     const offset=from-start;
     let lo=0,hi=run.events.length;
     while(lo<hi){const mid=(lo+hi)>>>1;if(run.events[mid].tick<offset)lo=mid+1;else hi=mid;}
     for(let j=lo;j<run.events.length;j++){
      const e=run.events[j],tick=start+e.tick;if(tick>=stop)break;
      send(track,[e.status!,...e.data],tick);
     }
    }
   }
  }
  if(!only)this.through=to;
 }
 prune(now:number){
  for(const [track,runs] of this.runs){
   while(runs.length>1&&runs[1].tick<=now)runs.shift();
   if(runs.length===1&&!runs[0].launch&&runs[0].tick<=now)this.runs.delete(track);
  }
 }
}
