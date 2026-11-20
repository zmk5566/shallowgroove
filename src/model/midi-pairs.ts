import type {Note,Track} from './project';
export type PairedNote=Note&{id:string;on:number;off?:number;channel:number};
export function pairNotes(track:Track,endTick:number):PairedNote[]{
 const notes:PairedNote[]=[],held=new Map<string,PairedNote[]>();
 for(const {event:e,index} of track.events.map((event,index)=>({event,index})).sort((a,b)=>a.event.tick-b.event.tick||a.event.order-b.event.order)){
  const kind=(e.status??0)>>4;if(kind!==8&&kind!==9)continue;
  const channel=(e.status!&15)+1,pitch=e.data[0],key=`${channel}:${pitch}`;
  if(kind===9&&e.data[1]>0){const note={id:`note:${index}`,on:index,tick:e.tick,end:endTick,pitch,velocity:e.data[1],channel};notes.push(note);const q=held.get(key)??[];q.push(note);held.set(key,q);}
  else {const note=held.get(key)?.shift();if(note){note.end=e.tick;note.off=index;}}
 }
 return notes;
}
