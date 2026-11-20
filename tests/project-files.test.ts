import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packFile,type Session} from '../src/model/session.ts';
import {readDocument,zipDocument,unzipDocument,emptyProject,documentFingerprint} from '../src/model/project-files.ts';
const session:Session={project:emptyProject(),voices:[],chains:[[],[],[]],sends:[],buses:[{level:1,muted:false},{level:1,muted:false},{level:1,muted:false}]};
session.project.tracks=[];
const text=JSON.stringify({...packFile(session),editor:{exampleId:'DaisyBell',soundSet:'basic',codeDrafts:{track:'unfinished DSP'}}});
test('ZIP preserves the existing music document and uncompiled editor source',()=>{
 assert.equal(unzipDocument(zipDocument(text)),text);assert.equal(readDocument(text).editor.codeDrafts.track,'unfinished DSP');
});
test('invalid documents/ZIPs are rejected before loading audio',()=>{
 assert.throws(()=>readDocument('{"version":99}'));assert.throws(()=>unzipDocument(new Uint8Array([0,1,2])));
});
test('new project has a stable empty MIDI track and eight bars at 120 BPM',()=>{
 const p=emptyProject();assert.equal(p.tracks.length,1);assert.equal(p.tracks[0].events.length,0);assert.equal(p.timing.end_tick,p.timing.ppqn*32);assert.equal(p.timing.default_tempo_us_per_quarter,500000);
});
test('save history options do not mark unchanged music as dirty',()=>{
 const raw=JSON.parse(text);assert.equal(documentFingerprint(text),documentFingerprint(JSON.stringify({...raw,conversation:[],name:'New name'})));
});
test('named ZIP exports retain the user project name and effect source drafts',()=>{
 const raw=JSON.parse(text);raw.name='My song';raw.editor.effectDrafts={fx1:'unfinished effect DSP'};
 const loaded=readDocument(unzipDocument(zipDocument(JSON.stringify(raw))));assert.equal(loaded.name,'My song');assert.equal(loaded.editor.effectDrafts?.fx1,'unfinished effect DSP');
});

test('import music repository ZIP inside a download folder',async()=>{
 const {zipSync,strToU8}=await import('fflate');
 const s={format:'shallowgroove-project',version:1,name:'Shared arrangement',layout:1,tracks:[],song:{title:'Music',timing:{ppqn:480,end_tick:1920,default_tempo_us_per_quarter:500000},global_events:[]},busChains:[[],[],[]],buses:Array(3).fill({level:1,muted:false})};
 const bytes=zipSync({'piece-main/music/project.json':strToU8(JSON.stringify(s)),'piece-main/music/conversation.json':strToU8('[{"role":"user","text":"Keep the take"}]')});
 const restored=unzipDocument(bytes);
 assert.equal(readDocument(restored).name,'Shared arrangement');
 assert.deepEqual(JSON.parse(restored).conversation,[{role:'user',text:'Keep the take'}]);
});

test('older and unbundled example projects retain their session and editor drafts',()=>{
 const raw=JSON.parse(text);
 for(const exampleId of ['DaisyBell','ArchivedDemo']){
  raw.editor={exampleId,codeDrafts:{track:'unfinished DSP'}};
  const loaded=readDocument(unzipDocument(zipDocument(JSON.stringify(raw))));
  assert.deepEqual(loaded.session,readDocument(text).session);
  assert.deepEqual(loaded.editor,{exampleId,soundSet:'basic',codeDrafts:raw.editor.codeDrafts});
 }
 raw.editor={conversationProject:'existing'};
 assert.deepEqual(readDocument(JSON.stringify(raw)).editor,{exampleId:null,soundSet:'basic',codeDrafts:{},conversationProject:'existing'});
 raw.editor.codeDrafts={track:17};
 assert.throws(()=>readDocument(JSON.stringify(raw)),/Invalid instrument source drafts/);
});
