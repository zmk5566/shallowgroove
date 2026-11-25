import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWorkspace,workspacePromptSummary} from '../src/assistant/workspace.ts';
import {allowsMusicCommand,buildMusicTools} from '../server/music-plugin/index.mjs';

const workspace = {
 view:'session',focus:{clipId:'clip'},clips:[{id:'clip'}],
 arrangement:[{trackId:'t',references:[{refId:'placement',clipId:'clip'}]}],
 scenes:[{id:'s',slots:[{trackId:'t',clipId:'clip'}]}],live:[],
 performance:{
  osc:{endpoints:[{id:'stage',running:true,port:9000}],recent:[{endpointId:'stage',address:'/hit',args:[59,true]}]},
  visual:{selectedNode:'k',viewport:{x:0,y:0,width:640,height:400}},
  graph:{nodes:[{id:'k',kind:'knob'},{id:'fx',kind:'effect'}],links:[{id:'map'}],routes:[{id:'r',source:'note',target:'synth',input:'midi'}],layout:{k:{x:14,y:25}}},
  devices:[{trackId:'t',device:'fx',parameters:[{address:'/gain',min:0,max:1}]}],sensors:[],midiInputs:[{id:'in',name:'Keyboard',enabled:false}],values:{k:0.7,map:0.2}
 }
};
test('inspect any studio view, including positions, current viewport, source and mapped values',()=>{
 const read=(section:Parameters<typeof inspectWorkspace>[1]['section'])=>inspectWorkspace(workspace,{section});
 assert.equal(read('overview').visual,workspace.performance.visual);
 assert.deepEqual(read('osc').osc,workspace.performance.osc);
 assert.deepEqual(read('routes').items,workspace.performance.graph.routes);
 assert.deepEqual(read('midiInputs').items,workspace.performance.midiInputs);
 assert.deepEqual(read('slots').items,[{sceneId:'s',trackId:'t',clipId:'clip'}]);
 assert.deepEqual(read('arrangement').items,[{trackId:'t',refId:'placement',clipId:'clip'}]);
 assert.deepEqual(read('controls').items,[{trackId:'t',device:'fx',address:'/gain',min:0,max:1}]);
 assert.deepEqual(read('links').items,[{id:'map',liveValue:0.2}]);
 const page=inspectWorkspace(workspace,{section:'nodes',limit:1});
 assert.deepEqual(page.items,[{id:'k',kind:'knob',position:{x:14,y:25},liveValue:0.7}]);
 assert.equal(page.nextOffset,1);
 assert.equal(inspectWorkspace(workspace,{section:'nodes',offset:1}).nextOffset,null);
 assert.throws(()=>inspectWorkspace(workspace,{limit:0}));
 assert.throws(()=>inspectWorkspace({view:'vst-effect'},{}));
});
test('initial snapshot remains bounded while full sections remain inspectable',()=>{
 const large={...workspace,clips:Array.from({length:3000},(_,i)=>({id:'clip-'+i}))};
 const compact=workspacePromptSummary(large);
 assert.ok(JSON.stringify(compact).length<2000);
 assert.deepEqual(compact.focus,{clipId:'clip'});
 assert.equal(compact.counts.clips,3000);
 assert.equal(inspectWorkspace(large,{section:'clips',offset:2999}).items?.length,1);
});
test('real DSH tool calls send typed graph edits, view navigation and inspections to the browser bridge',async t=>{
 const sent:unknown[]=[];
 t.mock.method(globalThis,'fetch',async (_url,init)=>{sent.push(JSON.parse(init.body));return Response.json({result:{ok:true}});});
 const tools=buildMusicTools();
 const node={id:'k',kind:'knob',name:'Intensity',value:.4};
 const link={id:'m',source:'k',target:'fx',address:'/mix',min:0,max:1,smoothMs:20,scale:'linear'};
 const cases=[
  ['inspect_workspace',{section:'osc'},{action:'inspect_workspace',section:'osc'}],
  ['inspect_workspace',{section:'nodes'},{action:'inspect_workspace',section:'nodes'}],
  ['set_workspace_view',{view:'performance'},{action:'set_workspace_view',view:'performance'}],
  ...[['put_node',{node}],['move_node',{id:'k',x:50,y:70}],['remove_node',{id:'k'}],['put_link',{link}],['remove_link',{id:'m'}],['put_route',{route:workspace.performance.graph.routes[0]}],['remove_route',{id:'r'}],['put_node',{node:{id:'n',name:'Note',kind:'note',pitch:64,velocity:100,lengthMs:250}}],['put_node',{node:{id:'p',name:'Pulse',kind:'retrigger',enabled:true,division:.5,timing:'free',intervalMs:250}}],['put_node',{node:{id:'r1',name:'Range',kind:'remap',manualValue:65,inMin:0,inMax:1,outMin:90,outMax:50}}],...[
    {id:'mc',kind:'midi-control',name:'Wheel',midiDeviceId:'in',channel:2,message:'cc',controller:1},
    {id:'q',kind:'scale',name:'Scale',root:3,scale:'minor',manualValue:60},
    {id:'g',kind:'threshold',name:'Gate',low:.2,high:.8,manualValue:0}
   ].map(node=>['put_node',{node}]),...['value','trigger'].map(output=>['put_node',{node:{id:'osc',kind:'osc-input',name:'OSC',address:'/volume',endpointId:'stage',argument:0,output}}]),...['low','high','gate','value','inMin','inMax','outMin','outMax','interval','enabled','lengthMs','velocity'].map(input=>['put_route',{route:{id:'edge',source:'r1',target:'dest',input}}]),['put_node',{node:{id:'i',name:'Keyboard',kind:'midi-input',midiDeviceId:'in'}}]].map(([op,args])=>[
   String(op).replace('_','_performance_'),args,{action:'edit_performance',edit:{op,...args as object}}
  ])
 ] as const;
 for(const [name,args,expected] of cases){
  const tool=tools.find(x=>x.name===name)!;
  await tool.execute(args,{signal:AbortSignal.timeout(1000)});
  assert.deepEqual(sent.at(-1),expected);
  assert.ok(allowsMusicCommand(expected.action,false));
  assert.equal(allowsMusicCommand(expected.action,true),false);
 }
 const n=sent.length;
 for(const [name,args] of [['move_performance_node',{id:'k',x:5}],['put_performance_link',{link:{...link,scale:'dB'}}],['set_workspace_view',{view:'vst-effect'}]]){
  await assert.rejects(()=>tools.find(x=>x.name===name)!.execute(args,{}));
 }
 assert.equal(sent.length,n);
 const before=process.env.SHALLOWGROOVE_FX;
 try{
  process.env.SHALLOWGROOVE_FX='1';
  assert.deepEqual(buildMusicTools().map(x=>x.name).sort(),['inspect_selection','load_library_effect','replace_faust_patch','search_effect_library','set_patch_parameter']);
 }finally{if(before===undefined)delete process.env.SHALLOWGROOVE_FX;else process.env.SHALLOWGROOVE_FX=before;}
});
