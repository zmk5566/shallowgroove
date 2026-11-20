// Git stores editable musical sources. project.json is the local working snapshot.
const {isDeepStrictEqual}=require('node:util');
const {checkProjectVersion}=require('../src/model/project-version.mjs');
const {pathFor,placed,joinSources:join}=require('../src/model/music-sources.mjs');
function split(text){
 const doc=JSON.parse(text);checkProjectVersion(doc);
 const {project,voices,chains,sends,buses}=doc.session;
 const {tracks,clips=[],scenes,...song}=project;
 const files=new Map(),json=(file,value)=>files.set(file,JSON.stringify(value,null,2)+'\n');
 const packed=doc.encoding==='asset-table';
 function device(p,group,id){
  const {code,...values}=p;
  files.set(pathFor(group,id,'dsp'),packed?doc.sources[code]:code);
  return values;
 }
 const effectChains=chains.map((chain,i)=>chain.map(effect=>{
  const key=JSON.stringify([i<tracks.length?'track':'bus',tracks[i]?.id??i-tracks.length,effect.id]);
  json(pathFor('effects',key),device(effect,'effects',key));return key;
 }));
 for(const clip of clips)json(pathFor('clips',clip.id),clip);
 for(const scene of scenes??[])json(pathFor('scenes',scene.id),scene);
 tracks.forEach((track,i)=>{
  const events=packed?doc.midi[track.events]:track.events;
  const refs=new Map(track.clipRefs?.map(r=>[r.id,r])),byClip=new Map(clips.map(c=>[c.id,c])),counts=new Map();
  const encoded=events.map(e=>{
   const ref=refs.get(e.clipRef),clip=byClip.get(ref?.clipId);
   if(!clip)return e;
   const index=counts.get(ref.id)??0;counts.set(ref.id,index+1);
   return clip.events[index]&&isDeepStrictEqual(placed(clip.events[index],ref,clip,track,e.order),e)?[ref.id,index,e.order]:e;
  });
  json(pathFor('tracks',track.id),{track:{...track,events:encoded},instrument:device(voices[i],'instruments',track.id),effects:effectChains[i],send:sends[i]});
 });
 const {conversationProject,...editor}=doc.editor??{};
 json('music/project.json',{layout:1,format:doc.format,version:doc.version,savedWith:doc.savedWith,minAppVersion:doc.minAppVersion,name:doc.name,editor:doc.editor?editor:undefined,
  song:{...song,global_events:packed?doc.midi[song.global_events]:song.global_events},tracks:tracks.map(t=>t.id),clips:project.clips?.map(c=>c.id),scenes:scenes?.map(s=>s.id),busChains:effectChains.slice(tracks.length),buses});
 return files;
}
module.exports={split,join};
