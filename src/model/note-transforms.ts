import type {Project,Note} from './project.ts';
import {barRange} from './meter.ts';
import {noteSnapshot,type NoteEdit} from './notes.ts';
export type NoteOperation='quantize'|'transpose'|'set_velocity'|'scale_velocity'|'set_duration'|'scale_duration'|'legato'|'humanize'|'duplicate'|'delete';
export type NoteTransform={revision:string;bar:number;operation:NoteOperation;ids?:string[];gridTicks?:number;strength?:number;semitones?:number;velocity?:number;factor?:number;durationTicks?:number;timingTicks?:number;velocityJitter?:number;seed?:number;destinationBar?:number};
function number(value:unknown,min:number,max:number,name:string,integer=false){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isSafeInteger(value)))throw Error(`Invalid ${name}: expected ${integer?'integer':'number'} in ${min}..${max}`);return value;}
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
/** Build a bounded MIDI edit; editNotes performs collision checks and the atomic commit. */
export function transformNotes(project:Project,index:number,request:NoteTransform):NoteEdit{
 const range=barRange(project,request.bar),snapshot=noteSnapshot(project,index);
 if(request.revision!==snapshot.revision)throw Error('Notes changed or revision is missing. Inspect notes again before transforming.');
 let notes=snapshot.notes.filter(n=>n.tick>=range.startTick&&n.tick<range.endTick);
 if(request.ids!==undefined){if(!Array.isArray(request.ids)||!request.ids.length||new Set(request.ids).size!==request.ids.length)throw Error('Provide unique note IDs');const ids=new Set(request.ids);if(request.ids.some(id=>!notes.some(n=>n.id===id)))throw Error('Selected notes must belong to the requested bar');notes=notes.filter(n=>ids.has(n.id));}
 if(!notes.length)throw Error('No notes in the requested bar');if(notes.length>512)throw Error('More than 512 notes in this bar; choose a smaller explicit note selection');
 const edit:NoteEdit={revision:request.revision,bar:request.bar};
 const update=(fn:(n:typeof notes[number])=>Partial<Note>)=>({...edit,update:notes.map(n=>({id:n.id,...fn(n)}))});
 switch(request.operation){
  case 'quantize':{
   const grid=number(request.gridTicks,1,range.endTick-range.startTick,'gridTicks',true),strength=number(request.strength??1,0,1,'strength'),last=range.startTick+Math.floor((range.endTick-1-range.startTick)/grid)*grid;
   return update(n=>{const target=clamp(range.startTick+Math.round((n.tick-range.startTick)/grid)*grid,range.startTick,last),tick=Math.round(n.tick+(target-n.tick)*strength);return {tick,end:n.end+tick-n.tick};});
  }
  case 'transpose':{const semitones=number(request.semitones,-127,127,'semitones',true);return update(n=>({pitch:number(n.pitch+semitones,0,127,'transposed pitch',true)}));}
  case 'set_velocity':{const velocity=number(request.velocity,1,127,'velocity',true);return update(()=>({velocity}));}
  case 'scale_velocity':{const factor=number(request.factor,.01,16,'factor');return update(n=>({velocity:clamp(Math.round(n.velocity*factor),1,127)}));}
  case 'set_duration':{const duration=number(request.durationTicks,1,1e10,'durationTicks',true);return update(n=>({end:n.tick+duration}));}
  case 'scale_duration':{const factor=number(request.factor,.01,16,'factor');return update(n=>({end:n.tick+Math.max(1,Math.round((n.end-n.tick)*factor))}));}
  case 'legato':{
   const onsets=[...new Set(snapshot.notes.map(n=>n.tick))].sort((a,b)=>a-b);
   return update(n=>({end:Math.min(range.endTick,onsets.find(t=>t>n.tick)??range.endTick)}));
  }
  case 'humanize':{
   const timing=number(request.timingTicks??0,0,Math.min(1e6,range.endTick-range.startTick),'timingTicks',true),velocity=number(request.velocityJitter??0,0,126,'velocityJitter',true);let seed=number(request.seed??0,0,0xffffffff,'seed',true);
   const random=(amount:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*(2*amount+1))-amount;};
   return update(n=>{const tick=clamp(n.tick+random(timing),range.startTick,range.endTick-1);return {tick,end:n.end+tick-n.tick,velocity:clamp(n.velocity+random(velocity),1,127)};});
  }
  case 'duplicate':{
   const destination=barRange(project,request.destinationBar??request.bar+1);if(destination.bar===request.bar)throw Error('Choose a different destination bar');
   const offset=destination.startTick-range.startTick;
   const add=notes.map(n=>{const tick=n.tick+offset;if(tick>=destination.endTick)throw Error('Notes do not fit the destination meter; no edits applied');return {tick,end:n.end+offset,pitch:n.pitch,velocity:n.velocity};});
   return {...edit,bar:destination.bar,add};
  }
  case 'delete':return {...edit,remove:notes.map(n=>n.id)};
  default:throw Error('Unknown note operation');
 }
}
