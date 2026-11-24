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

test('project embeds a library revision alongside its independent sound snapshot',()=>{
 const session=structuredClone(base);
 const libraryRef={id:crypto.randomUUID(),name:'Tape Echo',revision:1};
 session.chains[2].push({id:'master-fx',kind:'delay',libraryRef,code:'process=_,_;',values:{'/echo/Time':90},bypassed:false});
 const revised=structuredClone(session),device=revised.chains[2][0];
 device.libraryRef!.revision=2;device.values['/echo/Time']=120;
 const history=new History();history.push(session,revised,'Update from library','user');
 const packed=packFile(revised,history);
 assert.equal(packed.minAppVersion,'0.4.1');
 const restored=parseFile(JSON.stringify(packed));
 assert.deepEqual(restored.session,revised);
 assert.deepEqual(restored.history.entries[0].before,session);
 device.libraryRef!.revision=0;
 assert.throws(()=>validateSession(revised));
});

test('hydrate and capture keep patch provenance without consulting a personal library',async()=>{
 const {capture,hydrate}=await import('../src/model/session.ts');
 const session=structuredClone(base);
 session.project.tracks.push({id:'lead',name:'Lead',midi_channel:1,events:[],gain:1,pan:0,mute:false,solo:false});
 session.voices.push({code:'synth',values:{'/synth/Tone':.3},trim:1,basePan:0,libraryRef:{id:crypto.randomUUID(),name:'Soft lead',revision:2}});
 session.sends.push({delay:0,reverb:0});
 session.chains.unshift([{id:'fx',kind:'delay',code:'echo',bypassed:true,values:{'/echo/Time':90},libraryRef:{id:crypto.randomUUID(),name:'Tape',revision:4}}]);
 const targets=[0,'delay','reverb','master'] as const;
 const chains=targets.map(()=>({effects:[] as Session['chains'][number]}));
 const track={amounts:{delay:0,reverb:0}},bus={...session.buses[0]};
 const voices=[{code:'basic',values:{} as Record<string,number>,trim:1,basePan:0}];
 const engine={voices,initialize:async()=>{},replaceInstrument:async(i:number,code:string)=>{voices[i].code=code;},
  setParameter:(i:number,p:string,n:number)=>{voices[i].values[p]=n;},
  addEffect:async(t:typeof targets[number],kind:'delay',code:string)=>{
   const fx={id:'fresh',kind,code,bypassed:false,values:{}};chains[targets.indexOf(t)].effects.push(fx);return fx;
  },
  effects:{chain:(t:typeof targets[number])=>chains[targets.indexOf(t)],tracks:[track],returns:{delay:{...bus},reverb:{...bus}},master:{...bus},
   setParameter:(fx:Session['chains'][number][number],p:string,n:number)=>{fx.values[p]=n;},
   bypass:(fx:Session['chains'][number][number],value:boolean)=>{fx.bypassed=value;},
   setSend:()=>{},setReturn:()=>{},setMaster:()=>{}},
  automationOverrides:new Set(),updateMix:()=>{}
 } as unknown as import('../src/audio/engine.ts').AudioEngine;
 await hydrate(engine,session,false);
 const snapshot=capture(engine,session.project);
 assert.deepEqual(snapshot,session);
 engine.voices[0].libraryRef!.revision=9;
 assert.equal(snapshot.voices[0].libraryRef!.revision,2);
 assert.equal(session.voices[0].libraryRef!.revision,2);
});
