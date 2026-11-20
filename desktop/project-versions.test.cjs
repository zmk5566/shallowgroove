const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {createProjectFiles}=require('./projects.cjs');
const repo=require('./music-git.cjs');
const doc={format:'shallowgroove-project',version:1,name:'Song',editor:{codeDrafts:{},soundSet:'basic',exampleId:null,conversationProject:'private'},
 session:{project:{title:'Music',timing:{ppqn:480,end_tick:100,default_tempo_us_per_quarter:500000},global_events:[],tracks:[{id:'track',events:[],name:'Track',gain:1,pan:0,mute:false,solo:false,midi_channel:1}]},voices:[{code:'process=_;',values:{},basePan:0,trim:1}],chains:[[],[],[],[]],sends:[{delay:0,reverb:0}],buses:Array(3).fill({level:1,muted:false})}};
test('split sources preserve placed MIDI, local edits, DSP and stable references',()=>{
 const d=structuredClone(doc),track=d.session.project.tracks[0],event={tick:0,channel:1,status:144,data:[60,100],order:0};
 d.session.project.clips=[{id:'clip',channel:1,events:[event,event]}];track.clipRefs=[{id:'ref',clipId:'clip',start:10}];
 track.events=[{...event,tick:10,clipRef:'ref'}, {...event,tick:11,clipRef:'ref',order:1}];
 const files=repo.split(JSON.stringify(d));const restored=JSON.parse(repo.join(files));
 assert.deepEqual(restored.session,d.session);assert.equal(restored.editor.conversationProject,undefined);
 assert.ok([...files.keys()].some(k=>k.endsWith('.dsp')));
});
test('checkpoint, shared transcript, audition, fork and switch preserve saved work',async()=>{
 const root=await fs.mkdtemp(join(tmpdir(),'sg-versions-test-'));try{
 const dir=join(root,'song'),library=createProjectFiles(join(root,'data'),async()=>dir);
 const original=JSON.stringify(doc),{id}=await library.save(original,'Song',null);
 const act=(action,params={})=>library.version(id,{action,...params});
 const initial=(await act('init')).state.head;
 const next=structuredClone(doc);next.session.project.title='New';
 await library.save(JSON.stringify(next),'Song',id);
 await assert.rejects(act('branch',{name:'old',commit:initial}),/checkpoint/);
 const latest=(await act('checkpoint',{name:'Edit',chat:[{role:'tool',text:'secret'},{role:'assistant',text:'hello',context:'private'}]})).state.head;
 const preview=JSON.parse((await act('preview',{commit:latest})).text);assert.deepEqual(preview.conversation,[{role:'assistant',text:'hello'}]);
 assert.equal(preview.editor.conversationProject,undefined);
 const fork=await act('branch',{name:'variation',commit:initial});assert.equal(fork.state.branch,'variation');assert.deepEqual(JSON.parse(fork.text).session,doc.session);
 assert.equal(JSON.parse(fork.text).editor.conversationProject,'private');
 const main=await act('switch',{name:'main'});assert.equal(main.state.head,latest);
 assert.deepEqual(JSON.parse((await library.read(id)).text).session,next.session);
 await assert.rejects(act('remote',{url:'file:///tmp/other'}));await act('remote',{url:'https://example.org/music.git'});
 assert.equal((await act('status')).state.remote,'https://example.org/music.git');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
