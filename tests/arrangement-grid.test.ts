import test from 'node:test';
import assert from 'node:assert/strict';
import {gridTick,gridMarks,autoDivision} from '../src/model/arrangement-grid.ts';
import {meterMap} from '../src/model/meter.ts';
import {emptyProject} from '../src/model/project-files.ts';

test('straight, triplet and free snapping with project and shortened measure boundaries',()=>{
 const p=emptyProject(),q=p.timing.ppqn;
 p.global_events.push({kind:'meta',order:1,type:88,tick:7*q,data:[3,2,24,8]});
 const m=meterMap(p);
 assert.equal(gridTick(m,q,315,'1/4',true),320);
 assert.equal(gridTick(m,q,315,'1/8',false),240);
 assert.equal(gridTick(m,q,315.6,'off',false),316);
 assert.equal(gridTick(m,q,7*q-5,'4 bars',false),7*q);
 assert.equal(gridTick(m,q,7*q+158,'1/8',true),7*q+160);
 assert.equal(gridTick(m,q,310,'1/4',false,311),311);
 assert.deepEqual(gridMarks(m,q,0,960,'1/4',true,500),[0,320,640,960]);
 assert.equal(autoDivision(1000,q,m[0],false),'4 bars');
 assert.equal(autoDivision(1,q,m[0],false),'1/32');
});
