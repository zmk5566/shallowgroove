import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {packFile,type Session} from '../src/model/session.ts';
import {readDocument,zipDocument,unzipDocument} from '../src/model/project-files.ts';
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const project=JSON.parse(read('demo-projects/Korobeiniki.json'));
const manifest=JSON.parse(read('patches/korobeiniki/manifest.json'));
test('Korobeiniki covers every instrument, preserves notes and saves its patch bank',()=>{
 assert.equal(project.tracks.length,4);
 const notes=project.tracks.flatMap((t:{events:{status:number;data:number[];order:number}[]})=>t.events.filter(e=>e.status>>4===9&&e.data[1]>0));
 assert.ok(notes.length>0);
 assert.deepEqual([...new Set(project.tracks.map((t:{midi_channel:number})=>t.midi_channel))],[1,2,3,4]);
 assert.equal(manifest.patches.length,4);
 const voices=project.tracks.map((t:{id:string})=>{
  const patch=manifest.patches.find((p:{track_id:string})=>p.track_id===t.id);assert.ok(patch,t.id);
  const code=read('patches/korobeiniki/'+patch.file);assert.equal(createHash('sha256').update(code).digest('hex'),patch.source_sha256);
  assert.ok(patch.parameters.length>0);for(const p of patch.parameters)assert.ok(p.default>=p.min&&p.default<=p.max);
  return {code,values:{},trim:patch.mix_gain,basePan:patch.pan};
 });
 const session:Session={project,voices,chains:Array.from({length:7},()=>[]),sends:Array.from({length:4},()=>({delay:0,reverb:0})),buses:Array.from({length:3},()=>({level:1,muted:false}))};
 const text=JSON.stringify({...packFile(session),editor:{exampleId:'Korobeiniki',soundSet:'period',codeDrafts:{}}});
 const saved=readDocument(unzipDocument(zipDocument(text)));assert.equal(saved.editor.exampleId,'Korobeiniki');assert.deepEqual(saved.session.voices,voices);
});
