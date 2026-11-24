import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDevice,inspectChannel} from '../src/audio/inspect.ts';
import type {AudioEngine} from '../src/audio/engine.ts';
import type {EffectDevice} from '../src/audio/effects.ts';

test('effect inspector allocates taps only for enabled views and releases them on close',async t=>{
 let url='',closed=false,created=0,connections=0;
 const popup={get closed(){return closed;},close(){closed=true;}};
 const fakeWindow={open:(path:string)=>{url=path;return popup;},setInterval,addEventListener(){},removeEventListener(){}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:fakeWindow});
 t.after(()=>Reflect.deleteProperty(globalThis,'window'));
 const source={connect(){connections++;},disconnect(){connections--;}};
 const effect={input:source,dry:source,wet:source};
 const context={sampleRate:48000,createAnalyser(){
  created++;return {fftSize:0,frequencyBinCount:2048,getByteTimeDomainData(){},getByteFrequencyData(){},disconnect(){}};
 }};
 const engine={effects:{devices:()=>[effect]},voices:[],context};
 inspectDevice(engine as unknown as AudioEngine,'master',effect as unknown as EffectDevice,'Delay',false);
 const channel=new BroadcastChannel(url.split('#')[1]);
 const sync=async()=>{
  const ready=new Promise<void>(resolve=>{channel.onmessage=({data})=>{if(data.title)resolve();};});
  channel.postMessage({ready:true});await ready;
 };
 try {
  await sync();assert.equal(created,0);
  channel.postMessage({mode:'wave',enabled:true});await sync();assert.equal(connections,3);
  channel.postMessage({mode:'spectrum',enabled:true});await sync();assert.equal(connections,6);
  channel.postMessage({mode:'wave',enabled:false});await sync();assert.equal(connections,3);
  channel.postMessage({mode:'spectrogram',enabled:true});await sync();assert.equal(connections,5);
  channel.postMessage({mode:'spectrogram',enabled:false});await sync();assert.equal(connections,3);
  channel.postMessage({close:true});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(connections,0);assert.ok(closed);
 }finally{popup.close();channel.close();}
});

test('desktop inspector completes initialization and stops sampling when its native window closes',async t=>{
 let onClosed:(id:string)=>void=()=>{},id='',closeRequests=0,links=0;
 const source={connect(){links++;},disconnect(){links--;}};
 const voice={node:source,output:source};
 const engine={effects:{},voices:[voice],context:{sampleRate:48000,createAnalyser(){return {frequencyBinCount:2048,getByteTimeDomainData(){},disconnect(){}};}}};
 let channel:BroadcastChannel;
 const initialized=Promise.withResolvers<{title:string;rate:number}>();
 const frame=Promise.withResolvers<number>();
 const desktop={
  openInspector:async(key:string)=>{
   id=key;channel=new BroadcastChannel(key);
   channel.onmessage=({data})=>{
    if(data.title){initialized.resolve(data);channel.postMessage({mode:'wave',enabled:true});}
    if(data.lines)frame.resolve(data.lines[0].length);
   };
   channel.postMessage({ready:true});
  },
  onInspectorClosed:(callback:typeof onClosed)=>{onClosed=callback;return()=>{onClosed=()=>{};};},
  closeInspector:()=>{closeRequests++;},
 };
 const mockWindow={shallowgrooveDesktop:desktop,setInterval,addEventListener(){},removeEventListener(){}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:mockWindow});
 t.after(()=>{onClosed(id);channel?.close();Reflect.deleteProperty(globalThis,'window');});
 inspectDevice(engine as unknown as AudioEngine,0,undefined,'Synth',true);
 const info=await initialized.promise;assert.equal(info.title,'CH 1 · Synth');assert.equal(info.rate,48000);
 assert.equal(await frame.promise,1024);assert.equal(links,1);
 onClosed(id);assert.equal(links,0);assert.equal(closeRequests,1);
});

test('mixer inspection samples only the selected output and offers no device benchmark',async t=>{
 let url='',closed=false;
 const popup={get closed(){return closed;},close(){closed=true;}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{
  open:(path:string)=>{url=path;closed=false;return popup;},setInterval,addEventListener(){},removeEventListener(){},
 }});
 t.after(()=>Reflect.deleteProperty(globalThis,'window'));
 for(const target of [0,'delay','reverb','master'] as const){
  let links=0;
  const output={connect(){links++;},disconnect(){links--;}};
  const context={sampleRate:48000,createAnalyser(){return {getByteTimeDomainData(){},disconnect(){}};}};
  const engine={context,voices:[],effects:{},mixerOutput:(track:unknown)=>track===target?output:null};
  inspectChannel(engine as unknown as AudioEngine,target,'Mix',false);
  const bus=new BroadcastChannel(url.split('#')[1]);
  const sync=()=>{
   const ready=Promise.withResolvers<{canBenchmark:boolean;title:string}>();
   bus.onmessage=({data})=>{if(data.title)ready.resolve(data);};bus.postMessage({ready:true});return ready.promise;
  };
  try{
   const info=await sync();assert.equal(info.canBenchmark,false);assert.match(info.title,/Channel output$/);
   assert.equal(links,0);bus.postMessage({mode:'wave',enabled:true});await sync();assert.equal(links,1);
   bus.postMessage({mode:'performance',enabled:true});await sync();assert.equal(links,1);
   bus.postMessage({mode:'wave',enabled:false});await sync();assert.equal(links,0);
   bus.postMessage({close:true});await new Promise(resolve=>setTimeout(resolve,20));assert.ok(closed);
  }finally{popup.close();bus.close();}
 }
});

test('native sidebar modes share one capture and release the native tap on final close',async()=>{
 const {registerInspector}=await import('../src/audio/inspect.ts');
 const request=Promise.withResolvers<import('../src/audio/inspect.ts').InspectRequest>();
 const detach=registerInspector(request.resolve);
 const commands:Record<string,unknown>[]=[];
 const effect={id:'fx'};
 const native={details:{sampleRate:96000},probeRequest:async(cmd:Record<string,unknown>)=>{
  commands.push(cmd);return {wave:['Ag==','Aw=='],spectrum:['BA==','BQ=='],seconds:.5,average:.3,peak:.4};
 }};
 const engine={native,effects:{devices:()=>[effect]},context:{sampleRate:48000},voices:[]};
 try{
  inspectDevice(engine as unknown as AudioEngine,'delay',effect as EffectDevice,'Tape',false);
  const source=await request.promise;
  assert.equal(source.livePerformance,true);assert.equal(source.rate,96000);assert.equal(commands.length,0);
  const modes=['wave','spectrum','spectrogram','performance'] as const;
  const frames=modes.map(()=>Promise.withResolvers<import('../src/audio/inspect.ts').InspectFrame>());
  const close=modes.map((mode,i)=>source.subscribe(mode,frames[i].resolve));
  const data=await Promise.all(frames.map(p=>p.promise));
  assert.equal(commands.length,1);assert.equal(commands[0].device,'fx');assert.equal(commands[0].track,'delay');
  assert.deepEqual(data[2].lines,[Uint8Array.of(5)]);assert.equal(data[3].average,.3);
  close.slice(0,3).forEach(fn=>fn());assert.equal(commands.length,1);
  close[3]();assert.equal(commands[1].op,'inspectClose');assert.equal(commands[1].token,commands[0].token);
 }finally{detach();}
});
