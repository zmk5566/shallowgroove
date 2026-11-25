import test from 'node:test';
import assert from 'node:assert/strict';
import {PerformanceControls} from '../src/audio/performance-controls.ts';
import type {AudioEngine} from '../src/audio/engine.ts';
import type {Connector} from '../src/hardware/useHexblocks.ts';
import {hardwareKey,type HardwareMapping} from '../src/model/hardware.ts';
import {oscSignalKey,updateMidiControlValues,type PerformanceGraph} from '../src/model/performance.ts';

test('sensor subscription, normalized fan-out, smoothing and offline release',()=>{
 const runtime=new PerformanceControls(),subscribed:unknown[][]=[];
 const connector:Connector={id:'hub',label:'Hub',connected:true,transport:{connected:true},modules:[
  {uid:'AABBCCDD',channels:{},descriptor:{channels:[{id:1,label:'Pressure',min:0,max:1024}]}}
 ]};
 const graph:PerformanceGraph={nodes:[
  {id:'pressure',kind:'sensor',name:'Pad',uid:'AABBCCDD',channel:1},
  {id:'filter',kind:'effect',name:'Filter',trackId:'a',device:'f'},
  {id:'delay',kind:'effect',name:'Delay',trackId:'b',device:'d'},
 ],layout:{},links:[
  {id:'hz',source:'pressure',target:'filter',address:'freq',min:100,max:10000,smoothMs:0,scale:'log'},
  {id:'mix',source:'pressure',target:'delay',address:'wet',min:0,max:1,smoothMs:100,scale:'linear'}
 ]};
 const param={},hardwareValues=new Map();
 const engine={hardwareValues,automationTarget:()=>({param}),applyHardware(mapping:HardwareMapping,value:number){
  hardwareValues.set(hardwareKey(mapping),{mapping,value,param});return true;
 }} as unknown as AudioEngine;
 function tick(connectors:Connector[],now:number){
  const keep=new Set<string>();runtime.frame(graph,engine,connectors,(...args)=>subscribed.push(args),keep,now);
  for(const key of hardwareValues.keys())if(!keep.has(key))hardwareValues.delete(key);
 }
 tick([connector],0);assert.equal(subscribed.length,1);assert.equal(hardwareValues.size,0);
 connector.modules[0].channels[1]={value:512,at:1};tick([connector],1);
 assert.ok(Math.abs(runtime.values.hz-1000)<1e-8);assert.equal(runtime.values.mix,.5);
 connector.modules[0].channels[1].value=1024;tick([connector],101);
 assert.equal(runtime.values.hz,10000);assert.ok(runtime.values.mix>.8&&runtime.values.mix<.82);
 tick([],200);assert.equal(hardwareValues.size,0);assert.equal(Object.keys(runtime.values).length,0);
 tick([connector],201);assert.equal(runtime.values.mix,1);assert.equal(subscribed.length,2);
});

test('remap sends physical units to effects and can fan out to another remap',()=>{
 const graph:PerformanceGraph={nodes:[
  {id:'cutoff',kind:'effect',name:'Filter',trackId:'bass',device:'filter'},
  {id:'inverse',kind:'remap',name:'Inverse',inMin:200,inMax:800,outMin:1,outMax:0},
  {id:'hz',kind:'remap',name:'Hz',inMin:0,inMax:1,outMin:200,outMax:800},
  {id:'knob',kind:'knob',name:'Knob',value:0.25}
 ],layout:{},links:[{id:'param',source:'hz',target:'cutoff',address:'freq',min:20,max:18000,smoothMs:0,scale:'linear'}],
 routes:[{id:'a',source:'hz',target:'inverse',input:'value'},{id:'b',source:'knob',target:'hz',input:'value'}]};
 const hardwareValues=new Map(),param={};
 const engine={hardwareValues,automationTarget:()=>({param}),applyHardware(mapping:HardwareMapping,value:number){
  hardwareValues.set(hardwareKey(mapping),{mapping,value,param});return true;
 }} as unknown as AudioEngine;
 const runtime=new PerformanceControls();
 runtime.frame(graph,engine,[],()=>{},new Set(),0);
 assert.equal(runtime.values.inverse,0.75);
 assert.equal(runtime.values.param,350);
});

test('OSC arguments drive effects in raw units and Remap converts them explicitly',()=>{
 const graph:PerformanceGraph={layout:{},nodes:[
  {id:'osc',kind:'osc-input',name:'Amount',address:'/control',argument:1,output:'value'},
  {id:'mapped',kind:'remap',name:'Mapped',inMin:0,inMax:500,outMin:0,outMax:1},
  {id:'filter',kind:'effect',name:'Filter',trackId:'t',device:'fx'}
 ],routes:[{id:'edge',source:'osc',target:'mapped',input:'value'}],
 links:[{id:'control',source:'osc',target:'filter',address:'/hz',min:0,max:1000,smoothMs:0,scale:'linear'}]};
 const runtime=new PerformanceControls(),hardwareValues=new Map(),param={};
 const engine={hardwareValues,automationTarget:()=>({param}),applyHardware(mapping:HardwareMapping,value:number){
  hardwareValues.set(hardwareKey(mapping),{mapping,value,param});return true;
 }} as unknown as AudioEngine;
 const samples=new Map<string,(number|string|boolean|null)[]>();
 const frame=()=>runtime.frame(graph,engine,[],()=>{},new Set(),0,samples);
 samples.set('/other',[1,42]);frame();assert.equal(runtime.values.osc,undefined);
 samples.set('/control',[42,250]);frame();assert.deepEqual({...runtime.values},{osc:250,mapped:.5,edge:250,control:250});
 for(const sample of [true,false]){
  samples.set('/control',[42,sample]);frame();assert.equal(runtime.values.osc,Number(sample));
 }
 for(const args of [[42],[42,'123'],[42,NaN],[42,null]]){
  samples.set('/control',args);frame();assert.deepEqual({...runtime.values},{});
 }
});

test('control frames resolve configured MIDI input and expose rising edges for a single frame',()=>{
 const runtime=new PerformanceControls(),values=new Map<string,number>();
 const graph:PerformanceGraph={links:[],layout:{},nodes:[
  {id:'th',kind:'threshold',name:'Threshold',low:.25,high:.75,manualValue:0},
  {id:'cc',kind:'midi-control',name:'Wheel',midiDeviceId:'d',message:'cc',controller:1}
 ],routes:[{id:'v',source:'cc',target:'th',input:'value'}]};
 const frame=()=>runtime.frame(graph,{} as AudioEngine,[],()=>{},new Set(),0,undefined,values);
 frame();assert.equal(runtime.values.th,undefined);
 updateMidiControlValues(graph,'d',[176,1,100],values);frame();
 assert.equal(runtime.values.cc,100/127);assert.equal(runtime.values.th,1);assert.deepEqual(runtime.risingThresholds,['th']);
 updateMidiControlValues(graph,'d',[176,1,64],values);frame();assert.equal(runtime.values.th,1);assert.deepEqual(runtime.risingThresholds,[]);
 updateMidiControlValues(graph,'d',[176,1,0],values);frame();assert.equal(runtime.values.th,0);assert.deepEqual(runtime.risingThresholds,[]);
});

test('independent OSC endpoints resolve the same address and legacy nodes read the default listener',()=>{
 const base={kind:'osc-input' as const,name:'Value',address:'/amount',argument:0,output:'value' as const};
 const graph:PerformanceGraph={layout:{},links:[],nodes:[
  {...base,id:'legacy'}, {...base,id:'explicit',endpointId:'default'}, {...base,id:'stage',endpointId:'stage'}
 ]};
 assert.equal(oscSignalKey('default','/amount'),'/amount');
 assert.equal(oscSignalKey('stage','/amount'),JSON.stringify(['stage','/amount']));
 const values=new Map([['/amount',[2]],[oscSignalKey('stage','/amount'),[5]]]);
 const runtime=new PerformanceControls();
 const frame=()=>runtime.frame(graph,{} as AudioEngine,[],()=>{},new Set(),0,values);
 frame();assert.deepEqual({...runtime.values},{legacy:2,explicit:2,stage:5});
 values.delete(oscSignalKey('stage','/amount'));frame();assert.deepEqual({...runtime.values},{legacy:2,explicit:2});
});
