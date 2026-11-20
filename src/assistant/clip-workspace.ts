import {applyClip,clipEditorProject,renameClip,replaceClipEvents} from '../model/clips.ts';
import {barRange,musicalPosition} from '../model/meter.ts';
import {editNotes,inspectNotes,noteEditBar,transposeNotes} from '../model/notes.ts';
import {transformNotes} from '../model/note-transforms.ts';
import {createSlotClip,sceneRows} from '../model/scenes.ts';
import type {Project} from '../model/project';
import type {MusicCommand} from './contracts';

export function workspaceInventory(project:Project){
 const clips=new Map(project.clips?.map(c=>[c.id,c]));
 return {
  clips:[...clips.values()].map(c=>({clipId:c.id,name:c.name,lengthTicks:c.length,parentClipId:c.source?.id??null})),
  scenes:sceneRows(project),
  arrangement:project.tracks.map(t=>({trackId:t.id,references:(t.clipRefs??[]).map(r=>({
   refId:r.id,clipId:r.clipId,startTick:r.start,endTick:r.start+clips.get(r.clipId)!.length,startPosition:musicalPosition(project,r.start)
  }))}))
 };
}

export function clipCommand(project:Project,index:number,command:MusicCommand){
 const track=project.tracks[index];
 if(!track)throw Error('Select a MIDI track');
 if(command.action==='create_clip'){
  const created=createSlotClip(project,command.sceneId,track.id,command.lengthBars!);
  const next=renameClip(created.project,created.clip.id,command.name??'');
  return {next,result:{trackId:track.id,clipId:created.clip.id,lengthTicks:created.clip.length,sceneId:created.sceneId}};
 }
 if(command.action==='fork_clip'){
  const fork=applyClip(project,index,{kind:'fork',refId:command.refId!,name:command.name!});
  return {next:fork.project,result:{clipId:fork.ref!.clipId,refId:fork.ref!.id}};
 }
 const clip=project.clips?.find(c=>c.id===command.clipId);
 if(!clip)throw Error('Unknown clipId. Inspect workspace.clips.');
 if(command.action==='assign_clip'){
  const rows=sceneRows(project),scene=rows.find(s=>s.id===command.sceneId);
  if(!scene)throw Error('Unknown sceneId');
  const previous=scene.slots.find(s=>s.trackId===track.id);
  if(previous&&previous.clipId!==clip.id)throw Error('Session slot is occupied');
  const result={sceneId:scene.id,trackId:track.id,clipId:clip.id};
  if(previous)return {result};
  const scenes=rows.map(s=>s===scene?{...s,slots:[...s.slots,{trackId:track.id,clipId:clip.id}]}:s);
  return {next:{...project,scenes},result};
 }
 if(command.action==='place_clip'){
  if(!Array.isArray(command.bars)||!command.bars.length||command.bars.length>512)throw Error('Supply 1 to 512 destination bars');
  let next=project;
  const references=command.bars.map(bar=>{
   const placed=applyClip(next,index,{kind:'insert',clipId:clip.id,start:barRange(project,bar).startTick});
   next=placed.project;
   return {bar,refId:placed.ref!.id};
  });
  return {next,result:{clipId:clip.id,trackId:track.id,references}};
 }
 const local=clipEditorProject(project,index,clip);
 const inspect=(p:Project)=>({...inspectNotes(p,index,command),trackId:track.id,rangeRule:'Note onset in [startTick,endTick) measured from the clip start.',clipId:clip.id,units:'clip-local ticks',lengthTicks:clip.length});
 if(command.action==='inspect_notes')return {result:inspect(local)};
 if(!['edit_notes','transpose_notes','transform_notes'].includes(command.action))throw Error('Unsupported clip command');
 const edit=command.action==='transform_notes'?transformNotes(local,index,{...command,bar:command.bar!,revision:command.revision??'',operation:command.operation!}):{...command,revision:command.revision??''};
 const changed=command.action==='transpose_notes'?transposeNotes(local,index,{revision:edit.revision,semitones:command.semitones!}):editNotes(local,index,{...edit,bar:noteEditBar(local,index,edit)});
 const next=replaceClipEvents(project,clip.id,changed.project.tracks[index].events);
 const saved=next.clips!.find(c=>c.id===clip.id)!;
 return {next,result:{...inspect(clipEditorProject(next,index,saved)),added:changed.added,updated:changed.updated,removed:changed.removed}};
}
