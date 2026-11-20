import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rememberParameter,type ParameterEdit} from '../src/model/parameter-focus.ts';
test('recent parameters deduplicate exact targets, retain five distinct edits and isolate sessions',()=>{
 let recent:ParameterEdit[]=[];for(let i=0;i<7;i++)recent=rememberParameter(recent,{generation:'session',trackId:'track',device:'fx',address:String(i),value:i,at:i});
 assert.deepEqual(recent.map(p=>p.address),['6','5','4','3','2']);recent=rememberParameter(recent,{...recent[2],value:99,at:10});assert.deepEqual(recent.map(p=>p.address),['4','6','5','3','2']);assert.equal(recent[0].value,99);
 recent=rememberParameter(recent,{...recent[0],trackId:'other-track'});assert.equal(recent.length,5);assert.equal(recent[1].trackId,'track');
 recent=rememberParameter(recent,{...recent[0],generation:'next-session'});assert.equal(recent.length,1);
});
