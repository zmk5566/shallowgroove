import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NativePreview,nativeGraph,nativeRackFile,nativeSequence,type NativeBridge} from '../src/audio/native-preview.ts';
import {bufferDuration,sameOutput,supportedOutput,systemOutput,type NativeOutput} from '../src/audio/native-output.ts';
import {NativeSession,projectSlot,sessionTiming} from '../src/audio/native-session.ts';
import type {AudioEngine} from '../src/audio/engine';
import {tickToSeconds} from '../src/model/project.ts';
import type {AutomationLane} from '../src/model/automation';

function fixture(){
 const track={id:'t1',gain:1,pan:0,mute:false,events:[
  {tick:120,order:0,status:144,data:[60,90]},
  {tick:240,order:1,status:128,data:[60,0]},
 ]};
 const project={tracks:[track],global_events:[],automation:[] as AutomationLane[],
  timing:{ppqn:480,end_tick:960,default_tempo_us_per_quarter:500000}};
 const control=(label:string)=>({address:'/Synth/'+label,label,min:0,max:1,init:0,step:.01});
 const fx={id:'fx1',code:'stereo',controls:[control('Gain')],values:{'/Synth/Gain':.5},bypassed:true};
 const rack={amounts:{delay:0,reverb:0},effects:[fx]};
 const voice={code:'instrument',values:{'/Synth/B':.6},trim:.5,basePan:.1,rack};
 const master={effects:[],level:.5,muted:false},returns={delay:{...master,level:.65},reverb:{...master,level:.7}};
 const tracks=[rack],voices=[voice];
 const raw={project,timingProject:{...project},voices,effects:{tracks,master,returns,
  chain:(t:number|'master'|'delay'|'reverb')=>typeof t==='number'?tracks[t]:t==='master'?master:returns[t]},
  describe:()=>[control('B'),control('A')],automationTarget:()=>({}),bpm:120};
 return {track,rack,project,engine:raw as unknown as AudioEngine};
}

test('multitrack projection preserves independent track FX, solo/mute, sends and master gain',()=>{
 const {track,rack,project,engine}=fixture();
 rack.amounts.reverb=.25;
 project.tracks.push({...track,id:'t2',solo:true} as typeof track);
 engine.voices.push({...engine.voices[0],code:'second'});
 engine.effects!.tracks.push({...engine.effects!.tracks[0],effects:[]});
 const {racks,buses}=nativeGraph(engine);
 assert.deepEqual(racks[0],{instrument:'instrument',values:{'/Synth/B':.6},gain:0,pan:.1,sends:{delay:0,reverb:.25},
  effects:[{id:'fx1',code:'stereo',values:{'/Synth/Gain':.5},bypass:true,wetOnly:false}]});
 assert.equal(racks[1].instrument,'second');assert.equal(racks[1].gain,.1);
 assert.deepEqual(buses.master,{gain:.5,effects:[]});assert.equal(buses.reverb.gain,.7);
 const data=nativeRackFile(engine,1);assert.equal(data.preset.instrument,'second');assert.equal(data.preset.effects.length,0);
});

test('native timeline uses current envelopes even if only the timing snapshot predates the edit',()=>{
 const {project,engine}=fixture();
 project.automation=[{id:'a',trackId:'t1',device:'instrument',address:'/Synth/B',label:'B',min:0,max:1,step:.01,
  scale:'linear',mode:'read',interpolation:'linear',points:[{tick:0,value:0},{tick:480,value:1}]}];
 const seq=nativeSequence(engine);
 assert.equal(seq.end,1);
 assert.deepEqual(seq.events.filter(e=>'status' in e).map(e=>e.time),[.125,.25]);
 const envelope=seq.events.filter(e=>'address' in e);
 assert.equal(envelope[0].value,0);assert.equal(envelope.at(-1)?.value,1);
 assert.equal(envelope.at(-1)?.time,.5);
 assert.ok(envelope.some(e=>e.value>.4&&e.value<.6));
});

test('VST3 export has deterministic macro bindings and eight normalized host values',()=>{
 const {engine}=fixture(),state=nativeRackFile(engine);
 assert.deepEqual(state.preset.macros,[
  {device:'instrument',address:'/Synth/A'},{device:'instrument',address:'/Synth/B'},{device:'fx1',address:'/Synth/Gain'}]);
 assert.equal(state.format,'shallowgroove-rack-v1');
 assert.deepEqual(state.macroValues,[0,.6,.5,0,0,0,0,0]);
});

test('automation keeps source track, return and send destinations distinct',()=>{
 const {track,project,engine}=fixture();
 project.tracks.push({...track,id:'t2'});
 engine.voices.push(engine.voices[0]);engine.effects!.tracks.push(engine.effects!.tracks[0]);
 const lane={id:'a',trackId:'t2',device:'mixer',address:'send.reverb',label:'send',min:0,max:1,step:.01,
  scale:'linear',mode:'read',interpolation:'step',points:[{tick:0,value:.5}]} as AutomationLane;
 project.automation=[lane,{...lane,id:'b',trackId:'reverb',address:'gain'}];
 const {events}=nativeSequence(engine);
 assert.deepEqual(events.filter(e=>'address' in e).map(e=>[e.track,e.address,e.value]),[[1,'send.reverb',.5],['reverb','gain',.5]]);
 assert.deepEqual(events.filter(e=>'status' in e).map(e=>e.track),[0,1,0,1]);
});

test('session slots remap MIDI, loop independently, and switch to a silent slot on the native boundary',()=>{
 const {engine}=fixture(),project=engine.project!;
 const session=new NativeSession(),clip={id:'riff',name:'Riff',channel:2,length:480,events:[{status:145,tick:120,kind:'channel',order:0,data:[70,96]},{status:129,tick:240,kind:'channel',order:1,data:[70,0]}]};
 const launch={sceneId:'s1',channel:6,clip};
 const riff=projectSlot(project,{track:1,launch},0,1);
 assert.deepEqual(riff.payload.events,[{tick:120,time:.125,status:149,data1:70,data2:96},{tick:240,time:.25,status:133,data1:70,data2:0}]);
 session.queue([riff],1);assert.equal(session.state(1,2.25).phase,240);
 const empty={sceneId:'s2',channel:6,clip:null};
 const silent=projectSlot(project,{track:1,launch:empty},1920,3);session.queue([silent],2.25);
 assert.deepEqual(session.pending(2.5,1440),[{slot:{track:1,launch:empty},afterTicks:480}]);
 assert.equal(session.state(1,2.5).active?.sceneId,'s1');assert.equal(session.state(1,2.5).pending?.sceneId,'s2');
 assert.deepEqual(silent.payload,{track:1,duration:0,events:[],phase:0,lengthTicks:0,phaseTicks:0});assert.equal(session.state(1,3).active?.sceneId,'s2');
});

test('clip phase follows tempo ramp across repeated clips and wrapped arrangement bars',()=>{
 const {engine}=fixture(),p=engine.project!;
 p.timing.end_tick=3840;p.automation=[{id:'tempo',trackId:'master',device:'mixer',address:'bpm',label:'Tempo',min:60,max:180,
  step:1,scale:'linear',mode:'read',interpolation:'linear',points:[{tick:0,value:0},{tick:1920,value:1}]}];
 const launch={sceneId:'scene',channel:1,clip:{id:'clip',name:'clip',channel:1,length:480,events:[]}};
 const session=new NativeSession(),loop={start:tickToSeconds(p,480),end:tickToSeconds(p,1440)};
 const runs=session.prepare(p,[{track:0,launch,phase:20}],480,loop.start,loop);
 session.queue(runs,loop.start);
 const at=tickToSeconds(p,1080),phase=session.state(0,at).phase;
 assert.ok(Math.abs(phase-140)<1e-6);
 assert.ok(Math.abs(session.state(0,at+2*(loop.end-loop.start)).phase-140)<1e-6);
 const clock=sessionTiming(p),later=at+3*(loop.end-loop.start);
 assert.ok(Math.abs(clock.unwrappedSeconds(clock.unwrapped(later,loop),loop)-later)<1e-6);
 assert.ok(Math.abs(session.state(0,at,1080).phase-140)<1e-6);
 assert.equal(runs[0].payload.phaseTicks,20);assert.equal(runs[0].payload.lengthTicks,480);
});

test('output option changes discard unsupported rate or buffer, with single-buffer duration',()=>{
 const options={devices:['Interface'],sampleRates:[48000,96000],bufferSizes:[128,256]};
 assert.deepEqual(supportedOutput({device:'Interface',sampleRate:44100,bufferSize:256},options),{device:'Interface',sampleRate:null,bufferSize:256});
 assert.equal(bufferDuration(128,48000),'2.67');assert.equal(bufferDuration(128,undefined),null);
 assert.equal(sameOutput(systemOutput,{...systemOutput}),true);
});

test('native output transactions keep the cursor and arm, coalesce default changes, and retain the previous output on rejection',async()=>{
 const {engine}=fixture();
 Object.assign(engine,{nativeMonitor:{enabled:true,track:0},position:.75,hardwareValues:new Map(),playing:false});
 const errors:unknown[]=[],applied:Parameters<NativeBridge['applyOutput']>[0][]=[];
 let callback:(e:Record<string,unknown>)=>void=()=>{},replayed=0,pauses=0,device='Speakers',defer=false,release:()=>void=()=>{};
 engine.replayNativeControls=()=>{replayed++;};
 engine.pauseForOutputChange=()=>{pauses++;engine.playing=false;};
 const status=()=>({audioDevice:device,sampleRate:48000,bufferSize:128,midiInputs:[{id:'key',name:'Keys',enabled:true}]});
 const bridge={
  onEvent:(f:typeof callback)=>{callback=f;return ()=>{};},stop:async()=>{},request:async()=>status(),
  preferences:async()=>({engine:'native',midiInputs:['key'],output:systemOutput}),
  applyOutput:async(c:Parameters<NativeBridge['applyOutput']>[0])=>{
   applied.push(c);if(defer){await new Promise<void>(r=>{release=r;});defer=false;}
   if(c.output.device==='missing')throw Error('unavailable');
   return status();
  }
 } as NativeBridge;
 const preview=engine.native=new NativePreview(bridge,engine,e=>errors.push(e),()=>{});
 await preview.load();preview.readyForOutputChanges();
 callback({event:'outputDefaultChanged',audioDevice:'Speakers'});assert.equal(applied.length,0);
 engine.playing=true;device='Headphones';callback({event:'outputDefaultChanged',audioDevice:device});
 await new Promise(r=>setTimeout(r,0));
 assert.equal(pauses,1);assert.equal(replayed,1);assert.equal(applied.length,1);
 const first=applied[0];assert.deepEqual(first.monitor,{enabled:true,track:0});assert.equal(first.position,.75);assert.deepEqual(first.midiInputs,['key']);
 assert.deepEqual(first.graph,nativeGraph(engine));assert.equal(preview.details.audioDevice,device);
 await assert.rejects(preview.applyOutput({...systemOutput,device:'missing'}),/unavailable/);
 assert.deepEqual(preview.output,systemOutput);assert.equal(preview.details.audioDevice,device);assert.equal(preview.outputPending,false);
 const fixed:NativeOutput={device:'Interface',sampleRate:48000,bufferSize:128};device='Interface';defer=true;
 const changing=preview.applyOutput(fixed);
 assert.equal(preview.outputPending,true);callback({event:'outputDefaultChanged',audioDevice:'Speakers'});
 await assert.rejects(preview.applyOutput(systemOutput));release();await changing;await Promise.resolve();
 assert.equal(applied.length,3);assert.deepEqual(preview.output,fixed);assert.equal(pauses,1);assert.deepEqual(errors,[]);
 await preview.close();
});

test('Web recovery opens the replacement output without loading a stale saved device',async()=>{
 const {engine}=fixture(),calls:string[]=[];Object.assign(engine,{position:0,nativeMonitor:{enabled:false,track:0}});
 const bridge={onEvent:()=>()=>{},stop:async()=>{},preferences:async()=>({engine:'native',midiInputs:[],output:{...systemOutput,device:'gone'}}),
  request:async()=>{throw Error('saved device is gone');},applyOutput:async()=>{calls.push('candidate');return {audioDevice:'Built-in'};}
 } as unknown as NativeBridge;
 const preview=engine.native=new NativePreview(bridge,engine,()=>{},()=>{});
 await preview.load(systemOutput);
 assert.deepEqual(calls,['candidate']);assert.equal(preview.details.audioDevice,'Built-in');assert.deepEqual(preview.output,systemOutput);
 await preview.close();
});
