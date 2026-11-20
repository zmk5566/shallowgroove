import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '../src/model/project.ts';
import {notesOf,timeline} from '../src/model/project.ts';
import {History,packFile,parseFile,type Session} from '../src/model/session.ts';
import * as api from '../src/model/notes.ts';
function available(){return api;}
const base=():Project=>({schema:'test',title:'Notes',timing:{ppqn:480,end_tick:1920,default_tempo_us_per_quarter:500000},global_events:[],tracks:[{id:'track-a',name:'Bass',midi_channel:2,events:[{tick:0,order:0,kind:'channel',status:177,channel:2,data:[7,100]}],gain:1,pan:0,mute:false,solo:false}]});
test('adding notes produces playable MIDI on the track channel and extends the project',()=>{
 const {inspectNotes,editNotes}=available(),p=base(),before=structuredClone(p);
 const next=editNotes(p,0,{revision:inspectNotes(p,0).revision,add:[{tick:1920,end:2400,pitch:36,velocity:90}]}).project;
 assert.deepEqual(p,before);assert.equal(next.timing.end_tick,2400);
 assert.deepEqual(notesOf(next.tracks[0],2400),[{tick:1920,end:2400,pitch:36,velocity:90}]);
 assert.deepEqual(timeline(next).filter(e=>(e.status!>>4)===9).map(e=>[e.seconds,e.status,e.data]),[[2,145,[36,90]]]);
 assert.deepEqual(next.tracks[0].events[0].data,[7,100]);
});
test('inspection pages notes and returns musical positions without changing events',()=>{
 const {inspectNotes,editNotes}=available(),p=base();p.global_events=[{tick:0,order:0,kind:'meta',type:88,data:[3,2,24,8]}];
 const next=editNotes(p,0,{revision:inspectNotes(p,0).revision,add:[{tick:0,end:480,pitch:60,velocity:90},{tick:1440,end:1920,pitch:64,velocity:80}]}).project;
 const page=inspectNotes(next,0,{offset:1,limit:1});assert.equal(page.total,2);assert.equal(page.notes[0].pitch,64);assert.equal(page.notes[0].position.bar,2);assert.equal(page.notes[0].position.beat,1);assert.equal(page.nextOffset,null);
 assert.equal(inspectNotes(next,0,{startTick:480,endTick:1440}).total,0);
});
test('batch update and remove affect only referenced notes; stale revision fails atomically',()=>{
 const {inspectNotes,editNotes}=available(),p=base();
 const first=editNotes(p,0,{revision:inspectNotes(p,0).revision,add:[{tick:0,end:480,pitch:60,velocity:90},{tick:480,end:960,pitch:64,velocity:80}]}).project;
 const view=inspectNotes(first,0),before=structuredClone(first);
 const next=editNotes(first,0,{revision:view.revision,update:[{id:view.notes[0].id,pitch:72,end:720,velocity:70}],remove:[view.notes[1].id]}).project;
 assert.deepEqual(notesOf(next.tracks[0],1920),[{tick:0,end:720,pitch:72,velocity:70}]);assert.deepEqual(first,before);
 assert.throws(()=>editNotes(next,0,{revision:view.revision,remove:[view.notes[0].id]}),/changed|revision/i);
 assert.throws(()=>editNotes(first,0,{revision:view.revision,remove:['unknown']}),/Unknown/i);assert.deepEqual(first,before);
});
test('invalid numeric fields, duplicate targets and ambiguous overlaps are rejected',()=>{
 const {inspectNotes,editNotes}=available(),p=base(),revision=inspectNotes(p,0).revision;
 for(const patch of [{tick:-1},{tick:0.5},{end:0},{pitch:128},{velocity:0},{end:Infinity}])assert.throws(()=>editNotes(p,0,{revision,add:[{tick:0,end:480,pitch:60,velocity:90,...patch}]}));
 assert.throws(()=>editNotes(p,0,{revision,add:[{tick:0,end:480,pitch:60,velocity:90},{tick:240,end:720,pitch:60,velocity:80}]}),/overlap/i);
 const next=editNotes(p,0,{revision,add:[{tick:0,end:480,pitch:60,velocity:90}]}).project,view=inspectNotes(next,0);
 assert.throws(()=>editNotes(next,0,{revision:view.revision,update:[{id:view.notes[0].id,pitch:62}],remove:[view.notes[0].id]}),/duplicate/i);
});
test('adjacent repeated notes release before retrigger at the same tick',()=>{
 const {inspectNotes,editNotes}=available(),p=base();
 const next=editNotes(p,0,{revision:inspectNotes(p,0).revision,add:[{tick:480,end:960,pitch:60,velocity:90},{tick:0,end:480,pitch:60,velocity:80}]}).project;
 assert.deepEqual(timeline(next).filter(e=>e.tick===480).map(e=>e.status!>>4),[8,9]);
 assert.deepEqual(notesOf(next.tracks[0],1920).map(n=>[n.tick,n.end]),[[0,480],[480,960]]);
});
test('legacy zero-velocity offs, overlapping and unclosed notes remain inspectable',()=>{
 const {inspectNotes,editNotes}=available(),p=base();p.tracks[0].events.push(...[
 {tick:0,order:1,kind:'channel',status:145,data:[60,90]}, {tick:240,order:2,kind:'channel',status:145,data:[60,80]},
 {tick:480,order:3,kind:'channel',status:145,data:[60,0]}, {tick:720,order:4,kind:'channel',status:129,data:[60,0]},
 {tick:960,order:5,kind:'channel',status:145,data:[67,70]}]);
 const view=inspectNotes(p,0);assert.deepEqual(view.notes.map(n=>[n.tick,n.end,n.closed]),[[0,480,true],[240,720,true],[960,1920,false]]);
 const next=editNotes(p,0,{revision:view.revision,update:[{id:view.notes[2].id,end:1440}]}).project;
 assert.equal(inspectNotes(next,0).notes[2].closed,true);assert.equal(inspectNotes(next,0).notes[2].end,1440);
});
test('edited events and project length survive history and portable project round-trip',()=>{
 const {inspectNotes,editNotes}=available(),p=base();const before:Session={project:p,voices:[{code:'process = _;',values:{},trim:1,basePan:0}],chains:[[],[],[],[]],sends:[{delay:0,reverb:0}],buses:Array.from({length:3},()=>({level:1,muted:false}))};
 const after={...before,project:editNotes(p,0,{revision:inspectNotes(p,0).revision,add:[{tick:1920,end:2880,pitch:48,velocity:100}]}).project};
 const h=new History();h.push(before,after,'Notes','assistant');const restored=parseFile(JSON.stringify(packFile(after,h)));
 assert.equal(restored.history.entries[0].before.project.tracks[0].events.length,1);assert.equal(restored.session.project.timing.end_tick,2880);assert.deepEqual(notesOf(restored.session.project.tracks[0],2880),[{tick:1920,end:2880,pitch:48,velocity:100}]);
});
test('legacy same-tick on/off ordering is preserved when adding unrelated notes',()=>{
 const {inspectNotes,editNotes}=available(),p=base();p.tracks[0].events.push({tick:0,order:1,kind:'channel',status:145,data:[60,90]},{tick:0,order:2,kind:'channel',status:129,data:[60,0]});
 const next=editNotes(p,0,{revision:inspectNotes(p,0).revision,add:[{tick:0,end:480,pitch:64,velocity:90}]}).project;
 assert.deepEqual(inspectNotes(next,0).notes.map(n=>[n.pitch,n.end,n.closed]),[[60,0,true],[64,480,true]]);
});
test('unmatched legacy note-offs cannot silently truncate newly added notes',()=>{
 const {inspectNotes,editNotes}=available(),p=base();p.tracks[0].events.push({tick:240,order:1,kind:'channel',status:129,data:[60,0]});
 assert.throws(()=>editNotes(p,0,{revision:inspectNotes(p,0).revision,add:[{tick:0,end:480,pitch:60,velocity:90}]}),/ambiguous|unmatched/i);
});
test('manual editor snapshot includes notes beyond assistant pagination',async()=>{
 const {noteSnapshot}=await import('../src/model/notes.ts'),p=base();
 p.timing.end_tick=1200;p.tracks[0].events=Array.from({length:600},(_,i)=>[{tick:i*2,order:i*2,kind:'midi',status:145,data:[60,90]},{tick:i*2+1,order:i*2+1,kind:'midi',status:129,data:[60,0]}]).flat();
 const view=noteSnapshot(p,0);assert.equal(view.notes.length,600);assert.equal(view.notes[599].tick,1198);assert.equal(view.notes[599].end,1199);
});
test('bulk transpose handles 1584 notes atomically without pagination and preserves source MIDI',()=>{const p=base();for(let i=0;i<1584;i++)p.tracks[0].events.push({tick:i*24,order:i*2+1,kind:'midi',status:145,data:[72+i%16,90]},{tick:i*24+14,order:i*2+2,kind:'midi',status:129,data:[72+i%16,0]});p.timing.end_tick=40000;const original=structuredClone(p),summary=api.inspectNotes(p,0,{summaryOnly:true});assert.equal(summary.notes.length,0);assert.equal(summary.trackTotal,1584);assert.deepEqual(summary.pitchRange,[72,87]);const result=api.transposeNotes(p,0,{revision:summary.revision,semitones:-12});assert.equal(result.updated,1584);assert.deepEqual(api.inspectNotes(result.project,0,{summaryOnly:true}).pitchRange,[60,75]);assert.deepEqual(p,original);assert.equal(result.project.tracks[0].events[0],p.tracks[0].events[0]);assert.throws(()=>api.transposeNotes(result.project,0,{revision:summary.revision,semitones:-12}),/revision|changed/i);});
test('transpose rejects out-of-range pitches atomically and preserves overlapping notes and release encoding',()=>{const p=base();p.tracks[0].events.push({tick:0,order:1,kind:'midi',status:145,data:[60,90]},{tick:1,order:2,kind:'midi',status:145,data:[60,80]},{tick:2,order:3,kind:'midi',status:161,data:[60,50]},{tick:100,order:4,kind:'midi',status:145,data:[60,0]},{tick:110,order:5,kind:'midi',status:129,data:[60,44]});const revision=api.inspectNotes(p,0).revision;for(const semitones of [-61,68,1.5,NaN])assert.throws(()=>api.transposeNotes(p,0,{revision,semitones}));const result=api.transposeNotes(p,0,{revision,semitones:12});assert.deepEqual(result.project.tracks[0].events.slice(1).map(e=>e.data),[[72,90],[72,80],[72,50],[72,0],[72,44]]);assert.deepEqual(result.project.tracks[0].events.map(e=>[e.tick,e.order,e.status]),p.tracks[0].events.map(e=>[e.tick,e.order,e.status]));});
test('bar inspection respects meter changes and excludes the next bar onset',()=>{const p=base();p.timing.end_tick=4000;p.global_events=[{tick:2400,order:0,kind:'meta',type:88,data:[3,2,24,8]}];p.tracks[0].events.push(...[1920,2399,2400,3839,3840].map((tick,i)=>({tick,order:i+1,kind:'midi',status:145,data:[60+i,80]})));const second=api.inspectNotes(p,0,{bar:2});assert.deepEqual(second.notes.map(n=>n.tick),[1920,2399]);assert.deepEqual(second.barRange,{bar:2,startTick:1920,endTick:2400});assert.deepEqual(api.inspectNotes(p,0,{bar:3}).notes.map(n=>n.tick),[2400,3839]);assert.throws(()=>api.inspectNotes(p,0,{bar:0}));assert.throws(()=>api.inspectNotes(p,0,{bar:2,startTick:0}));});
test('assistant local edits must stay in one bar while sustained tails can cross a boundary',()=>{const p=base();p.timing.end_tick=5760;const first=api.editNotes(p,0,{revision:api.inspectNotes(p,0).revision,add:[{tick:1800,end:2100,pitch:60,velocity:90},{tick:2000,end:2300,pitch:64,velocity:90}]}).project;const snap=api.inspectNotes(first,0),revision=snap.revision;assert.equal(api.noteEditBar(first,0,{revision,update:[{id:snap.notes[0].id,velocity:80}]}),1);assert.throws(()=>api.noteEditBar(first,0,{revision,update:snap.notes.map(n=>({id:n.id,velocity:80}))}),/bar/i);assert.throws(()=>api.noteEditBar(first,0,{revision,update:[{id:snap.notes[0].id,tick:1920}]}),/bar/i);assert.throws(()=>api.noteEditBar(first,0,{revision,bar:2,update:[{id:snap.notes[0].id,velocity:80}]}),/bar/i);});
