import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {timeline,tickToSeconds,notesOf,type Project} from '../src/model/project.ts';
test('tempo changes preserve musical time and same-tick source ordering',()=>{
 const p:Project={schema:'test',title:'test',timing:{ppqn:100,end_tick:300,default_tempo_us_per_quarter:500000},global_events:[{kind:'meta',type:81,tick:100,order:0,data:[15,66,64]}],tracks:[{id:'a',name:'a',midi_channel:1,gain:1,pan:0,mute:false,solo:false,events:[{kind:'midi',tick:200,order:2,data:[60,0],status:128},{kind:'midi',tick:200,order:1,data:[60,100],status:144}]}]};
 assert.equal(tickToSeconds(p,200),1.5);assert.equal(tickToSeconds(p,300),2.5);assert.deepEqual(timeline(p).map(e=>e.order),[1,2]);
});
test('all supplied channels survive; source MIDI is not mistaken for one musical track',()=>{
 for(const [name,count,duration] of [['DaisyBell',3,38.760],['Korobeiniki',4,145.557]] as const){
 const p=JSON.parse(readFileSync(new URL(`../demo-projects/${name}.json`,import.meta.url),'utf8')) as Project;
 assert.equal(p.tracks.length,count);assert.ok(Math.abs(tickToSeconds(p,p.timing.end_tick)-duration)<0.002);
 assert.equal(timeline(p).length,p.tracks.reduce((n,t)=>n+t.events.length,0));
 assert.ok(p.tracks.some(t=>notesOf(t,p.timing.end_tick).length>0));
 }
});
