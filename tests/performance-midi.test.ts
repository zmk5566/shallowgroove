import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceMidi } from '../src/audio/performance-midi.ts';
import type { PerformanceGraph } from '../src/model/performance.ts';

test('mapped pitch is sampled at the pulse and its original note is released', () => {
  let now = 0;
  const output: number[][] = [];
  const router = new PerformanceMidi((track, bytes) => output.push([track, ...bytes]), () => now);
  const graph: PerformanceGraph = {
    nodes: [
      {id:'knob',kind:'knob',name:'Pitch'},
      {id:'clock',kind:'retrigger',name:'Pulse',enabled:true,division:1},
      {id:'note',kind:'note',name:'Note',pitch:60,pitchMin:36,pitchMax:60,velocity:80,lengthMs:120},
      {id:'bass',kind:'effect',name:'Bass',trackId:'t',device:'instrument'}
    ], layout:{}, links:[], routes:[
      {id:'p',source:'knob',target:'note',input:'pitch'},
      {id:'t',source:'clock',target:'note',input:'trigger'},
      {id:'m',source:'note',target:'bass',input:'midi'}
    ]
  };
  const sync = (value:number) => router.sync(graph,[{id:'t',midi_channel:2}],{knob:value},120,[],-1);
  try {
    sync(0);
    now=60; sync(0.5);
    assert.equal(router.pitches.note,48);
    now=120; router.tick();
    now=500; router.tick();
    now=520; graph.routes=graph.routes!.filter(route=>route.input!=='midi'); sync(1);
    now=5000; router.tick();
    assert.deepEqual(output,[[0,145,36,80],[0,129,36,0],[0,145,48,80],[0,129,48,0]]);
  } finally { router.stop(); }
});

function controlledClock(){
  const graph:PerformanceGraph={
    nodes:[
      {id:'clock',kind:'retrigger',name:'Clock',timing:'free',enabled:true,division:1},
      {id:'note',kind:'note',name:'Note',pitch:60,pitchMin:36,pitchMax:48,lengthMs:5,velocity:100},
      {id:'out',kind:'effect',name:'Out',trackId:'bass',device:'instrument'},
      {id:'speed',kind:'sensor',name:'Speed'}
    ], layout:{}, links:[], routes:[
      {id:'trigger',source:'clock',target:'note',input:'trigger'},
      {id:'midi',source:'note',target:'out',input:'midi'}
    ]
  };
  let now=0;
  const sent:number[][]=[];
  const router=new PerformanceMidi((_,data)=>sent.push([now,...data]),()=>now);
  const sync=(time:number,values:Record<string,number>={})=>{
    now=time;router.sync(graph,[{id:'bass',midi_channel:1}],values,120,[],-1);
  };
  const tick=(time:number)=>{now=time;router.tick();};
  return {graph,sent,router,sync,tick};
}
test('free interval defaults to 250 ms and changes preserve elapsed pulse phase',()=>{
  const {router,graph,sent,sync,tick}=controlledClock();
  try{
    sync(0);tick(5);tick(250);tick(255);
    graph.routes!.push({id:'interval',source:'speed',target:'clock',input:'interval'});
    sync(375,{speed:1});assert.equal(router.intervals.clock,2000); // Halfway through the old period, 1000ms remain.
    tick(1374);assert.equal(sent.length,4);
    tick(1375);assert.deepEqual(sent.at(-1),[1375,144,60,100]);
    sync(1376,{});assert.equal(router.intervals.clock,undefined);assert.deepEqual(sent.at(-1),[1376,128,60,0]);
    tick(5000);assert.equal(sent.length,6);
    sync(5001,{speed:0});tick(5006);tick(5011);
    assert.deepEqual(sent.at(-1),[5011,144,60,100]);
  }finally{router.stop();}
});
test('normalized velocity and duration use destination ranges',()=>{
  const {router,graph,sent,sync,tick}=controlledClock();
  const clock=graph.nodes.find(n=>n.kind==='retrigger')!;
  if(clock.kind==='retrigger')clock.intervalMs=3000;
  graph.routes!.push({id:'v',source:'speed',target:'note',input:'velocity'},{id:'d',source:'speed',target:'note',input:'lengthMs'});
  try{
    sync(0,{speed:0});tick(9);assert.equal(sent.length,1);tick(10);
    sync(2999,{speed:1});tick(3000);tick(4999);assert.equal(sent.length,3);tick(5000);
    assert.deepEqual(sent,[[0,144,60,1],[10,128,60,0],[3000,144,60,127],[5000,128,60,0]]);
  }finally{router.stop();}
});
test('remapped destination units override pitch range, velocity, duration and interval',()=>{
  const {router,graph,sent,sync,tick}=controlledClock();
  for(const [input,target] of [['pitch','note'],['velocity','note'],['lengthMs','note'],['interval','clock']] as const){
    const source=input+'Map';
    graph.nodes.push({kind:'remap',id:source,name:source,inMin:0,inMax:1,outMin:0,outMax:5000});
    graph.routes!.push({id:'to'+input,input,target,source});
  }
  const values={pitchMap:72.6,velocityMap:110.2,lengthMsMap:2345,intervalMap:2750};
  try{
    sync(0,values);tick(2344);assert.equal(sent.length,1);tick(2345);tick(2750);
    assert.deepEqual(sent,[[0,144,73,110],[2345,128,73,0],[2750,144,73,110]]);
    sync(2751,{...values,velocityMap:NaN});assert.deepEqual(sent.at(-1),[2751,128,73,0]);
    sync(2760,{pitchMap:-20,velocityMap:200,lengthMsMap:0,intervalMap:10});
    tick(2761);assert.deepEqual(sent.slice(-2),[[2760,144,0,127],[2761,128,0,0]]);
  }finally{router.stop();}
});
test('sync interval quantizes normalized input by index and remapped beats by distance',()=>{
  const {router,graph,sent,sync,tick}=controlledClock();
  const clock=graph.nodes.find(n=>n.kind==='retrigger')!;
  if(clock.kind==='retrigger')clock.timing='sync';
  const route={id:'rate',source:'speed',target:'clock',input:'interval'} as const;
  graph.routes!.push(route);
  try{
    sync(0,{speed:1});tick(5);tick(1999);assert.equal(sent.length,2);tick(2000);tick(2005);
    graph.nodes.push({kind:'remap',id:'beat',name:'Beat',inMin:0,inMax:1,outMin:0,outMax:4});
    graph.routes![graph.routes!.indexOf(route)]={...route,source:'beat'};
    sync(3000,{beat:.69});assert.equal(router.intervals.clock,2/3); // Closest is 2/3 beat. Half of 333.33 ms remains.
    tick(3166);assert.equal(sent.length,4);tick(3167);assert.deepEqual(sent.at(-1),[3167,144,60,100]);
  }finally{router.stop();}
});

test('clock gate uses the 0.5 threshold and its saved enabled setting on disconnect',()=>{
  const {router,graph,sent,sync}=controlledClock();
  graph.routes!.push({id:'gate',source:'speed',target:'clock',input:'enabled'});
  try{
    sync(0,{speed:.49});assert.equal(sent.length,0);assert.equal(router.readings.gate,0);
    router.trigger('note');assert.equal(sent.length,0);
    sync(1,{speed:.5});assert.equal(router.readings.gate,1);
    assert.deepEqual(sent,[[1,144,60,100]]);
    router.trigger('note');assert.equal(sent.length,1);
    sync(2,{speed:0});sync(3,{});
    assert.deepEqual(sent.slice(1),[[2,128,60,0],[3,144,60,100]]);
    assert.equal(router.readings.gate,1);
    const clock=graph.nodes.find(n=>n.kind==='retrigger')!;
    if(clock.kind==='retrigger')clock.enabled=false;
    sync(4);assert.equal(router.readings.gate,0);assert.deepEqual(sent.at(-1),[4,128,60,0]);
  }finally{router.stop();}
});
test('manual trigger fans out once and releases the sampled note at its patched duration',()=>{
  const {router,graph,sent,sync,tick}=controlledClock();
  graph.routes=graph.routes!.filter(route=>route.input!=='trigger');
  graph.nodes.push({id:'lead',kind:'effect',name:'Lead',device:'instrument',trackId:'other'});
  graph.routes.push({id:'lead-midi',source:'note',target:'lead',input:'midi'});
  for(const input of ['pitch','velocity','lengthMs'] as const)graph.routes.push({id:'link-'+input,input,source:'speed',target:'note'});
  try{
    router.sync(graph,[{id:'bass',midi_channel:1},{id:'other',midi_channel:2}],{speed:0},120,[],-1);
    assert.deepEqual({...router.readings},{'link-pitch':36,'link-velocity':1,'link-lengthMs':10});
    assert.deepEqual(sent,[]);router.trigger('note');
    tick(9);assert.deepEqual(sent,[[0,144,36,1],[0,145,36,1]]);
    tick(10);assert.deepEqual(sent.slice(-2),[[10,128,36,0],[10,129,36,0]]);
    sync(11,{speed:1});router.trigger('note');
    assert.deepEqual(sent.at(-1),[11,144,48,127]);
    graph.routes=[];sync(12);assert.deepEqual(sent.at(-1),[12,128,48,0]);assert.deepEqual({...router.readings},{});
    tick(5000);assert.equal(sent.length,6);
  }finally{router.stop();}
});
test('unconnected note and clock outputs still expose patched control readings',()=>{
  const {router,graph,sync}=controlledClock();
  graph.routes=[{id:'velocity',source:'speed',target:'note',input:'velocity'},{id:'clock-speed',source:'speed',target:'clock',input:'interval'}];
  try{
    sync(0,{speed:.5});assert.deepEqual({...router.readings},{velocity:64,'clock-speed':1005});
    sync(1);assert.deepEqual({...router.readings},{});
  }finally{router.stop();}
});

test('OSC address triggers every packet with current raw pitch and scheduled note-off',()=>{
 const {router,graph,sent,sync,tick}=controlledClock();
 graph.nodes.push(
  {id:'hit',kind:'osc-input',name:'Hit',output:'trigger',address:'/voice',argument:0},
  {id:'pitch',kind:'osc-input',name:'Pitch',output:'value',address:'/voice',argument:2}
 );
 graph.routes=graph.routes!.filter(r=>r.input!=='trigger');
 graph.routes.push({id:'hit-note',source:'hit',target:'note',input:'trigger'},
  {id:'pitch-note',source:'pitch',target:'note',input:'pitch'});
 try{
  sync(0,{pitch:72});
  router.trigger('note');router.oscTrigger('/other');assert.deepEqual(sent,[]);
  router.oscTrigger('/voice');router.oscTrigger('/voice');
  assert.deepEqual(sent,[[0,144,72,100],[0,128,72,0],[0,144,72,100]]);
  sync(2,{pitch:62});router.oscTrigger('/voice');
  tick(6);assert.deepEqual(sent.slice(3),[[2,128,72,0],[2,144,62,100]]);
  tick(7);assert.deepEqual(sent.at(-1),[7,128,62,0]);
  graph.routes=graph.routes.filter(r=>r.id!=='hit-note');sync(8,{pitch:62});router.oscTrigger('/voice');
  assert.equal(sent.length,6);
 }finally{router.stop();}
});

test('threshold gate holds sampled pitch and releases on fall or route removal; rising triggers timed notes',()=>{
 const {router,graph,sent,sync,tick}=controlledClock();
 graph.nodes.push({id:'h',kind:'threshold',name:'Gate',low:.2,high:.8,manualValue:0});
 graph.routes=graph.routes!.filter(r=>r.input!=='trigger');
 graph.routes.push({id:'hold',source:'h',target:'note',input:'gate'});
 try{
  sync(0,{h:0});router.trigger('note');assert.deepEqual(sent,[]);
  sync(1,{h:1});sync(6,{h:1});tick(3000);
  assert.deepEqual(sent,[[1,144,60,100]]);
  sync(3001,{h:0});sync(3002,{h:1});
  graph.routes=graph.routes.filter(r=>r.id!=='hold');sync(3003);
  assert.deepEqual(sent.slice(1),[[3001,128,60,0],[3002,144,60,100],[3003,128,60,0]]);
  graph.routes.push({id:'rise',source:'h',target:'note',input:'trigger'});
  sync(3004,{h:1});router.trigger('note');assert.equal(sent.length,4);
  router.thresholdTrigger('h');tick(3009);
  assert.deepEqual(sent.slice(4),[[3004,144,60,100],[3009,128,60,0]]);
 }finally{router.stop();}
});

test('OSC triggers isolate named endpoints and release held notes when a node is rebound',()=>{
 const {router,graph,sent,sync,tick}=controlledClock();
 const hit={id:'hit',kind:'osc-input' as const,name:'Hit',output:'trigger' as const,address:'/hit',argument:0,endpointId:'stage'};
 graph.nodes.push(hit);
 graph.routes=graph.routes!.map(r=>r.input==='trigger'?{...r,source:'hit'}:r);
 try{
  sync(0);
  router.oscTrigger('/hit');router.oscTrigger('/hit','default');assert.deepEqual(sent,[]);
  router.oscTrigger('/hit','stage');assert.deepEqual(sent,[[0,144,60,100]]);
  hit.endpointId='default';sync(1);
  assert.deepEqual(sent.at(-1),[1,128,60,0]);
  router.oscTrigger('/hit','stage');assert.equal(sent.length,2);
  router.oscTrigger('/hit');tick(6);assert.deepEqual(sent.slice(2),[[1,144,60,100],[6,128,60,0]]);
 }finally{router.stop();}
});
