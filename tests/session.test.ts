import manifest from '../package.json' with {type:'json'};
import {effectLibrary,libraryKinds} from '../src/model/effect-library.ts';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {History,packFile,parseFile,validateSession,type Session} from '../src/model/session.ts';
const base:Session={project:{schema:'test',title:'Empty',timing:{ppqn:480,end_tick:1920,default_tempo_us_per_quarter:500000},global_events:[],tracks:[]},voices:[],chains:[[],[],[]],sends:[],buses:[{level:1,muted:false},{level:1,muted:false},{level:1,muted:false}]};
test('undo history branches, snapshots do not alias edits, and export preserves cursor',()=>{const h=new History(),next=structuredClone(base);next.buses[2].level=.5;h.push(base,next,'Master','user');next.buses[2].level=.2;assert.equal(h.entries[0].after.buses[2].level,.5);h.cursor=0;h.push(base,next,'New branch','assistant');assert.equal(h.entries.length,1);const parsed=parseFile(JSON.stringify({format:'shallowgroove-project',version:1,session:next,history:h}));assert.equal(parsed.history.cursor,1);assert.equal(parsed.history.entries[0].source,'assistant');});
test('malformed project and mismatched history are rejected before touching audio',()=>{const bad=structuredClone(base);bad.project.timing.ppqn=0;assert.throws(()=>validateSession(bad));const h=new History(),next=structuredClone(base);next.buses[0].level=.1;h.push(base,next,'change','user');assert.throws(()=>parseFile(JSON.stringify({format:'shallowgroove-project',version:1,session:base,history:h})));assert.throws(()=>parseFile('{"format":"shallowgroove-project","version":999}'));});

test('asset-table exports round-trip MIDI, DSP and history without duplicating assets',()=>{const h=new History(),next=structuredClone(base);next.buses[0].level=.3;h.push(base,next,'Bus','user');const file=packFile(next,h);const restored=parseFile(JSON.stringify(file));assert.deepEqual(restored.session,next);assert.equal(restored.history.cursor,1);assert.equal(file.midi.length,1);});


test('hardware mappings round-trip with the project and invalid ranges are rejected',()=>{const s=structuredClone(base);s.project.hardwareMappings=[{id:'h',connectorId:'connect',uid:'AABBCCDD',channel:40,trackId:'master',device:'mixer',address:'gain',label:'Volume',inputMin:0,inputMax:1,outputMin:0,outputMax:1.5,curve:'linear',invert:false,smoothingMs:40,enabled:true}];const restored=parseFile(JSON.stringify(packFile(s)));assert.deepEqual(restored.session.project.hardwareMappings,s.project.hardwareMappings);s.project.hardwareMappings[0].inputMax=0;assert.throws(()=>validateSession(s));});

test('factory effects keep their editable DSP and preset values when a project is reopened',()=>{
 const session=structuredClone(base);
 for(const kind of libraryKinds){
  const code=readFileSync(new URL('../patches/effects/'+kind+'.dsp',import.meta.url),'utf8');
  for(const preset of effectLibrary[kind].presets){
   session.chains[2].push({id:crypto.randomUUID(),kind,code,bypassed:false,values:{...preset.values}});
  }
 }
 assert.equal(session.chains[2].length,24);
 assert.deepEqual(parseFile(JSON.stringify(packFile(session))).session,session);
});

test('writer tracks requirements in exported history and reads legacy files without version metadata',()=>{
 const legacy=packFile(base);
 assert.equal(legacy.version,1);assert.equal(legacy.minAppVersion,'0.3.12');
 const {savedWith,minAppVersion,...old}=legacy;
 assert.equal(savedWith,manifest.version);assert.deepEqual(parseFile(JSON.stringify(old)).session,base);
 const clip=structuredClone(base);clip.project.scenes=[{id:'scene',name:'Scene',slots:[]}];
 assert.equal(packFile(clip).minAppVersion,'0.3.18');
 const modern=structuredClone(base);modern.chains[2].push({kind:'chorus',id:'fx',code:'process=_,_;',values:{},bypassed:false});
 const history=new History();history.push(clip,modern,'Effect','user');history.push(modern,clip,'Remove','user');
 assert.equal(packFile(clip,history).minAppVersion,'0.4.0');
 assert.equal(packFile(clip).minAppVersion,'0.3.18');
 assert.throws(()=>parseFile(JSON.stringify({...legacy,minAppVersion:'0.10.0',session:null})),/需要 ShallowGroove 0\.10\.0/);
 assert.deepEqual(parseFile(JSON.stringify({...legacy,savedWith:'0.10.0'})).session,base);
});
