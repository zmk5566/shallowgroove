import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/model/piano-roll.ts';
function available(){return api;}
test('grid uses quarter-note PPQN and snaps to integer ticks, with a one-tick free mode',()=>{
 const {gridTicks,snapTick}=available();assert.equal(gridTicks(480,16),120);assert.equal(gridTicks(96,8),48);assert.equal(gridTicks(480,0),1);assert.equal(snapTick(179,120),120);assert.equal(snapTick(-20,120),0);
});
test('group movement preserves spacing and clamps the group at pitch/time boundaries',()=>{
 const {moveNotes}=available(),notes=[{id:'a',tick:120,end:360,pitch:2,velocity:80},{id:'b',tick:480,end:720,pitch:7,velocity:90}];
 assert.deepEqual(moveNotes(notes,-240,-5),[{id:'a',tick:0,end:240,pitch:0},{id:'b',tick:360,end:600,pitch:5}]);
 assert.deepEqual(moveNotes(notes,120,130).map(n=>n.pitch),[122,127]);
});
test('resizing clamps as a group and never creates zero-length notes',()=>{
 const {resizeNotes}=available(),notes=[{id:'a',tick:0,end:240,pitch:60,velocity:80},{id:'b',tick:480,end:600,pitch:64,velocity:90}];
 assert.deepEqual(resizeNotes(notes,-480,120),[{id:'a',end:240},{id:'b',end:600}]);
 assert.deepEqual(resizeNotes(notes,120,120),[{id:'a',end:360},{id:'b',end:720}]);
});
test('pixel coordinates account for piano keys and ruler before mapping pitch/time',()=>{
 const {pointToNote}=available();assert.deepEqual(pointToNote(148,44,48,20,10,100,480),{tick:480,pitch:125});
});
