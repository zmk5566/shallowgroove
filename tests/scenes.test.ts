import {LiveClips} from '../src/audio/live-clips.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProject} from '../src/model/project-files.ts';
import {applyClip,clipEditorProject,replaceClipEvents} from '../src/model/clips.ts';
import {editNotes,noteSnapshot} from '../src/model/notes.ts';
import {fillArrangementSlots,sceneLaunches,createSlotClip,sceneRows,validateScenes} from '../src/model/scenes.ts';
import {packFile,parseFile,type Session} from '../src/model/session.ts';

test('scene slots share sources across tracks, survive a save, and allow clip-local editing',()=>{
 const {project,ref}=applyClip(emptyProject(),0,{kind:'create',name:'Beat',start:480,end:960});
 project.tracks.push({...emptyProject().tracks[0],midi_channel:2});
 const source=project.clips[0],track=project.tracks[1];
 const p={...project,scenes:[{id:'verse',name:'Verse',slots:[{trackId:track.id,clipId:source.id}]}]};
 const editor=clipEditorProject(p,1,source),revision=noteSnapshot(editor,1).revision;
 const edited=editNotes(editor,1,{revision,add:[{tick:48,end:96,pitch:50,velocity:64}]});
 const next=replaceClipEvents(p,source.id,edited.project.tracks[1].events);
 assert.equal(next.tracks[1].events.length,0);
 assert.equal(next.tracks[0].events[0].clipRef,ref!.id);
 assert.equal(next.tracks[0].events[0].tick,528);
 const session:Session={project:next,voices:next.tracks.map(()=>({code:'',values:{},trim:1,basePan:0})),sends:next.tracks.map(()=>({delay:0,reverb:0})),chains:Array.from({length:5},()=>[]),buses:Array.from({length:3},()=>({level:1,muted:false}))};
 assert.deepEqual(parseFile(JSON.stringify(packFile(session))).session,session);
 assert.throws(()=>validateScenes({...next,scenes:[{...p.scenes[0],slots:[{trackId:'absent',clipId:source.id}]}]}));
 assert.throws(()=>validateScenes({...next,scenes:[{...p.scenes[0],slots:[{trackId:track.id,clipId:'absent'}]}]}));
 assert.equal(sceneRows(emptyProject())[0].slots.length,0);
});

test('create an empty session clip by bar length and edit it directly without an arrangement placement',()=>{
 const p=emptyProject(),track=p.tracks[0];
 p.global_events[0].data=[3,2,24,8];
 const {project,clip}=createSlotClip(p,'scene-1',track.id,2);
 assert.equal(clip.length,6*p.timing.ppqn);
 assert.equal(project.tracks[0],track);
 assert.deepEqual(sceneRows(project)[0].slots,[{trackId:track.id,clipId:clip.id}]);
 const editor=clipEditorProject(project,0,clip);
 assert.equal(editor.timing.end_tick,clip.length);
 const edit=editNotes(editor,0,{revision:noteSnapshot(editor,0).revision,add:[{tick:0,end:480,pitch:60,velocity:90}]});
 const result=replaceClipEvents(project,clip.id,edit.project.tracks[0].events);
 assert.equal(result.clips![0].events.length,2);assert.equal(result.tracks[0].events.length,0);
 validateScenes(result);
 for(const bars of [0,1.5,NaN])assert.throws(()=>createSlotClip(p,'scene-1',track.id,bars));
 assert.throws(()=>createSlotClip(result,'scene-1',track.id,2),/occupied/);
});

test('auto-slot new variations, preserve removals on repeat placements, backfill legacy refs in time order',()=>{
 const initial=emptyProject(),track=initial.tracks[0].id;
 const late=applyClip(initial,0,{kind:'create',name:'Late',start:480,end:960});
 const early=applyClip(late.project,0,{kind:'create',name:'Early',start:0,end:480});
 const fork=applyClip(early.project,0,{kind:'fork',refId:late.ref!.id,name:'Variation'});
 assert.deepEqual(sceneRows(fork.project).map(row=>row.slots[0].clipId),[late.ref!.clipId,early.ref!.clipId,fork.ref!.clipId]);
 const cleared={...fork.project,scenes:[{id:'custom',name:'Intro',slots:[]}]};
 const repeated=applyClip(cleared,0,{kind:'insert',clipId:early.ref!.clipId,start:960}).project;
 assert.deepEqual(repeated.scenes,cleared.scenes);
 const rows=fillArrangementSlots(repeated);
 assert.equal(rows[0].name,'Intro');
 assert.deepEqual(rows.map(row=>row.slots),[early.ref!,fork.ref!].map(ref=>[{trackId:track,clipId:ref.clipId}]));
 assert.equal(fillArrangementSlots({...repeated,scenes:rows}),rows);
});

test('launching an empty scene slot silences its track until explicitly returned to arrangement',()=>{
 const p=emptyProject();
 const created=createSlotClip(p,'scene-1',p.tracks[0].id,1);
 const silent={id:'break',name:'Break',slots:[]};
 const [playing]=sceneLaunches(created.project,sceneRows(created.project)[0]);
 const [empty]=sceneLaunches(created.project,silent);
 const live=new LiveClips();
 live.queue(0,playing.launch,0);
 live.render(0,480,()=>{},()=>{});
 live.queue(0,empty.launch,480);
 assert.equal(live.state(0,479).active?.clip?.id,created.clip.id);
 const boundaries:number[]=[];
 live.render(480,1440,()=>assert.fail('empty slot emitted MIDI'),(_,tick)=>boundaries.push(tick));
 assert.deepEqual(boundaries,[480]);
 assert.equal(live.owns(0,1000),true);
 assert.equal(live.state(0,1000).active?.clip,null);
 live.queue(0,null,1440);
 assert.equal(live.owns(0,1440),false);
});
