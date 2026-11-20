import {defaultClipSlot} from './scenes.ts';
import type {MidiEvent,Project,Track} from './project';
import {pairNotes} from './midi-pairs.ts';

export interface ClipRef {id:string;clipId:string;start:number}
export interface Clip {id:string;name:string;length:number;channel:number;events:MidiEvent[];source?:{id:string;events:MidiEvent[]}}
export type ClipAction=
 | {kind:'create';start:number;end:number;name:string}
 | {kind:'insert'|'copy';clipId:string;start:number}
 | {kind:'fork';refId:string;name:string}
 | {kind:'switch';refId:string;clipId:string};

function transposeChannel(e:MidiEvent,from:number,to:number){
 if(from===to||e.status===undefined||e.status>=240)return e;
 const ch=((e.status%16+to-from+16)%16);
 return {...e,...(e.channel===undefined?{}:{channel:ch+1}),status:(e.status&240)+ch};
}
function relative(events:MidiEvent[],ref:ClipRef,channel:number,clip:Clip){
 return events.filter(e=>e.clipRef===ref.id).map(({clipRef:_,...e},order)=>
  transposeChannel({...e,tick:e.tick-ref.start,order},channel,clip.channel));
}
function placed(clip:Clip,start:number,channel:number,refId?:string){
 return clip.events.map(e=>({...transposeChannel(e,clip.channel,channel),tick:start+e.tick,...(refId?{clipRef:refId}:{})}));
}
function clipById(project:Project,id:string){
 const clip=project.clips?.find(c=>c.id===id);
 if(!clip)throw Error('Clip no longer exists');
 return clip;
}
function ensureRoom(project:Project,track:Track,start:number,length:number,except?:string){
 if(!Number.isSafeInteger(start)||start<0||start+length>1e10)throw Error('Invalid clip position');
 for(const ref of track.clipRefs??[]){
  if(ref.id!==except&&start<ref.start+clipById(project,ref.clipId).length&&ref.start<start+length)
   throw Error('此位置已有 Clip 引用 / Clip references overlap');
 }
}
function nameOf(value:string){if(!value.trim())throw Error('请输入 Clip 名称 / Enter a clip name');return value.trim();}
export function renameClip(project:Project,id:string,value:string):Project{
 const clip=clipById(project,id),name=nameOf(value);
 if(name===clip.name)return project;
 return {...project,clips:project.clips!.map(c=>c.id===id?{...c,name}:c)};
}
function notePartners(events:MidiEvent[]){
 const pairs=new Map<MidiEvent,MidiEvent|undefined>(),held=new Map<number,MidiEvent[]>();
 for(const e of events){
  const kind=(e.status??0)>>4;
  if(kind!==8&&kind!==9)continue;
  const key=((e.status!&15)<<8)+e.data[0];
  if(kind===9&&e.data[1]>0){
   let queue=held.get(key);if(!queue){queue=[];held.set(key,queue);}
   queue.push(e);pairs.set(e,undefined);
  }else{
   const attack=held.get(key)?.shift();if(attack)pairs.set(attack,e);
  }
 }
 return pairs;
}
function mergeEvents(base:MidiEvent[],added:MidiEvent[]){
 // Merge ordered streams without reordering existing controllers or notes.
 const events:MidiEvent[]=[];
 let i=0,j=0;
 const release=(e:MidiEvent)=>(e.status??0)>>4===8||((e.status??0)>>4===9&&e.data[1]===0);
 while(i<base.length||j<added.length){
  const a=base[i],b=added[j];
  if(!b||(a&&(a.tick<b.tick||(a.tick===b.tick&&(!release(b)||release(a)))))){events.push(a);i++;}
  else {events.push(b);j++;}
 }
 const merged=notePartners(events);
 for(const stream of [base,added]){
  for(const [attack,release] of notePartners(stream)){
   if(merged.get(attack)!==release)throw Error('同音高的 MIDI 音符在此位置发生冲突 / Overlapping MIDI notes would change note pairing');
  }
 }
 return events.map((e,order)=>({...e,order}));
}
function finish(project:Project,index:number,track:Track,clips:Clip[],end:number){
 if(track.events.length>200000)throw Error('Track event limit exceeded');
 const end_tick=track.events.reduce((max,e)=>Math.max(max,e.tick),Math.max(end,project.timing.end_tick));
 if(end_tick>1e10)throw Error('Clip exceeds project limit');
 return {...project,clips,timing:{...project.timing,end_tick},tracks:project.tracks.map((t,i)=>i===index?track:t)};
}
export function applyClip(project:Project,index:number,action:ClipAction){
 const track=project.tracks[index],refs=track.clipRefs??[],clips=project.clips??[];
 if(action.kind==='create'){
  const {start,end}=action;
  if(!Number.isSafeInteger(end)||end<=start||end>project.timing.end_tick)throw Error('请选择小节 / Select a bar range');
  ensureRoom(project,track,start,end-start);
  const clip:Clip={id:crypto.randomUUID(),name:nameOf(action.name),channel:track.midi_channel,length:end-start,events:[]};
  const ref={id:crypto.randomUUID(),clipId:clip.id,start};
  const owned=new Set<number>();
  track.events.forEach((e,i)=>{const kind=(e.status??0)>>4;if(kind>=10&&kind<=14&&e.tick>=start&&e.tick<end&&!e.clipRef)owned.add(i);});
  const releases:MidiEvent[]=[];
  const lastOrder=track.events.reduce((n,e)=>Math.max(n,e.order),0);
  for(const note of pairNotes(track,project.timing.end_tick)){
   if(note.tick<start||note.tick>=end||track.events[note.on].clipRef)continue;
   owned.add(note.on);if(note.off!==undefined)owned.add(note.off);
   else releases.push({kind:'midi',status:128+note.channel-1,channel:note.channel,data:[note.pitch,0],tick:note.end,order:lastOrder+1+releases.length,clipRef:ref.id});
  }
  const tagged=track.events.map((e,i)=>owned.has(i)?{...e,clipRef:ref.id}:e);
  const events=releases.length?[...tagged,...releases].sort((a,b)=>a.tick-b.tick||a.order-b.order).map((e,order)=>({...e,order})):tagged;
  clip.events=relative(events,ref,track.midi_channel,clip);
  const next=finish(project,index,{...track,events,clipRefs:[...refs,ref]},[...clips,clip],end);
  return {project:{...next,scenes:defaultClipSlot(next,track.id,clip.id)},ref};
 }
 if(action.kind==='fork'||action.kind==='switch'){
  const old=refs.find(r=>r.id===action.refId);if(!old)throw Error('Select a clip reference');
  const parent=clipById(project,old.clipId);
  const clip=action.kind==='fork'?{...parent,id:crypto.randomUUID(),name:nameOf(action.name),source:{id:parent.id,events:structuredClone(parent.events)}}:clipById(project,action.clipId);
  ensureRoom(project,track,old.start,clip.length,old.id);
  const ref={...old,clipId:clip.id};
  const events=action.kind==='fork'?track.events:mergeEvents(track.events.filter(e=>e.clipRef!==ref.id),placed(clip,ref.start,track.midi_channel,ref.id));
  const next=finish(project,index,{...track,events,clipRefs:refs.map(r=>r.id===ref.id?ref:r)},action.kind==='fork'?[...clips,clip]:clips,ref.start+clip.length);
  return {project:action.kind==='fork'?{...next,scenes:defaultClipSlot(next,track.id,clip.id)}:next,ref};
 }
 const clip=clipById(project,action.clipId);
 ensureRoom(project,track,action.start,clip.length);
 const ref=action.kind==='insert'?{id:crypto.randomUUID(),clipId:clip.id,start:action.start}:undefined;
 const events=mergeEvents(track.events,placed(clip,action.start,track.midi_channel,ref?.id));
 return {project:finish(project,index,{...track,events,clipRefs:ref?[...refs,ref]:refs},clips,action.start+clip.length),ref};
}

// Track MIDI remains playable by existing consumers. Apply edits to each source
// once, then expand it into the other placements within the same transaction.
export function propagateClips(before:Project,after:Project,index:number):Project{
 const track=after.tracks[index],refs=track.clipRefs??[];
 if(!refs.length)return after;
 const updates=new Map<string,{clip:Clip;edited:Set<string>}>();
 for(const ref of refs){
  const clip=clipById(before,ref.clipId),events=relative(track.events,ref,track.midi_channel,clip);
  if(JSON.stringify(events)===JSON.stringify(clip.events))continue;
  if(events.some(e=>e.tick<0||(((e.status??0)>>4)===9&&e.data[1]>0&&e.tick>=clip.length)))throw Error('音符起点超出 Clip / Note starts outside its clip');
  const change=updates.get(clip.id);
  if(change&&JSON.stringify(events)!==JSON.stringify(change.clip.events))throw Error('同一 Clip 的引用有冲突，请一次编辑一处 / Conflicting edits to linked references');
  if(change)change.edited.add(ref.id);else updates.set(clip.id,{clip:{...clip,events},edited:new Set([ref.id])});
 }
 if(!updates.size)return after;
 let end_tick=after.timing.end_tick;
 const tracks=after.tracks.map(t=>{
  let events=t.events;
  for(const r of t.clipRefs??[]){
   const change=updates.get(r.clipId);
   if(!change||change.edited.has(r.id))continue;
   events=mergeEvents(events.filter(e=>e.clipRef!==r.id),placed(change.clip,r.start,t.midi_channel,r.id));
  }
  if(events.length>200000)throw Error('Track event limit exceeded');
  end_tick=events.reduce((max,e)=>Math.max(max,e.tick),end_tick);
  return events===t.events?t:{...t,events};
 });
 if(end_tick>1e10)throw Error('Clip exceeds project limit');
 return {...after,tracks,timing:{...after.timing,end_tick},clips:after.clips!.map(c=>updates.get(c.id)?.clip??c)};
}

export function copyBars(project:Project,index:number,start:number,end:number,destination:number){
 const existing=project.tracks[index].clipRefs?.find(r=>r.start===start&&clipById(project,r.clipId).length===end-start);
 if(existing)return applyClip(project,index,{kind:'copy',clipId:existing.clipId,start:destination}).project;
 // Extract from a temporary projection so a plain copy also works across references.
 const track=project.tracks[index];
 const raw={...track,clipRefs:[],events:track.events.map(({clipRef:_,...event})=>event)};
 const temp={...project,tracks:project.tracks.map((t,i)=>i===index?raw:t)};
 const extracted=applyClip(temp,index,{kind:'create',name:'Copy',start,end});
 const clip=extracted.project.clips.at(-1)!;
 ensureRoom(project,track,destination,clip.length);
 return finish(project,index,{...track,events:mergeEvents(track.events,placed(clip,destination,track.midi_channel))},project.clips??[],destination+clip.length);
}

export function validateClips(project:Project){
 const fail=()=>{throw Error('Invalid clip library or reference');};
 const integer=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
 const clips=project.clips??[];
 if(!Array.isArray(clips))fail();
 const known=new Map<string,Clip>();
 const checkEvents=(events:MidiEvent[],length:number)=>{
  if(!Array.isArray(events)||events.length>200000)fail();
  let previous=-1;
  for(const e of events){
   if(!e||!integer(e.tick,0,1e10)||e.tick<previous||!integer(e.order,0,1e10)||e.clipRef!==undefined||
      !integer(e.status!,128,239)||!Array.isArray(e.data)||!e.data.every(n=>integer(n,0,255)))fail();
   if(e.tick>=length&&!((e.status!>>4)===8||((e.status!>>4)===9&&e.data[1]===0)))fail();
   previous=e.tick;
  }
 };
 for(const c of clips){
  if(!c||typeof c.id!=='string'||!c.id||known.has(c.id)||typeof c.name!=='string'||!c.name.trim()||!integer(c.length,1,1e10)||!integer(c.channel,1,16))fail();
  checkEvents(c.events,c.length);known.set(c.id,c);
 }
 const visited=new Set<string>();
 for(const c of clips){
  const path=new Set<string>();let node:Clip|undefined=c;
  while(node&&!visited.has(node.id)){
   if(path.has(node.id))fail();path.add(node.id);
   if(!node.source)break;
   checkEvents(node.source.events,node.length);
   node=known.get(node.source.id);if(!node)fail();
  }
  for(const id of path)visited.add(id);
 }
 const ids=new Set<string>();
 for(const t of project.tracks){
  const refs=t.clipRefs??[];
  if(!Array.isArray(refs))fail();
  const byRef=new Map<string,MidiEvent[]>();
  let end=0;
  for(const r of [...refs].sort((a,b)=>a.start-b.start)){
   const clip=known.get(r.clipId);
   if(!clip||typeof r.id!=='string'||!r.id||ids.has(r.id)||!integer(r.start,end,project.timing.end_tick-clip.length))throw Error('Invalid clip placement');
   end=r.start+clip.length;ids.add(r.id);byRef.set(r.id,[]);
  }
  for(const e of t.events)if(e.clipRef!==undefined){
   const group=byRef.get(e.clipRef);if(!group)throw Error('Orphan clip event');group.push(e);
  }
  for(const r of refs){
   const clip=known.get(r.clipId)!;
   if(JSON.stringify(relative(byRef.get(r.id)!,r,t.midi_channel,clip))!==JSON.stringify(clip.events))fail();
  }
 }
}

// Use the normal note editor in clip-local ticks, even for a slot whose track
// has no arrangement placement. Materialize the new source across all references.
export function clipEditorProject(p:Project,index:number,clip:Clip):Project{
 return {...p,timing:{...p.timing,end_tick:Math.max(clip.length,clip.events.at(-1)?.tick??0)},
  tracks:p.tracks.map((t,i)=>i===index?{...t,id:clip.id,clipRefs:[],midi_channel:clip.channel,events:clip.events}:t)};
}
export function replaceClipEvents(p:Project,id:string,events:MidiEvent[]):Project{
 const original=clipById(p,id),clip={...original,events:events.map((e,order)=>({...e,order}))};
 let end_tick=p.timing.end_tick;
 const tracks=p.tracks.map(t=>{
  let midi=t.events;
  for(const ref of t.clipRefs??[])if(ref.clipId===id)midi=mergeEvents(midi.filter(e=>e.clipRef!==ref.id),placed(clip,ref.start,t.midi_channel,ref.id));
  if(midi===t.events)return t;
  if(midi.length>200000)throw Error('Track event limit exceeded');
  end_tick=Math.max(end_tick,midi.at(-1)?.tick??0);
  return {...t,events:midi};
 });
 const next={...p,tracks,timing:{...p.timing,end_tick},clips:p.clips!.map(c=>c.id===id?clip:c)};
 validateClips(next);return next;
}

export function clipReferenceCount(project:Project,id:string){
 const arrangement=project.tracks.reduce((n,t)=>n+(t.clipRefs??[]).filter(r=>r.clipId===id).length,0);
 return arrangement+(project.scenes??[]).reduce((n,s)=>n+s.slots.filter(slot=>slot.clipId===id).length,0);
}
