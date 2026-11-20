import test from 'node:test';
import assert from 'node:assert/strict';
import {finiteRange,sendTarget,resolveParameterTarget,resolveChannelTarget} from '../src/assistant/contracts.ts';

test('patch and instrument sends resolve to their owning track, never a return bus',()=>{
 assert.equal(sendTarget({channel:7,device:'instrument'}),7);
 assert.equal(sendTarget({channel:7,device:'effect-uuid'}),7);
 for(const channel of ['delay','reverb','master'] as const)assert.throws(()=>sendTarget({channel,device:'effect-uuid'}),/Select a MIDI track/);
});
test('invalid or non-finite parameters fail rather than clamp silently',()=>{
 for(const value of [-1,1.1,NaN,Infinity,'0.2',undefined])assert.throws(()=>finiteRange(value,0,1));
 assert.equal(finiteRange(.2,0,1),.2);
});

test('channel selection resolves its unique instrument parameter without a manual click',()=>{
 const devices=[{id:'instrument',controls:[{address:'/Muted_Rhythm_Pluck/Cutoff',label:'Cutoff'}]},{id:'compressor-1',controls:[{address:'/Compressor/Threshold',label:'Threshold'}]}];
 assert.deepEqual(resolveParameterTarget({channel:5,device:'channel'},'Cutoff',devices),{selection:{channel:5,device:'instrument'},address:'/Muted_Rhythm_Pluck/Cutoff'});
 assert.equal(resolveParameterTarget({channel:5,device:'channel'},'/Compressor/Threshold',devices).selection.device,'compressor-1');
});
test('duplicate effect parameters require disambiguation; explicit device resolves it',()=>{
 const devices=['delay-1','delay-2'].map(id=>({id,controls:[{address:'/Delay/Feedback',label:'Feedback'}]}));
 assert.throws(()=>resolveParameterTarget({channel:5,device:'channel'},'Feedback',devices),/Ambiguous.*delay-1.*delay-2/);
 assert.equal(resolveParameterTarget({channel:5,device:'delay-2'},'Feedback',devices).selection.device,'delay-2');
 assert.throws(()=>resolveParameterTarget({channel:5,device:'removed-effect'},'Feedback',devices),/Unknown/);
});
test('agent navigation uses one-based channels or stable IDs and rejects invalid destinations',()=>{
 const ids=['midi-channel-1','midi-channel-2'];
 assert.equal(resolveChannelTarget(0,'2',ids),1);assert.equal(resolveChannelTarget(0,'midi-channel-2',ids),1);
 assert.equal(resolveChannelTarget(0,'master',ids),'master');assert.equal(resolveChannelTarget(1,undefined,ids),1);
 for(const bad of ['0','3','-1','1.5','unknown'])assert.throws(()=>resolveChannelTarget(0,bad,ids));
});
