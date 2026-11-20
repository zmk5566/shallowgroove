import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
// Exercise the real scheduler with a deterministic clock. Browser-only patch
// discovery and raw DSP imports are unused because this test supplies voices.
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier.endsWith('?raw'))return {url:'data:text/javascript,export default ""',shortCircuit:true};
 if(specifier==='./effects')return {url:'data:text/javascript,export class EffectsRack{}',shortCircuit:true};
 if(specifier==='./patch-bank')return {url:'data:text/javascript,export function assignedPatch(){}',shortCircuit:true};
 if(specifier==='@grame/faustwasm')return next('@grame/faustwasm/dist/esm/index.js',context);
 if(specifier.startsWith('.')&&!/\.\w+$/.test(specifier))return next(specifier+'.ts',context);
 return next(specifier,context);
}});
try{
 const {AudioEngine}=await import('../src/audio/engine.ts');
 const engine=new AudioEngine(),messages=[];
 globalThis.window={setInterval:()=>1,clearInterval(){}};
 const project={title:'Loop',timing:{ppqn:100,end_tick:1600,default_tempo_us_per_quarter:500000},tracks:[{id:'a',midi_channel:1}],global_events:[]};
 engine.project=engine.timingProject=project;engine.duration=8;
 engine.context={currentTime:10,resume:async()=>{},state:'running',sampleRate:48000};
 engine.voices=[{node:{stop(){},start(){},allNotesOff(){},instanceClear(){},midiMessage(data,time){messages.push({data,time});}},values:{}}];
 engine.master={gain:{setValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}}};
 const event=(seconds,pitch,on=true)=>({seconds,trackIndex:0,status:on?144:128,data:[pitch,on?100:0]});
 engine.events=[event(1.5,58),event(2,60),event(2.2,58,false),event(3.9,60,false),event(4,70)];
 for(const repeat of [false,true]){
  for(const [head,expected] of [[1,2],[2,2],[3,3],[4,2],[5,2],[8,2]]){
   engine.configureLoop(repeat,null);engine.seek(head);
   engine.configureLoop(repeat,{start:400,end:800});
   assert.equal(engine.position,head,'selecting bars preserves the stopped playhead');
   await engine.play();assert.equal(engine.position,repeat?expected:(head===engine.duration?0:head));
   engine.pause();
  }
 }
 messages.length=0;engine.seek(1);await engine.play();
 assert.equal(engine.position,2);
 engine.context.currentTime=11.95;engine.schedule();
 const attacks=messages.filter(m=>m.data[0]===144);
 assert.equal(attacks.some(m=>m.data[1]===70),false);
 assert.deepEqual(attacks.filter(m=>m.data[1]===60).map(m=>m.time),[10.05,12.05]);
 assert.equal(attacks.filter(m=>m.data[1]===58).length,2);
 engine.context.currentTime=12.15;assert.ok(Math.abs(engine.position-2.1)<1e-7);
 engine.pause();await engine.play();assert.ok(Math.abs(engine.position-2.1)<1e-7);
 engine.seek(2.1);assert.ok(Math.abs(engine.position-2.1)<1e-7);
 engine.configureLoop(false);assert.ok(Math.abs(engine.position-2.1)<1e-7);
 assert.deepEqual(engine.loopRange,{start:400,end:800});engine.pause();
 // With repeat off, play through both selection boundaries from the cursor.
 engine.seek(1.9);messages.length=0;
 const start=engine.context.currentTime+.05;
 await engine.play();
 assert.equal(engine.position,1.9,'repeat off preserves the cursor');
 assert.ok(messages.some(m=>m.data[0]===144&&m.data[1]===60&&Math.abs(m.time-(start+.1))<1e-8));
 engine.context.currentTime=start+2.05;engine.schedule();
 assert.ok(messages.some(m=>m.data[0]===144&&m.data[1]===70&&Math.abs(m.time-(start+2.1))<1e-8));
 engine.context.currentTime=start+2.2;assert.ok(Math.abs(engine.position-4.1)<1e-7);
 engine.pause();engine.configureLoop(false,null);engine.seek(3);await engine.play();
 assert.equal(engine.position,3,'ordinary Play uses the playhead when selection is cleared');
 console.log('PASS: cursor start with repeat off, selection start with repeat on, MIDI timestamps, wrap, chase and ordinary playback');
 // Launch a whole scene, replace one track, and hand it back to the arrangement.
 engine.stop();project.tracks.push({id:'b',midi_channel:2});
 const bass=[];engine.voices.push({node:{...engine.voices[0].node,midiMessage(data,time){bass.push({data,time});}},values:{}});
 const clip=(id,pitch)=>({id,name:id,channel:1,length:100,events:[
  {tick:0,order:0,status:144,data:[pitch,100]},{tick:70,order:1,status:128,data:[pitch,0]}]});
 const drum=clip('drum',36),fill=clip('fill',38),low=clip('bass',48);
 const slot=(track,source)=>({track,launch:{sceneId:'one',clip:source,channel:track+1}});
 const advance=time=>{while(engine.context.currentTime+.025<time){engine.context.currentTime+=.025;engine.schedule();}engine.context.currentTime=time;engine.schedule();};
 messages.length=bass.length=0;engine.context.currentTime=20;
 await engine.launchSlots([slot(0,drum),slot(1,low)]);
 assert.ok(messages.some(m=>m.data[0]===144&&m.data[1]===36&&m.time===20.05));
 assert.ok(bass.some(m=>m.data[0]===145&&m.data[1]===48&&m.time===20.05));
 advance(20.8);await engine.launchSlots([slot(0,fill)]);
 assert.equal(engine.liveState(0).pending.clip.id,'fill');advance(22.1);
 assert.ok(messages.some(m=>m.data[0]===144&&m.data[1]===38&&Math.abs(m.time-22.05)<1e-8));
 assert.ok(!messages.some(m=>m.data[0]===144&&[58,60,70].includes(m.data[1])));
 assert.equal(engine.liveState(1).active.clip.id,'bass');
 engine.backToArrangement();advance(22.5);assert.equal(engine.live.engaged,false);
 assert.ok(messages.some(m=>m.data[0]===144&&m.data[1]===60&&m.time>22.1));
 engine.stop();engine.seek(7.5);await engine.launchSlots([slot(0,drum)]);advance(24);
 assert.equal(engine.playing,true,'a session clip loops beyond the arrangement end');
 engine.stop();assert.equal(engine.live.engaged,false);
 // A press inside the scheduler's 250 ms lookahead still catches the next downbeat.
 engine.context.currentTime=30;messages.length=bass.length=0;
 engine.voices[0].node.stop=()=>{for(let i=messages.length-1;i>=0;i--)if(messages[i].time>engine.context.currentTime)messages.splice(i,1);};
 await engine.launchSlots([slot(0,drum),slot(1,low)]);
 advance(31.98);assert.ok(messages.some(m=>m.data[0]===144&&m.data[1]===36&&Math.abs(m.time-32.05)<1e-8));
 await engine.launchSlots([slot(0,fill)]);advance(32.1);
 assert.ok(messages.some(m=>m.data[0]===144&&m.data[1]===38&&Math.abs(m.time-32.05)<1e-8));
 assert.ok(!messages.some(m=>m.data[0]===144&&m.data[1]===36&&Math.abs(m.time-32.05)<1e-8));
 assert.equal(bass.filter(m=>m.data[0]===145&&m.data[1]===48&&Math.abs(m.time-32.05)<1e-8).length,1);
 engine.pause();await engine.play();advance(32.4);assert.equal(engine.liveState(0).active.clip.id,'fill');
 engine.stop();
 console.log('PASS session scene alignment, independent launch, return chase and playback beyond arrangement');
}finally{hooks.deregister();}
