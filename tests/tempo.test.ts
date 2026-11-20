import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '../src/model/project.ts';
import {tempoMap,tickToSeconds,timeline} from '../src/model/project.ts';
import {secondsToTick} from '../src/model/automation.ts';
import {History,packFile,parseFile,validateSession,type Session} from '../src/model/session.ts';
import * as api from '../src/model/tempo.ts';
function available(){return api;}
const base=():Project=>({title:'Tempo',schema:'test',timing:{ppqn:480,end_tick:960,default_tempo_us_per_quarter:500000},global_events:[{tick:480,order:0,kind:'meta',type:81,data:[15,66,64]}],tracks:[{id:'a',name:'A',midi_channel:1,gain:1,pan:0,mute:false,solo:false,events:[{tick:480,order:0,kind:'midi',status:144,data:[60,90]},{tick:960,order:1,kind:'midi',status:128,data:[60,0]}]}]});
test('BPM display follows the original tempo changes until an override is set',()=>{
 const {bpmAtTick,withTempo}=available(),p=base();assert.equal(bpmAtTick(p,0),120);assert.equal(bpmAtTick(p,480),60);
 const next=withTempo(p,90);assert.equal(bpmAtTick(next,480),90);assert.equal(tempoMap(next).length,1);assert.equal(tickToSeconds(next,960),4/3);
 assert.deepEqual(p,base());assert.equal(next.global_events,p.global_events);assert.equal(next.tracks,p.tracks);
 assert.deepEqual(timeline(next).map(e=>e.tick),[480,960]);
});
test('restoring MIDI tempo retains all original tempo events and note timing',()=>{
 const {withTempo}=available(),p=base(),next=withTempo(withTempo(p,140),null);assert.deepEqual(next,p);assert.equal(tickToSeconds(next,960),1.5);
});
test('tempo changes preserve musical position rather than elapsed seconds',()=>{
 const {withTempo,retimePosition}=available(),p=base(),next=withTempo(p,120),position=retimePosition(p,next,1);
 assert.equal(position,.75);assert.equal(secondsToTick(next,position),720);
 assert.equal(retimePosition(p,next,999),1);
});
test('invalid BPM fails atomically and fractional BPM is preserved to two decimals',()=>{
 const {withTempo}=available(),p=base();for(const value of [0,19.99,300.01,NaN,Infinity,'120',undefined])assert.throws(()=>withTempo(p,value));
 assert.equal(withTempo(p,123.456).timing.bpm,123.46);assert.deepEqual(p,base());
});
test('tempo overrides round-trip with history and imported invalid values are rejected',()=>{
 const {withTempo}=available();const session=(project:Project):Session=>({project,voices:[{code:'process = _;',values:{},trim:1,basePan:0}],chains:[[],[],[],[]],sends:[{delay:0,reverb:0}],buses:Array.from({length:3},()=>({level:1,muted:false}))});
 const before=session(base()),after=session(withTempo(base(),137.5)),h=new History();h.push(before,after,'BPM','user');
 const saved=parseFile(JSON.stringify(packFile(after,h)));assert.equal(saved.session.project.timing.bpm,137.5);assert.equal(saved.history.entries[0].before.project.timing.bpm,undefined);
 const bad=structuredClone(after);bad.project.timing.bpm=0;assert.throws(()=>validateSession(bad));
});
function ramp(interpolation:'linear'|'step'='linear'):Project{return {...base(),automation:[{id:'tempo',trackId:'master',device:'mixer',address:'bpm',label:'BPM',min:20,max:300,step:.01,scale:'linear',mode:'read',interpolation,points:[{tick:0,value:100/280},{tick:960,value:220/280}]}]};}
test('linear BPM automation integrates beat duration and inverts precisely',()=>{const p=ramp();assert.ok(Math.abs(tickToSeconds(p,960)-Math.log(2))<1e-10);assert.equal(api.bpmAtTick(p,480),180);for(const tick of [0,1,200,480,959,960])assert.ok(Math.abs(secondsToTick(p,tickToSeconds(p,tick))-tick)<1e-8);assert.equal(timeline(p)[0].seconds,tickToSeconds(p,480));});
test('step tempo and disabled automation preserve their intended timing',()=>{assert.equal(tickToSeconds(ramp('step'),960),1);const p=ramp();p.automation![0].mode='off';assert.equal(tickToSeconds(p,960),1.5);});
test('manual tempo keeps automation points and disables the lane until Read resumes it',()=>{const p=ramp(),next=api.withTempo(p,137);assert.equal(next.automation![0].mode,'off');assert.deepEqual(next.automation![0].points,p.automation![0].points);assert.equal(api.bpmAtTick(next,480),137);assert.equal(p.automation![0].mode,'read');const resumed={...next,automation:next.automation!.map(l=>({...l,mode:'read' as const}))};assert.equal(api.bpmAtTick(resumed,480),180);});
test('decelerating tempo ramps, delayed first point, and imported bounds remain valid',()=>{const p=ramp();p.automation![0].points=[{tick:240,value:220/280},{tick:960,value:100/280}];assert.equal(api.bpmAtTick(p,0),240);assert.equal(tickToSeconds(p,240),.125);for(const tick of [0,239,240,400,800,960])assert.ok(Math.abs(secondsToTick(p,tickToSeconds(p,tick))-tick)<1e-8);});
