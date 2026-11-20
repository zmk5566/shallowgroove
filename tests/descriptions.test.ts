import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {localize} from '../src/model/descriptions.ts';
const read=(path:string)=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const validate=new Ajv2020().compile(read('../schemas/track-descriptions.schema.json'));
test('descriptors validate, preserve every track ID and reference real source assets',()=>{
 for(const name of ['Korobeiniki','DaisyBell']){
  const d=read(`../track-descriptions/${name}.json`),p=read(`../demo-projects/${name}.json`);
  assert.ok(validate(d),JSON.stringify(validate.errors));
  assert.deepEqual(d.tracks.map((t:{id:string})=>t.id),p.tracks.map((t:{id:string})=>t.id));
  assert.equal(d.source_midi.sha256,p.source.sha256);
  assert.equal(d.source_midi.sha256,createHash('sha256').update(readFileSync(new URL(d.source_midi.path,import.meta.url))).digest('hex'));
  if(name==='DaisyBell'){
   assert.equal(p.timing.ppqn,384);assert.equal(p.timing.end_tick,46080);
   assert.deepEqual(d.tracks.map((t:{source:{statistics:{note_on_count:number}}})=>t.source.statistics.note_on_count),[181, 51, 4]);
  }else assert.equal(p.tracks.length,4);
  for(const t of d.tracks){assert.ok(t.name.en);assert.ok(t.name['zh-CN']);assert.ok(d.faust_instruments[t.faust.initial_assignment]);assert.equal(t.faust.proposal.dsp_source,null);}
  const f=d.faust_instruments['shallow-synth-v1'];
  assert.equal(f.source_sha256,createHash('sha256').update(readFileSync(new URL('../src/audio/synth.dsp',import.meta.url))).digest('hex'));
  for(const param of f.parameters){assert.ok(param.default>=param.min&&param.default<=param.max);assert.ok(param.description.en&&param.description['zh-CN']);}
 }
});
test('language fallback is deterministic for missing translations',()=>{
 assert.equal(localize({'zh-CN':'鼓组',en:'Drums'},'en'),'Drums');
 assert.equal(localize({'zh-CN':'鼓组'},'en'),'鼓组');
 assert.equal(localize(undefined,'en','Unknown'),'Unknown');
});
