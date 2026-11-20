import {barRange} from './meter.ts';
import type {Project} from './project';
export type SceneSlot={trackId:string;clipId:string};
export type Scene={id:string;name:string;slots:SceneSlot[]};
export function sceneRows(project:Project):Scene[]{
 return project.scenes??[{id:'scene-1',name:'1',slots:[]}];
}
export function sceneLaunches(project:Project,scene:Scene,onlyTrack?:string){
 return project.tracks.flatMap((track,index)=>{
  if(onlyTrack!==undefined&&track.id!==onlyTrack)return [];
  const slot=scene.slots.find(s=>s.trackId===track.id);
  const clip=slot?project.clips?.find(c=>c.id===slot.clipId):null;
  return [{track:index,launch:{sceneId:scene.id,channel:track.midi_channel,clip:clip??null}}];
 });
}
// Fill empty cells in row order. Other tracks can share those same scenes.
function fillTrack(rows:Scene[],trackId:string,ids:Iterable<string>){
 const used=new Set(rows.flatMap(row=>row.slots.filter(s=>s.trackId===trackId).map(s=>s.clipId)));
 const missing=[...new Set(ids)].filter(id=>!used.has(id));
 if(!missing.length)return rows;
 let index=0;
 const next=rows.map(row=>{
  if(index===missing.length||row.slots.some(s=>s.trackId===trackId))return row;
  return {...row,slots:[...row.slots,{trackId,clipId:missing[index++]}]};
 });
 while(index<missing.length){
  next.push({id:crypto.randomUUID(),name:String(next.length+1),slots:[{trackId,clipId:missing[index++]}]});
 }
 return next;
}

export function defaultClipSlot(project:Project,trackId:string,clipId:string){
 return fillTrack(sceneRows(project),trackId,[clipId]);
}

export function fillArrangementSlots(project:Project){
 let rows=sceneRows(project);
 for(const track of project.tracks){
  const refs=[...(track.clipRefs??[])].sort((a,b)=>a.start-b.start);
  rows=fillTrack(rows,track.id,refs.map(ref=>ref.clipId));
 }
 return rows;
}

export function createSlotClip(project:Project,sceneId:string|undefined,trackId:string,bars:number){
 const track=project.tracks.find(t=>t.id===trackId);
 if(!track)throw Error('Unknown track');
 if(!Number.isSafeInteger(bars)||bars<1)throw Error('请输入正整数小节数 / Enter a positive whole number of bars');
 const length=Math.round(barRange(project,bars).endTick);
 if(length<1)throw Error('Invalid clip length');
 const clips=project.clips??[];
 const clip={id:crypto.randomUUID(),name:`Clip ${clips.length+1}`,channel:track.midi_channel,length,events:[]};
 const rows=sceneRows(project);
 const target=rows.find(row=>row.id===sceneId);
 if(sceneId!==undefined&&!target)throw Error('槽位已不存在 / Slot no longer exists');
 if(target?.slots.some(s=>s.trackId===trackId))throw Error('槽位已有 Clip / Slot is occupied');
 const scenes=target?rows.map(row=>row===target?{...row,slots:[...row.slots,{trackId,clipId:clip.id}]}:row):fillTrack(rows,trackId,[clip.id]);
 const assigned=scenes.find(row=>row.slots.some(s=>s.trackId===trackId&&s.clipId===clip.id))!;
 return {project:{...project,clips:[...clips,clip],scenes},clip,sceneId:assigned.id};
}
export function validateScenes(p:Project){
 if(p.scenes===undefined)return;
 const ids=new Set<string>(),tracks=new Set(p.tracks.map(t=>t.id)),clips=new Set(p.clips?.map(c=>c.id));
 if(!Array.isArray(p.scenes))throw Error('Invalid scenes');
 for(const scene of p.scenes){
  if(!scene||typeof scene.id!=='string'||!scene.id||ids.has(scene.id)||typeof scene.name!=='string'||!Array.isArray(scene.slots))throw Error('Invalid scene');
  ids.add(scene.id);const assigned=new Set<string>();
  for(const slot of scene.slots){
   if(!slot||!tracks.has(slot.trackId)||!clips.has(slot.clipId)||assigned.has(slot.trackId))throw Error('Invalid scene slot');
   assigned.add(slot.trackId);
  }
 }
}
