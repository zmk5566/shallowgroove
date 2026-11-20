import {pairNotes,type PairedNote} from './midi-pairs.ts';
import type {Project,MidiEvent,Note,Track} from './project';
import {propagateClips} from './clips.ts';
import {meterMap,musicalPosition,barRange} from './meter.ts';
export type NoteEdit={bar?:number;revision:string;add?:Note[];update?:({id:string}&Partial<Note>)[];remove?:string[]};
export type NoteTranspose={revision:string;semitones:number};
export type NoteQuery={bar?:number;summaryOnly?:boolean;startTick?:number;endTick?:number;offset?:number;limit?:number};

const maximumTick=1e10;
function integer(value:unknown,min:number,max:number,name:string):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error(`${name} must be an integer between ${min} and ${max}`);return value;
}
function trackAt(project:Project,index:number){const track=project.tracks[index];if(!Number.isInteger(index)||!track)throw Error('Select a MIDI track');return track;}
function revisionOf(project:Project,track:Track){
 // Hash all source events, not just the displayed page. Note IDs are scoped to this revision.
 const text=JSON.stringify([track.id,track.midi_channel,project.timing.end_tick,track.clipRefs,track.events]);let a=2166136261,b=5381;
 for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
 return `${(a>>>0).toString(16)}-${(b>>>0).toString(16)}-${text.length}`;
}
/** Complete lightweight view for the virtualized editor, without assistant pagination. */
export function noteSnapshot(project:Project,index:number){
 const track=trackAt(project,index);
 return {revision:revisionOf(project,track),notes:pairNotes(track,project.timing.end_tick).map(({on,off,channel,...note})=>({...note,closed:off!==undefined,midiChannel:channel}))};
}
export function inspectNotes(project:Project,index:number,query:NoteQuery={}){
 if(query.bar!==undefined&&(query.startTick!==undefined||query.endTick!==undefined))throw Error('Use bar or tick bounds, not both');
 const range=query.bar!==undefined?barRange(project,query.bar):null;
 const track=trackAt(project,index),start=integer(range?.startTick??query.startTick??0,0,maximumTick,'startTick'),end=integer(range?.endTick??query.endTick??maximumTick,0,maximumTick,'endTick');
 if(end<start)throw Error('endTick must not precede startTick');
 const offset=integer(query.offset??0,0,200000,'offset'),limit=integer(query.limit??128,1,512,'limit');
 const all=pairNotes(track,project.timing.end_tick),filtered=all.filter(n=>n.tick>=start&&n.tick<end),notes=(query.summaryOnly?[]:filtered.slice(offset,offset+limit)).map(({on,off,channel,...n})=>({...n,closed:off!==undefined,midiChannel:channel,position:musicalPosition(project,n.tick)}));
 const references=track.clipRefs?.map(ref=>{
  const clip=project.clips!.find(c=>c.id===ref.clipId)!;
  return {...ref,name:clip.name,end:ref.start+clip.length,parentId:clip.source?.id,linkedPlacements:project.tracks.reduce((n,t)=>n+(t.clipRefs??[]).filter(r=>r.clipId===clip.id).length,0)};
 });
 return {barRange:range,trackId:track.id,...(references?.length?{clipReferences:references}:{}),revision:revisionOf(project,track),timing:project.timing,meterMap:meterMap(project),total:filtered.length,trackTotal:all.length,pitchRange:filtered.length?[filtered.reduce((v,n)=>Math.min(v,n.pitch),127),filtered.reduce((v,n)=>Math.max(v,n.pitch),0)]:null,summaryOnly:query.summaryOnly===true,offset,nextOffset:query.summaryOnly?null:offset+notes.length<filtered.length?offset+notes.length:null,notes,rangeRule:'Note onset in [startTick, endTick). Absolute integer MIDI ticks; pitch 60 is C4; velocity 1..127.'};
}
export function editNotes(project:Project,index:number,edit:NoteEdit){
 const track=trackAt(project,index);if(!edit||edit.revision!==revisionOf(project,track))throw Error('Notes changed or revision is missing. Inspect notes again before editing.');
 const add=edit.add??[],update=edit.update??[],remove=edit.remove??[];
 if(!Array.isArray(add)||!Array.isArray(update)||!Array.isArray(remove))throw Error('Note edits must be arrays');
 const count=add.length+update.length+remove.length;if(count<1||count>512)throw Error('Provide between 1 and 512 note edits per call');
 const originals=pairNotes(track,project.timing.end_tick),byId=new Map(originals.map(n=>[n.id,n])),touched=new Set<string>(),discard=new Set<number>();
 const target=(id:string)=>{if(touched.has(id))throw Error('Duplicate note target');const n=byId.get(id);if(!n)throw Error('Unknown note ID; inspect notes again');touched.add(id);discard.add(n.on);if(n.off!==undefined)discard.add(n.off);return n;};
 for(const id of remove)target(id);
 const replacements:PairedNote[]=update.map(p=>{if(!p||!['tick','end','pitch','velocity'].some(k=>p[k as keyof typeof p]!==undefined))throw Error('Provide at least one note property');const n=target(p.id);return {...n,...Object.fromEntries(['tick','end','pitch','velocity'].filter(k=>p[k as keyof typeof p]!==undefined).map(k=>[k,p[k as keyof typeof p]]))};});
 for(const n of add){if(!n||typeof n!=='object')throw Error('Invalid note');replacements.push({id:'new',on:-1,channel:track.midi_channel,tick:n.tick,end:n.end,pitch:n.pitch,velocity:n.velocity});}
 for(const n of replacements){integer(n.tick,0,maximumTick,'tick');integer(n.end,n.tick+1,maximumTick,'end');integer(n.pitch,0,127,'pitch');integer(n.velocity,1,127,'velocity');}
 const kept=originals.filter(n=>!touched.has(n.id));
 // Existing overlaps are preserved. New or changed overlapping unisons are ambiguous in MIDI 1.0.
 const groups=new Map<string,{note:PairedNote;changed:boolean}[]>();
 for(const item of [...kept.map(note=>({note,changed:false})),...replacements.map(note=>({note,changed:true}))]){const key=`${item.note.channel}:${item.note.pitch}`,group=groups.get(key)??[];group.push(item);groups.set(key,group);}
 for(const group of groups.values()){group.sort((a,b)=>a.note.tick-b.note.tick);let anyEnd=-1,changedEnd=-1;for(const {note,changed} of group){if((changed&&note.tick<anyEnd)||note.tick<changedEnd)throw Error('Same-pitch notes overlap on the same MIDI channel; shorten or move them first');anyEnd=Math.max(anyEnd,note.end);if(changed)changedEnd=Math.max(changedEnd,note.end);}}
 const events:MidiEvent[]=track.events.filter((_,i)=>!discard.has(i)).map(e=>({...e}));let order=events.reduce((max,e)=>Math.max(max,e.order),0)+1;
 const inserted:{on:MidiEvent;off:MidiEvent}[]=[];
 for(const n of replacements){
  const ref=n.on>=0?track.events[n.on].clipRef:track.clipRefs?.find(r=>n.tick>=r.start&&n.tick<r.start+(project.clips?.find(c=>c.id===r.clipId)?.length??0))?.id;
  const owner=ref?{clipRef:ref}:{};
  const on:MidiEvent={...owner,kind:'midi',tick:n.tick,order:order++,status:0x90|(n.channel-1),channel:n.channel,data:[n.pitch,n.velocity]},off:MidiEvent={...owner,kind:'midi',tick:n.end,order:-1,status:0x80|(n.channel-1),channel:n.channel,data:[n.pitch,0]};events.push(on,off);inserted.push({on,off});}
 if(events.length>200000)throw Error('Track event limit exceeded');
 // New releases precede existing events; new attacks follow them. Preserve legacy event ordering.
 events.sort((a,b)=>a.tick-b.tick||a.order-b.order);events.forEach((e,i)=>{e.order=i;});
 const endTick=replacements.reduce((end,n)=>Math.max(end,n.end),project.timing.end_tick),next={...project,timing:{...project.timing,end_tick:endTick},tracks:project.tracks.map((t,i)=>i===index?{...t,events}:t)};
 const paired=new Map(pairNotes(next.tracks[index],endTick).map(n=>[n.on,n.off]));
 const indices=new Map(events.map((e,i)=>[e,i]));
 for(const pair of inserted)if(paired.get(indices.get(pair.on)!)!==indices.get(pair.off))throw Error('Ambiguous MIDI pairing with an unmatched legacy note-off; no edits applied');
 return {project:propagateClips(project,next,index),added:add.length,updated:update.length,removed:remove.length};
}

/** Uniform pitch shift preserves event order, pairing, overlap and release encoding. */
export function transposeNotes(project:Project,index:number,edit:NoteTranspose){
 const track=trackAt(project,index);if(edit.revision!==revisionOf(project,track))throw Error('Notes changed or revision is missing. Inspect notes again before editing.');
 const semitones=integer(edit.semitones,-127,127,'semitones');
 const events=track.events.map(e=>{if(![8,9,10].includes((e.status??0)>>4))return e;const pitch=integer(e.data[0]+semitones,0,127,'transposed pitch');return {...e,data:[pitch,...e.data.slice(1)]};});
 const updated=semitones===0?0:track.events.filter(e=>(e.status??0)>>4===9&&e.data[1]>0).length;
 return {project:propagateClips(project,{...project,tracks:project.tracks.map((t,i)=>i===index?{...t,events}:t)},index),added:0,updated,removed:0,semitones};
}

/** Assistant local edits are one-bar transactions; note tails retain their full duration. */
export function noteEditBar(project:Project,index:number,edit:NoteEdit){
 const track=trackAt(project,index),notes=pairNotes(track,project.timing.end_tick),byId=new Map(notes.map(n=>[n.id,n]));
 if(edit.bar!==undefined)barRange(project,edit.bar);
 const bars=new Set<number>();const addTick=(tick:number)=>{integer(tick,0,maximumTick,'tick');bars.add(musicalPosition(project,tick).bar);};
 for(const n of edit.add??[])addTick(n.tick);
 for(const id of [...(edit.remove??[]),...(edit.update??[]).map(n=>n.id)]){const note=byId.get(id);if(!note)throw Error('Unknown note ID; inspect notes again');addTick(note.tick);}
 for(const n of edit.update??[])if(n.tick!==undefined)addTick(n.tick);
 if(bars.size!==1)throw Error('Local note edits must affect exactly one bar per call; inspect and edit each bar in sequence.');
 const bar=[...bars][0];if(edit.bar!==undefined&&edit.bar!==bar)throw Error('Note edit falls outside the requested bar');return bar;
}
