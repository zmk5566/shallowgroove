export interface TimedMidi {seconds:number;trackIndex:number;status?:number;data:number[]}
// Restore controller state and notes crossing the destination. Envelopes retrigger;
// this is MIDI chase, not reconstruction of a DSP's past audio phase or effect tail.
export function chaseMidi(events:TimedMidi[],seconds:number){
 const controllers=new Map<string,{trackIndex:number;data:number[]}>();
 const sustain=new Map<string,boolean>();
 const notes=new Map<string,{trackIndex:number;channel:number;pitch:number;velocity:number;held:boolean}[]>();
 let cursor=0;
 for(;cursor<events.length&&events[cursor].seconds<seconds;cursor++){
  const e=events[cursor];if(e.status===undefined)continue;
  const kind=e.status>>4,channel=e.status&15,key=`${e.trackIndex}:${channel}`,pitch=e.data[0],noteKey=`${key}:${pitch}`;
  if(kind===11){
   const value=e.data[1];
   if(pitch===120||pitch===123){for(const [id,list] of notes)if(id.startsWith(key+':')){if(pitch===123&&sustain.get(key))list.forEach(n=>n.held=false);else notes.delete(id);}continue;}
   if(pitch===121){for(const id of controllers.keys())if(id.startsWith(key+':'))controllers.delete(id);sustain.set(key,false);for(const [id,list] of notes)if(id.startsWith(key+':'))notes.set(id,list.filter(n=>n.held));continue;}
   controllers.set(`${key}:cc:${pitch}`,{trackIndex:e.trackIndex,data:[e.status,...e.data]});
   if(pitch===64){sustain.set(key,value>=64);if(value<64)for(const [id,list] of notes)if(id.startsWith(key+':'))notes.set(id,list.filter(n=>n.held));}
  }else if(kind===14)controllers.set(`${key}:bend`,{trackIndex:e.trackIndex,data:[e.status,...e.data]});
  else if(kind===9&&e.data[1]>0){const list=notes.get(noteKey)??[];list.push({trackIndex:e.trackIndex,channel,pitch,velocity:e.data[1],held:true});notes.set(noteKey,list);}
  else if(kind===8||(kind===9&&e.data[1]===0)){const list=notes.get(noteKey)??[],index=list.findIndex(n=>n.held);if(index>=0){if(sustain.get(key))list[index].held=false;else list.splice(index,1);}}
 }
 const messages=[...controllers.values()];
 for(const list of notes.values())for(const n of list){messages.push({trackIndex:n.trackIndex,data:[0x90|n.channel,n.pitch,n.velocity]});if(!n.held)messages.push({trackIndex:n.trackIndex,data:[0x80|n.channel,n.pitch,0]});}
 return {cursor,messages};
}
