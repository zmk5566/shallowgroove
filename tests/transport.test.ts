import test from 'node:test';
import assert from 'node:assert/strict';
import {chaseMidi,type TimedMidi} from '../src/audio/transport.ts';
const event=(seconds:number,status:number,data:number[],trackIndex=0):TimedMidi=>({seconds,status,data,trackIndex});
test('seek chases held notes and last controller values, leaving destination events queued',()=>{
 const events=[event(0,0xb0,[7,100]),event(1,0x90,[60,90]),event(2,0xe0,[0,70]),event(3,0xb0,[7,80]),event(5,0x80,[60,0])];
 const state=chaseMidi(events,5);assert.equal(state.cursor,4);assert.deepEqual(state.messages.map(m=>m.data),[[0xb0,7,80],[0xe0,0,70],[0x90,60,90]]);
 assert.ok(!chaseMidi(events,6).messages.some(m=>m.data[0]===0x90));assert.deepEqual(chaseMidi(events,0),{cursor:0,messages:[]});
});
test('sustain chase restores pedal-held notes and releases them when the pedal is lifted',()=>{
 const events=[event(0,0x90,[60,100]),event(1,0xb0,[64,127]),event(2,0x80,[60,0]),event(4,0xb0,[64,0])];
 assert.deepEqual(chaseMidi(events,3).messages.map(m=>m.data),[[0xb0,64,127],[0x90,60,100],[0x80,60,0]]);
 assert.deepEqual(chaseMidi(events,5).messages.map(m=>m.data),[[0xb0,64,0]]);
});
test('notes are isolated by track and overlapping note-offs consume one note at a time',()=>{
 const events=[event(0,0x90,[60,80]),event(1,0x90,[60,100]),event(1,0x90,[60,70],1),event(2,0x80,[60,0]),event(3,0xb0,[120,0])];
 assert.deepEqual(chaseMidi(events,2.5).messages.map(m=>[m.trackIndex,...m.data]),[[0,0x90,60,100],[1,0x90,60,70]]);
 assert.deepEqual(chaseMidi(events,4).messages.map(m=>[m.trackIndex,...m.data]),[[1,0x90,60,70]]);
});
