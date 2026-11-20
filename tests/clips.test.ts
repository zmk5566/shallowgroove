import test from 'node:test';
import assert from 'node:assert/strict';
import {applyClip,copyBars,renameClip,validateClips} from '../src/model/clips.ts';
import {editNotes,noteSnapshot,transposeNotes} from '../src/model/notes.ts';
import {emptyProject} from '../src/model/project-files.ts';
import {timeline} from '../src/model/project.ts';
import {packFile,parseFile,History,type Session} from '../src/model/session.ts';

function fixture(){
 const p=emptyProject();
 p.tracks[0].events=[
  {kind:'midi',channel:1,status:144,tick:60,order:0,data:[60,90]},
  {kind:'midi',channel:1,status:128,tick:144,order:1,data:[60,12]},
  {kind:'midi',channel:1,status:176,tick:200,order:2,data:[1,77]},
  {kind:'midi',channel:1,status:144,tick:400,order:3,data:[64,90]},
  {kind:'midi',channel:1,status:128,tick:520,order:4,data:[64,9]}];
 return p;
}
function root(){return applyClip(fixture(),0,{kind:'create',name:'A',start:0,end:480});}
test('clip creation keeps audible MIDI, silence, controller order and the whole note tail',()=>{
 const {project,ref}=root();validateClips(project);
 assert.deepEqual(timeline(project).map(({clipRef,...event})=>event),timeline(fixture()));
 assert.equal(project.clips[0].length,480);
 assert.equal(project.clips[0].events.at(-1)?.tick,520);
 assert.equal(ref?.start,0);
});
test('an edit through any linked placement changes its source and peers, forks retain their base',()=>{
 const {project:p,ref:first}=root();
 const {project:two,ref:second}=applyClip(p,0,{kind:'insert',clipId:first!.clipId,start:960});
 const full=noteSnapshot(two,0);
 const edited=editNotes(two,0,{revision:full.revision,update:[{id:full.notes.find(n=>n.tick===1020)!.id,pitch:66}]}).project;
 validateClips(edited);
 assert.deepEqual(noteSnapshot(edited,0).notes.filter(n=>n.pitch===66).map(n=>n.tick),[60,1020]);
 const {project:forked,ref:child}=applyClip(edited,0,{kind:'fork',refId:second!.id,name:'A1'});
 const {project:three,ref:other}=applyClip(forked,0,{kind:'insert',clipId:child!.clipId,start:1920});
 const {project:deep,ref:grand}=applyClip(three,0,{kind:'fork',refId:other!.id,name:'A1a'});
 const next=editNotes(deep,0,{revision:noteSnapshot(deep,0).revision,add:[{tick:1050,end:1100,pitch:72,velocity:100}]}).project;
 validateClips(next);
 assert.deepEqual(noteSnapshot(next,0).notes.filter(n=>n.pitch===72).map(n=>n.tick),[1050]);
 assert.equal(next.clips!.find(c=>c.id===grand!.clipId)?.source?.id,child!.clipId);
 assert.deepEqual(next.clips![2].source!.events,deep.clips[1].events);
 const switched=applyClip(next,0,{kind:'switch',refId:grand!.id,clipId:child!.clipId}).project;
 validateClips(switched);assert.deepEqual(noteSnapshot(switched,0).notes.filter(n=>n.pitch===72).map(n=>n.tick),[1050,2010]);
});
test('independent copies and other-track references retain their own MIDI channel',()=>{
 const {project:p,ref}=root();
 p.tracks.push({...emptyProject().tracks[0],midi_channel:5});
 const linked=applyClip(p,1,{kind:'insert',clipId:ref!.clipId,start:1920}).project;
 const copied=copyBars(linked,0,0,480,3840);
 const next=transposeNotes(copied,1,{revision:noteSnapshot(copied,1).revision,semitones:2}).project;
 validateClips(next);
 assert.deepEqual(noteSnapshot(next,0).notes.map(n=>n.pitch),[62,66,60,64]);
 assert.equal(noteSnapshot(next,1).notes[0].midiChannel,5);
 assert.throws(()=>applyClip(next,0,{kind:'insert',clipId:ref!.clipId,start:0}),/overlap/);
});
test('project and undo history round trip; malformed ancestry and divergent materialized notes fail validation',()=>{
 const {project,ref}=root();
 const session=(p:typeof project):Session=>({project:p,voices:[{code:'',values:{},basePan:0,trim:1}],chains:[[],[],[],[]],sends:[{delay:0,reverb:0}],buses:Array.from({length:3},()=>({muted:false,level:1}))});
 const fork=applyClip(project,0,{kind:'fork',refId:ref!.id,name:'B'}).project;
 const h=new History();h.push(session(project),session(fork),'Fork','user');
 const parsed=parseFile(JSON.stringify(packFile(session(fork),h)));
 assert.deepEqual(parsed.session,session(fork));assert.deepEqual(parsed.history.entries[0].before,session(project));
 const bad=structuredClone(fork);bad.clips[1].source!.id=bad.clips[1].id;
 assert.throws(()=>validateClips(bad));
 // Serialization makes event arrays and source arrays independent.
 const saved=JSON.parse(JSON.stringify(fork));saved.tracks[0].events[0].data[0]++;
 assert.throws(()=>validateClips(saved));validateClips(fixture());
});
test('fork invalidates the old editor revision even when the audible notes are identical',()=>{
 const {project,ref}=root();
 const revision=noteSnapshot(project,0).revision;
 const fork=applyClip(project,0,{kind:'fork',refId:ref!.id,name:'variation'}).project;
 assert.throws(()=>editNotes(fork,0,{revision,remove:['note:0']}),/revision/);
});
test('a silent selection keeps its length, and a later reference edit populates the original',()=>{
 const {project,ref}=applyClip(emptyProject(),0,{kind:'create',name:'rest',start:0,end:1920});
 const two=applyClip(project,0,{kind:'insert',clipId:ref!.clipId,start:1920}).project;
 const next=editNotes(two,0,{revision:noteSnapshot(two,0).revision,add:[{tick:1920,end:1960,pitch:50,velocity:90}]}).project;
 assert.deepEqual(noteSnapshot(next,0).notes.map(n=>n.tick),[0,1920]);validateClips(next);
});

test('rename changes the shared clip name and preserves arrangement, scene and fork identities',()=>{
 const {project,ref}=root();
 const second=applyClip(project,0,{kind:'insert',clipId:ref!.clipId,start:960});
 const fork=applyClip(second.project,0,{kind:'fork',refId:second.ref!.id,name:'Fill'});
 const before={...fork.project,scenes:[{id:'intro',name:'Intro',slots:[{trackId:project.tracks[0].id,clipId:ref!.clipId}]}]};
 const next=renameClip(before,ref!.clipId,'  鼓组  ');
 assert.equal(next.clips![0].name,'鼓组');assert.equal(next.clips![1].name,'Fill');
 assert.equal(next.tracks,before.tracks);assert.equal(next.scenes,before.scenes);
 assert.equal(before.clips[0].name,'A');assert.throws(()=>renameClip(next,ref!.clipId,' '));
 assert.equal(renameClip(next,ref!.clipId,'鼓组'),next);
});
