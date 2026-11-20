import {checkProjectVersion} from './project-version.mjs';
export const sourcePath=/^music\/(?:(?:project|conversation)\.json|(?:tracks|scenes|clips|effects|instruments)\/[A-Za-z0-9_-]+\.(?:json|dsp))$/;
export function pathFor(group,id,ext='json'){
 const bytes=new TextEncoder().encode(id);
 let encoded='';for(const n of bytes)encoded+=String.fromCharCode(n);
 return 'music/'+group+'/'+btoa(encoded).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')+'.'+ext;
}
export function placed(e,ref,clip,track,order){
 const event={...e,tick:ref.start+e.tick,order,clipRef:ref.id};
 if(track.midi_channel!==clip.channel&&e.status!==undefined&&e.status<240){
  const channel=((e.status&15)+track.midi_channel-clip.channel+16)%16;
  event.status=(e.status&240)|channel;if(e.channel!==undefined)event.channel=channel+1;
 }
 return event;
}
export function joinSources(files){
 const read=p=>{if(!files.has(p))throw Error('Missing source: '+p);return files.get(p);};
 const json=p=>JSON.parse(read(p)),m=json('music/project.json');checkProjectVersion(m);
 if(m.layout!==1)throw Error('Unsupported music repository layout');
 const clips=m.clips?.map(id=>json(pathFor('clips',id))),byClip=new Map(clips?.map(c=>[c.id,c]));
 const voices=[],chains=[],sends=[];
 const effects=ids=>ids.map(id=>({...json(pathFor('effects',id)),code:read(pathFor('effects',id,'dsp'))}));
 const tracks=m.tracks.map(id=>{
  const {track,instrument,send,effects:ids}=json(pathFor('tracks',id));
  voices.push({...instrument,code:read(pathFor('instruments',id,'dsp'))});chains.push(effects(ids));sends.push(send);
  const refs=new Map(track.clipRefs?.map(r=>[r.id,r]));
  const events=track.events.map(entry=>{
   if(!Array.isArray(entry))return entry;
   const [refId,index,order]=entry,ref=refs.get(refId),clip=byClip.get(ref?.clipId),e=clip?.events[index];
   if(!e)throw Error('Invalid clip reference '+refId);
   return placed(e,ref,clip,track,order);
  });
  return {...track,events};
 });
 return JSON.stringify({format:m.format,version:m.version,savedWith:m.savedWith,minAppVersion:m.minAppVersion,name:m.name,editor:m.editor,
  conversation:files.has('music/conversation.json')?json('music/conversation.json'):undefined,session:{project:{...m.song,tracks,clips,scenes:m.scenes?.map(id=>json(pathFor('scenes',id)))},voices,chains:[...chains,...m.busChains.map(effects)],sends,buses:m.buses}});
}
