import test from 'node:test';
import assert from 'node:assert/strict';
import {PerformanceSignals,type OscEndpoint} from '../src/hardware/performance-signals.ts';
import {oscSignalKey} from '../src/model/performance.ts';

test('two endpoints keep independent readings for the same address through rename, rebind and removal',async()=>{
 const first={id:'default',name:'Controller',host:'127.0.0.1',port:9000,enabled:true};
 const other={...first,id:'pd',name:'Pd',port:9001};
 let endpoints:OscEndpoint[]=[first,other];
 const signals=new PerformanceSignals({status:async()=>({endpoints}),configure:async change=>{
  endpoints=change.op==='remove'?endpoints.filter(e=>e.id!==change.id):endpoints.map(e=>e.id===change.endpoint.id?change.endpoint:e);
  return {endpoints};
 },onMessages:()=>()=>{}});
 await signals.initialize();
 let renders=0;const unsubscribe=signals.subscribe(()=>renders++);
 for(let i=0;i<60;i++)signals.receive({address:'/xy',args:[i],time:i});
 signals.receive({endpointId:'pd',address:'/xy',args:[123],time:0});signals.publish();signals.publish();
 assert.equal(renders,1);
 assert.deepEqual(signals.snapshot().rows.map(r=>[r.endpointId,r.history.length]),[['pd',1],['default',48]]);
 await signals.configure({op:'put',endpoint:{...other,name:'Touch'}});
 assert.deepEqual(signals.oscValues.get(oscSignalKey('pd','/xy')),[123]);
 await signals.configure({op:'put',endpoint:{...other,port:9010}});
 assert.equal(signals.snapshot().rows.length,1);
 assert.deepEqual(signals.oscValues.get('/xy'),[59]);
 await signals.configure({op:'remove',id:'default'});
 assert.equal(signals.receive({address:'/xy',args:[1],time:80}),false);
 assert.equal(signals.oscValues.size,0);
 unsubscribe();
});
