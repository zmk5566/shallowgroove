import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyProject} from '../src/model/project-files.ts';
import {ArrangementTake} from '../src/model/recording.ts';
import {validateAutomation,type AutomationLane} from '../src/model/automation.ts';

test('arrangement overdub preserves earlier MIDI and closes held notes and sustain',()=>{
 const p=emptyProject(),track=p.tracks[0],take=new ArrangementTake(200);
 track.midi_channel=4;
 track.events=[{tick:0,kind:'midi',channel:4,status:179,data:[1,30],order:0}];
 take.midi(track,[0x91,60,97],200);
 take.midi(track,[0xb1,64,127],205);
 const next=take.finish(p,400),events=next.tracks[0].events;
 assert.equal(track.events.length,1);
 assert.deepEqual(events.map(e=>[e.tick,e.status,...e.data]),[[0,179,1,30],[200,147,60,97],[205,179,64,127],[400,131,60,0],[400,179,64,0]]);
});
test('automation punch preserves surrounding values and coalesces stationary samples',()=>{
 const project=emptyProject(),take=new ArrangementTake(100);
 const lane:AutomationLane={id:'lane',trackId:project.tracks[0].id,device:'mixer',address:'gain',label:'gain',mode:'read',scale:'linear',interpolation:'linear',min:0,max:2,step:0,points:[{tick:0,value:.2},{tick:300,value:.5}]};
 project.automation=[lane];
 for(let tick=100;tick<=200;tick++)take.sample('gain',lane,tick,1.6);
 const next=take.finish(project,201);validateAutomation(next.automation,project.timing.end_tick);
 const points=next.automation![0].points;
 assert.deepEqual(points.map(p=>p.tick),[0,99,100,200,201,300]);assert.equal(points[2].value,.8);assert.deepEqual(points.at(-1),lane.points.at(-1));
});
