import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {zipSync,strToU8} from 'fflate';
import {midiControlKey,updateMidiControlValues,canRoutePerformance,evaluateRemaps,retriggerDivisions,editPerformance,emptyPerformance,mapPerformanceValue,validatePerformance,type PerformanceGraph,type PerformanceLink} from '../src/model/performance.ts';
import {emptyProject,readDocument,unzipDocument,zipDocument} from '../src/model/project-files.ts';
import {History,packFile,type Session} from '../src/model/session.ts';

const link:PerformanceLink={id:'cutoff',source:'hand',target:'filter',address:'/cutoff',min:20,max:2000,smoothMs:80,scale:'log'};
const graph:PerformanceGraph={
 nodes:[{id:'hand',kind:'sensor',name:'Distance',uid:'A0000001',channel:5},{id:'filter',kind:'effect',name:'Filter',trackId:'track',device:'filter-id'}],
 links:[link],layout:{hand:{x:23,y:71}}
};
const routed:PerformanceGraph={
 ...graph,
 nodes:[...graph.nodes,{id:'key',kind:'midi-input',midiDeviceId:'saved-port',name:'Keyboard'},
  {id:'voice',kind:'effect',device:'instrument',trackId:'track',name:'Voice'},
  {id:'tone',kind:'note',pitch:60,velocity:90,lengthMs:200,name:'Tone'},
  {id:'pulse',kind:'retrigger',division:0.5,enabled:true,name:'Pulse'}],
 routes:[
  {id:'pitch',source:'hand',target:'tone',input:'pitch'},
  {id:'trigger',source:'pulse',target:'tone',input:'trigger'},
  {id:'notes',source:'tone',target:'voice',input:'midi'},
  {id:'keyboard',source:'key',target:'voice',input:'midi'}
 ]
};
test('typed routes allow MIDI fan-in, enforce port types and cascade on node removal',()=>{
 validatePerformance(routed);
 const routes=routed.routes!;
 for(const route of [
  {...routes[0],source:'key'}, {...routes[0],input:'trigger' as const},
  {...routes[2],target:'filter'}, {...routes[2],source:'hand'},
  {...routes[2],id:'hand'}, {...routes[2],id:'cutoff'}, {...routes[2],id:'duplicate'},
  {...routes[0],id:'duplicate'}, {...routes[1],id:'duplicate'}
 ])assert.throws(()=>editPerformance(routed,{op:'put_route',route}));
 assert.throws(()=>editPerformance(routed,{op:'put_link',link:{...link,source:'tone'}}));
 assert.throws(()=>editPerformance(routed,{op:'put_node',node:{id:'notes',kind:'knob',name:'X'}}));
 const removed=editPerformance(routed,{op:'remove_node',id:'tone'});
 assert.deepEqual(removed.routes,[routes[3]]);
 const disconnected=editPerformance(routed,{op:'remove_route',id:'pitch'});
 assert.deepEqual(disconnected.routes,routes.slice(1));
 assert.deepEqual(editPerformance(disconnected,{op:'put_route',route:routes[0]}).routes,[...routes.slice(1),routes[0]]);
 assert.equal(routed.routes!.length,4);
});
test('project validation checks complete MIDI source, note and retrigger settings',()=>{
 for(const [id,fields] of [
  ['tone',{velocity:0}],['tone',{pitch:127.5}],['tone',{lengthMs:-1}],['tone',{pitch:undefined}],
  ['key',{midiDeviceId:''}],['pulse',{division:0}],['pulse',{enabled:0}]
 ] as const){
  assert.throws(()=>validatePerformance({...routed,nodes:routed.nodes.map(n=>n.id===id?{...n,...fields}:n)}));
 }
 assert.throws(()=>validatePerformance({...routed,routes:null}));
});
test('remaps accept numeric inputs, reversed ranges and fan-out in dependency order',()=>{
 const a={id:'a',name:'Invert',kind:'remap' as const,inMin:1,inMax:0,outMin:0,outMax:100};
 const b={id:'b',name:'Second',kind:'remap' as const,inMin:0,inMax:100,outMin:50,outMax:0};
 const g:PerformanceGraph={...routed,nodes:[...routed.nodes,b,a],links:[{...link,source:'a'}],routes:[
  ...routed.routes!,{id:'ab',source:'a',target:'b',input:'value'},
  {id:'knob-a',source:'hand',target:'a',input:'value'},
  {id:'velocity',source:'b',target:'tone',input:'velocity'},
  {id:'duration',source:'b',target:'tone',input:'lengthMs'},
  {id:'rate',source:'a',target:'pulse',input:'interval'}]};
 validatePerformance(g);
 const values:Record<string,number>={hand:.25};
 evaluateRemaps(g,values);assert.deepEqual(values,{hand:.25,a:75,b:12.5});
 values.hand=-1;evaluateRemaps(g,values);assert.equal(values.a,100);assert.equal(values.b,0);
 delete values.hand;evaluateRemaps(g,values);assert.deepEqual(values,{});
 assert.equal(canRoutePerformance(b,a,'value',g),false);
 assert.throws(()=>editPerformance(g,{op:'put_route',route:{id:'knob-a',source:'b',target:'a',input:'value'}}),/cycle/i);
 for(const bad of [
  {...a,inMax:1},{...a,outMin:Infinity},
  {...routed.nodes.find(n=>n.id==='pulse'),timing:'unknown'},
  {...routed.nodes.find(n=>n.id==='pulse'),intervalMs:0}
 ])assert.throws(()=>validatePerformance({...g,nodes:g.nodes.map(n=>n.id===bad.id?bad:n)}));
 const constant=editPerformance(g,{op:'put_node',node:{...a,outMax:0}});
 values.hand=4;evaluateRemaps(constant,values);assert.equal(values.a,0);
 assert.ok(retriggerDivisions.some(d=>d.beats===1/3));
 assert.deepEqual(retriggerDivisions.map(d=>d.beats),retriggerDivisions.map(d=>d.beats).sort((a,b)=>a-b));
});
test('every remap port participates in dependency order, cycle checks and manual fallback',()=>{
 const settings={kind:'remap' as const,inMin:0,inMax:1,outMin:0,outMax:1};
 const a={...settings,id:'a',name:'Source',manualValue:.5};
 const b={...settings,id:'b',name:'Minimum',manualValue:.5};
 const c={...settings,id:'c',name:'Destination',manualValue:.75,outMax:20};
 const legacy={...settings,id:'old',name:'Legacy'};
 const g:PerformanceGraph={...routed,nodes:[...routed.nodes,c,b,a,legacy],routes:[
  ...routed.routes!,
  {id:'lower',source:'a',target:'b',input:'inMax'},
  {id:'upper',source:'a',target:'c',input:'outMin'},
  {id:'limit',source:'b',target:'c',input:'inMax'},
  {id:'gate',source:'c',target:'pulse',input:'enabled'}
 ]};
 validatePerformance(g);
 const values:Record<string,number>={};
 evaluateRemaps(g,values);
 assert.deepEqual(values,{a:.5,b:1,c:15.125});
 for(const input of ['value','inMin','inMax','outMin','outMax'] as const){
  assert.equal(canRoutePerformance(c,a,input,g),false);
  assert.throws(()=>editPerformance(g,{op:'put_route',route:{id:'loop',source:'c',target:'a',input}}),/cycle/i);
 }
 const live=editPerformance(g,{op:'put_route',route:{id:'minimum',source:'hand',target:'b',input:'inMin'}});
 evaluateRemaps(live,values);assert.deepEqual(values,{a:.5});
 values.hand=.5;evaluateRemaps(live,values);assert.deepEqual(values,{a:.5,hand:.5});
 evaluateRemaps(editPerformance(live,{op:'remove_route',id:'minimum'}),values);
 assert.equal(values.c,15.125);
 const wired=editPerformance(g,{op:'put_route',route:{id:'live-value',source:'hand',target:'a',input:'value'}});
 delete values.hand;evaluateRemaps(wired,values);assert.deepEqual(values,{});
 const fresh=editPerformance(g,{op:'put_node',node:{...legacy,id:'new'}});
 evaluateRemaps(fresh,values);assert.equal(values.new,0);assert.equal(values.old,undefined);
 assert.throws(()=>editPerformance(g,{op:'put_node',node:{...a,manualValue:NaN}}));
 assert.throws(()=>editPerformance(g,{op:'put_route',route:{id:'badgate',source:'tone',target:'pulse',input:'enabled'}}));
});
test('immutable edits replace by ID, move nodes and cascade deletes',()=>{
 const original=structuredClone(graph);
 let updated=editPerformance(graph,{op:'put_node',node:{id:'wheel',kind:'knob',name:'Wheel',value:0.25}});
 updated=editPerformance(updated,{op:'move_node',id:'wheel',x:53,y:8});
 updated=editPerformance(updated,{op:'put_link',link:{...link,source:'wheel'}});
 updated=editPerformance(updated,{op:'put_node',node:{...updated.nodes[2],value:0.8}});
 assert.equal(updated.nodes.length,3);assert.equal(updated.nodes[2].value,0.8);assert.equal(updated.links.length,1);
 assert.deepEqual(editPerformance(updated,{op:'remove_link',id:link.id}).links,[]);
 const removed=editPerformance(updated,{op:'remove_node',id:'wheel'});
 assert.deepEqual(removed.nodes,graph.nodes);assert.deepEqual(removed.links,[]);assert.deepEqual(removed.layout,graph.layout);
 assert.deepEqual(graph,original);
});
test('validates offline and unassigned hardware, rejects ambiguous bindings and corrupt links',()=>{
 validatePerformance(emptyPerformance());validatePerformance(graph);
 validatePerformance({...graph,nodes:[{id:'hand',kind:'sensor',name:'Unassigned'},graph.nodes[1]]});
 for(const broken of [
  {...graph,nodes:[...graph.nodes,graph.nodes[0]]},
  {...graph,links:[link,link]},
  {...graph,links:[link,{...link,id:'other'}]},
  {...graph,links:[{...link,target:'missing'}]},
  {...graph,links:[{...link,source:'filter'}]},
  {...graph,links:[{...link,target:'hand'}]},
  {...graph,links:[{...link,max:0}]},
  {...graph,links:[{...link,min:0}]},
  {...graph,links:[{...link,smoothMs:-1}]},
  {...graph,layout:{missing:{x:0,y:0}}},
  {...graph,nodes:[{...graph.nodes[0],channel:256},graph.nodes[1]]}
 ])assert.throws(()=>validatePerformance(broken));
 assert.throws(()=>editPerformance(graph,{op:'move_node',id:'unknown',x:0,y:0}));
});
test('samples clamp to physical bounds and smoothing is invariant to sampling interval',()=>{
 assert.equal(mapPerformanceValue(link,-10),20);assert.equal(mapPerformanceValue(link,4),2000);
 assert.ok(Math.abs(mapPerformanceValue(link,0.5)-200)<1e-10);
 assert.equal(mapPerformanceValue({...link,min:-4,max:4,scale:'linear'},0.75),2);
 assert.equal(mapPerformanceValue(link,1,20,0),20);
 assert.equal(mapPerformanceValue({...link,smoothMs:0},1,20,0),2000);
 const value=mapPerformanceValue(link,1,20,80);
 assert.ok(Math.abs(value-(2000-1980*Math.exp(-1)))<1e-10);
 assert.ok(Math.abs(mapPerformanceValue(link,1,mapPerformanceValue(link,1,20,40),40)-value)<1e-10);
 assert.throws(()=>mapPerformanceValue(link,NaN));
});
test('graph, canvas state and workspace view survive packed sessions, history and split repository ZIPs',()=>{
 const old:Session={project:{...emptyProject(),tracks:[]},voices:[],chains:[[],[],[]],sends:[],buses:Array.from({length:3},()=>({level:1,muted:false}))};
 let saved=editPerformance(routed,{op:'put_node',node:{id:'pulse',kind:'retrigger',name:'Clock',division:1/3,enabled:true,timing:'free',intervalMs:280}});
 saved=editPerformance(saved,{op:'put_node',node:{id:'rate',kind:'remap',name:'Rate',inMin:0,inMax:1,outMin:750,outMax:50}});
 saved=editPerformance(saved,{op:'put_route',route:{id:'range-input',source:'hand',target:'rate',input:'value'}});
 saved=editPerformance(saved,{op:'put_route',route:{id:'rate-input',source:'rate',target:'pulse',input:'interval'}});
 const current={...old,project:{...old.project,performance:saved}};
 const history=new History();history.push(old,current,'Live mapping','user');
 const visual={mode:'stack',selectedNode:'hand',x:32,y:73};
 assert.equal(packFile(old).minAppVersion,'0.3.12');
 assert.equal(packFile({...old,project:{...old.project,performance:emptyPerformance()}}).minAppVersion,'0.6.0-dev.1');
 assert.equal(packFile(old,history).minAppVersion,'0.6.0-dev.1');
 const raw={...packFile(current,history),editor:{workspaceView:'performance',performanceVisual:visual}};
 const text=JSON.stringify(raw),legacy=readDocument(JSON.stringify(packFile(old)));
 assert.equal(legacy.session.project.performance,undefined);
 const packed=readDocument(unzipDocument(zipDocument(text)));
 assert.deepEqual(packed.history.entries[0].after.project.performance,saved);assert.equal(packed.history.entries[0].before.project.performance,undefined);
 const {split}=createRequire(import.meta.url)('../desktop/music-tree.cjs');
 const sources=split(text) as Map<string,string>;
 const archive=zipSync(Object.fromEntries([...sources].map(([path,content])=>[path,strToU8(content)])));
 const restored=readDocument(unzipDocument(archive));
 assert.deepEqual(restored.session.project.performance,saved);assert.equal(restored.editor.workspaceView,'performance');
 assert.deepEqual(restored.editor.performanceVisual,visual);
 const invalid=readDocument(JSON.stringify({...raw,editor:{workspaceView:'unknown',performanceVisual:{...visual,selectedNode:'missing',y:-1}}}));
 assert.equal(invalid.editor.workspaceView,undefined);assert.deepEqual(invalid.editor.performanceVisual,{...visual,y:0,selectedNode:null});
 assert.throws(()=>readDocument(JSON.stringify({...raw,session:{...raw.session,project:{...raw.session.project,performance:{}}}})),/performance graph/);
});
test('new nodes receive distinct persisted space around manually positioned cards',()=>{
 let g=emptyPerformance();
 for(let i=0;i<8;i++){
  const id='knob'+i;
  g=editPerformance(g,{op:'put_node',node:{id,kind:'knob',name:id}});
  if(i===0)g=editPerformance(g,{op:'move_node',id,x:245,y:45});
  const p=g.layout[id];
  for(const [other,q] of Object.entries(g.layout)){
   if(id!==other)assert.ok(Math.abs(p.x-q.x)>=220||Math.abs(p.y-q.y)>=155);
  }
 }
 const updated=editPerformance(g,{op:'put_node',node:{...g.nodes[3],name:'renamed'}});
 assert.deepEqual(updated.layout,g.layout);
});
test('node and link IDs share a namespace and reject prototype keys',()=>{
 for(const id of ['__proto__','constructor','prototype','toString','cutoff']){
  assert.throws(()=>editPerformance(graph,{op:'put_node',node:{id,kind:'knob',name:'Knob'}}));
 }
 for(const id of ['hand','__proto__','constructor','prototype','toString']){
  assert.throws(()=>editPerformance(graph,{op:'put_link',link:{...link,id}}));
 }
});

test('OSC input declarations and value/trigger output wiring are validated',()=>{
 const value={kind:'osc-input' as const,id:'osc',name:'Pressure',address:'/pad/1',argument:0,output:'value' as const};
 const trigger={...value,id:'hit',output:'trigger' as const};
 const g:PerformanceGraph={...routed,nodes:[...routed.nodes,value,trigger],links:[{...link,source:'osc'}],
  routes:routed.routes!.map(r=>r.input==='pitch'?{...r,source:'osc'}:r.input==='trigger'?{...r,source:'hit'}:r)};
 validatePerformance(g);
 validatePerformance(JSON.parse(JSON.stringify(g)));
 for(const fields of [{endpointId:''},{endpointId:123},{address:'pad'},{address:'/contains space'},{argument:-1},{argument:1.2},{output:'midi'}])
  assert.throws(()=>validatePerformance({...g,nodes:g.nodes.map(n=>n.id==='osc'?{...n,...fields}:n)}));
 for(const [id,source] of [['pitch','hit'],['trigger','osc']])
  assert.throws(()=>validatePerformance({...g,routes:g.routes!.map(r=>r.id===id?{...r,source}:r)}));
 assert.throws(()=>validatePerformance({...g,links:[{...link,source:'hit'}]}));
});

test('MIDI controls match device and channel and normalize CC, bend and pressure',()=>{
 const base={kind:'midi-control' as const,name:'Source',midiDeviceId:'keys'};
 const cc={...base,id:'cc',message:'cc' as const,controller:7,channel:2};
 const bend={...base,id:'bend',message:'bend' as const,channel:0};
 const pressure={...base,id:'pressure',message:'pressure' as const};
 const g={...emptyPerformance(),nodes:[cc,bend,pressure]};
 validatePerformance(g);
 const values=new Map<string,number>();
 const send=(data:number[],device='keys')=>updateMidiControlValues(g,device,data,values);
 assert.equal(send([0xb0,7,64]),false);assert.equal(send([0xb1,6,64]),false);
 assert.equal(send([0xb1,7,64],'other'),false);assert.equal(send([0xb1,7]),false);
 assert.ok(send([0xb1,7,64]));assert.equal(values.get(midiControlKey(cc)),64/127);
 for(const [lo,hi,result] of [[0,0,0],[0,64,.5],[127,127,1]]){
  assert.ok(send([0xef,lo,hi]));assert.equal(values.get(midiControlKey(bend)),result);
 }
 assert.ok(send([0xd5,127]));assert.equal(values.get(midiControlKey(pressure)),1);
 for(const bad of [{...cc,channel:17},{...cc,controller:128},{...cc,controller:undefined}])
  assert.throws(()=>validatePerformance({...g,nodes:[bad]}));
});

test('mixed numeric DAG quantizes raw pitches and remembers threshold hysteresis only while connected',()=>{
 const scale={kind:'scale' as const,id:'q',name:'C major',root:0,scale:'major' as const,manualValue:61};
 const threshold={kind:'threshold' as const,id:'h',name:'Gate',manualValue:0,low:50,high:80};
 const remap={kind:'remap' as const,id:'r',name:'Range',manualValue:0,inMin:0,inMax:1,outMin:48,outMax:96};
 const g:PerformanceGraph={...routed,nodes:[threshold,scale,remap,...routed.nodes],routes:[
  ...routed.routes!,{id:'r-q',source:'r',target:'q',input:'value'},
  {id:'q-h',source:'q',target:'h',input:'value'},{id:'hand-r',source:'hand',target:'r',input:'value'}]};
 validatePerformance(g);
 const state=new Map<string,boolean>(),rises:string[]=[];
 function step(input?:number){
  const values:Record<string,number>={};if(input!==undefined)values.hand=input;
  evaluateRemaps(g,values,state,rises);return values;
 }
 assert.equal(step(13/48).q,60);assert.equal(step(1).h,1);assert.equal(step(.5).h,1);assert.equal(step(0).h,0);
 assert.equal(step(1).h,1);assert.equal(step().h,undefined);assert.equal(step(.5).h,0);
 assert.deepEqual(rises,['h','h']);
 assert.equal(canRoutePerformance(threshold,remap,'inMax',g),false);
 assert.throws(()=>editPerformance(g,{op:'put_route',route:{id:'loop',source:'h',target:'r',input:'inMax'}}),/cycle/i);
 assert.throws(()=>editPerformance(g,{op:'put_route',route:{id:'other',source:'h',target:'tone',input:'gate'}}));
 assert.throws(()=>editPerformance(g,{op:'put_route',route:{id:'bad',source:'q',target:'tone',input:'trigger'}}));
 assert.throws(()=>editPerformance(g,{op:'put_node',node:{...scale,root:12}}));
});
