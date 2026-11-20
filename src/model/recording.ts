import {normalize,normalizedValue,type AutomationLane,type AutomationPoint} from './automation.ts';
import type {MidiEvent,Project,Track} from './project.ts';

// A take is applied as one edit when recording ends.
export class ArrangementTake {
 events=new Map<string,MidiEvent[]>();
 envelopes=new Map<string,{lane:AutomationLane;points:AutomationPoint[]}>();
 held=new Map<string,{track:Track;pitch:number;count:number}>();
 pedals=new Map<string,Track>();
 constructor(startTick:number){this.lastTick=startTick;}
 lastTick:number;
 warning='';
 canAppend(track:Track){
  // Reserve room for held-note releases, pedal up, and the next incoming message.
  let reserve=3;for(const entry of this.held.values())if(entry.track.id===track.id)reserve+=entry.count;
  return track.events.length+(this.events.get(track.id)?.length??0)+reserve<=200000;
 }
 midi(track:Track,data:number[],tick:number){
  const kind=data[0]>>4;
  if(![8,9,11,14].includes(kind)||data.length!==3)return;
  const events=this.events.get(track.id)??[],key=track.id+'/'+data[1];
  this.events.set(track.id,events);
  events.push({kind:'midi',tick,order:events.length,status:(kind<<4)|(track.midi_channel-1),channel:track.midi_channel,data:data.slice(1)});
  if(kind===11&&data[1]===64){if(data[2]>=64)this.pedals.set(track.id,track);else this.pedals.delete(track.id);}
  const count=this.held.get(key)?.count??0;
  if(kind===9&&data[2]>0)this.held.set(key,{track,pitch:data[1],count:count+1});
  else if(kind===8||kind===9){if(count>1)this.held.set(key,{track,pitch:data[1],count:count-1});else this.held.delete(key);}
 }
 sample(key:string,lane:AutomationLane,tick:number,physical:number){
  let entry=this.envelopes.get(key);if(!entry){entry={lane,points:[]};this.envelopes.set(key,entry);}
  const value=normalize(lane,physical),points=entry.points,last=points.at(-1);
  if(last?.tick===tick){last.value=value;return;}
  if(last?.value===value&&points.at(-2)?.value===value)last.tick=tick;
  else points.push({tick,value});
  if(points.length>4096)entry.points=points.filter((_,i)=>i%2===0);
 }
 finish(project:Project,tick:number){
  for(const {track,pitch,count} of [...this.held.values()])for(let i=0;i<count;i++)this.midi(track,[128,pitch,0],tick);
  for(const track of [...this.pedals.values()])this.midi(track,[176,64,0],tick);
  if(!this.events.size&&!this.envelopes.size)return project;
  const tracks=project.tracks.map(t=>{
   const added=this.events.get(t.id);if(!added)return t;
   const order=t.events.reduce((n,e)=>Math.max(n,e.order+1),0);
   return {...t,events:[...t.events,...added.map(e=>({...e,order:e.order+order}))].sort((a,b)=>a.tick-b.tick||a.order-b.order)};
  });
  const automation=[...(project.automation??[])];
  for(const {lane,points} of this.envelopes.values()){
   const first=points[0].tick,last=points.at(-1)!.tick;
   const retained=lane.points.filter(p=>p.tick<first||p.tick>last);
   for(const boundary of [first-1,last+1])if(boundary>=0&&boundary<=project.timing.end_tick&&!retained.some(p=>p.tick===boundary)){
    const value=normalizedValue(lane,boundary);if(value!==null)retained.push({tick:boundary,value});
   }
   let inside=points;
   while(inside.length+retained.length>4096&&inside.length>2)inside=inside.filter((_,i)=>i%2===0||i===inside.length-1);
   const merged=[...retained,...inside].sort((a,b)=>a.tick-b.tick);
   if(merged.length>4096||(!automation.some(l=>l.id===lane.id)&&automation.length>=256)){
    this.warning='包络已达到工程容量，此轨包络未写入 / Automation capacity reached. This envelope was skipped.';continue;
   }
   const next={...lane,mode:'read' as const,points:merged},index=automation.findIndex(l=>l.id===lane.id);
   if(index<0)automation.push(next);else automation[index]=next;
  }
  return {...project,tracks,automation};
 }
}
