import {appVersion,checkProjectVersion} from './project-version.mjs';
import {libraryKinds} from './effect-library.ts';
import {validatePerformance} from './performance.ts';
import {validateScenes} from './scenes.ts';
import {validateClips} from './clips.ts';
import {validBpm} from './tempo.ts';
import {validateMappings} from './hardware.ts';
import {validateAutomation} from './automation.ts';
import type {MidiEvent,Project} from './project';
import type {AudioEngine} from '../audio/engine';
import type {EffectKind} from '../audio/effects';
import type {LibraryRef} from './user-library';
export type Patch={libraryRef?:LibraryRef;code:string;values:Record<string,number>};
export type FX=Patch&{id:string;kind:EffectKind;bypassed:boolean};
export type Session={project:Project;voices:(Patch&{trim:number;basePan:number})[];chains:FX[][];sends:{delay:number;reverb:number}[];buses:{level:number;muted:boolean}[]};
export type Entry={label:string;source:'user'|'assistant';time:string;before:Session;after:Session};
function copySession(s:Session):Session{return {...structuredClone({...s,project:undefined}),project:{...s.project,timing:{...s.project.timing},global_events:s.project.global_events,tracks:s.project.tracks.map(t=>({...t,events:t.events}))}};}
// Sessions share immutable MIDI lists and Faust source strings between edits.
function equalSnapshot(a:unknown,b:unknown):boolean{
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((item,i)=>equalSnapshot(item,b[i]));
 const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);
 return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&equalSnapshot(left[key],right[key]));
}
export class History {
 entries:Entry[]=[];cursor=0;
 push(before:Session,after:Session,label:string,source:Entry['source']){if(equalSnapshot(before,after))return;this.entries.splice(this.cursor);this.entries.push({before:copySession(before),after:copySession(after),label,source,time:new Date().toISOString()});if(this.entries.length>200)this.entries.shift();this.cursor=this.entries.length;}
}
export function canCapture(engine:AudioEngine,project:Project|null):boolean{
 const rack=engine.effects;
 return !!(project&&engine.project===project&&rack?.master&&rack.returns.delay&&rack.returns.reverb&&
  engine.voices.length===project.tracks.length&&rack.tracks.length===project.tracks.length);
}
function captureLibraryRef(device:{libraryRef?:LibraryRef}){
 return device.libraryRef?{libraryRef:{...device.libraryRef}}:{};
}
export function capture(engine:AudioEngine,project:Project):Session{
 const rack=engine.effects!;const targets=[...project.tracks.map((_,i)=>i),'delay','reverb','master'] as const;
 return {project,voices:engine.voices.map(v=>({code:v.code,values:{...v.values},trim:v.trim,basePan:v.basePan,...captureLibraryRef(v)})),chains:targets.map(t=>rack.chain(t).effects.map(d=>({id:d.id,kind:d.kind,code:d.code,values:{...d.values},bypassed:d.bypassed,...captureLibraryRef(d)}))),sends:rack.tracks.map(t=>({...t.amounts})),buses:[rack.returns.delay,rack.returns.reverb,rack.master!].map(b=>({level:b.level,muted:b.muted}))};
}
export async function hydrate(engine:AudioEngine,s:Session,activate=true){
 await engine.initialize(structuredClone(s.project),'basic','',activate);
 for(let i=0;i<s.voices.length;i++){const v=s.voices[i];if(engine.voices[i].code!==v.code)await engine.replaceInstrument(i,v.code);if(v.libraryRef)engine.voices[i].libraryRef={...v.libraryRef};else delete engine.voices[i].libraryRef;engine.voices[i].trim=v.trim;engine.voices[i].basePan=v.basePan;for(const [p,n] of Object.entries(v.values))engine.setParameter(i,p,n);}
 const targets=[...s.project.tracks.map((_,i)=>i),'delay','reverb','master'] as const;
 for(let i=0;i<targets.length;i++){const target=targets[i];for(const e of [...engine.effects!.chain(target).effects])await engine.removeEffect(target,e.id);for(const fx of s.chains[i]){const d=await engine.addEffect(target,fx.kind,fx.code);d.id=fx.id;if(fx.libraryRef)d.libraryRef={...fx.libraryRef};for(const [p,n] of Object.entries(fx.values))engine.effects!.setParameter(d,p,n);engine.effects!.bypass(d,fx.bypassed);}}
 s.sends.forEach((s,i)=>{engine.effects!.setSend(i,'delay',s.delay);engine.effects!.setSend(i,'reverb',s.reverb);});s.buses.forEach((b,i)=>{if(i===2)engine.effects!.setMaster(b.level,b.muted);else engine.effects!.setReturn(i===0?'delay':'reverb',b.level,b.muted);});engine.updateMix(s.project);engine.automationOverrides.clear();
}
export function validateSession(value:unknown):asserts value is Session{
 const s=value as Session;const fail=()=>{throw Error('Invalid ShallowGroove project file');};
 const finite=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
 if(!s||!s.project||!Array.isArray(s.project.tracks)||s.project.tracks.length>64)fail();
 const p=s.project;if(p.timing?.bpm!==undefined)validBpm(p.timing.bpm);validateMappings(p.hardwareMappings);validateAutomation(p.automation,p.timing?.end_tick);if(typeof p.title!=='string'||!p.timing||!finite(p.timing.ppqn,1,32767)||!finite(p.timing.end_tick,0,1e10)||!finite(p.timing.default_tempo_us_per_quarter,1,16777215))fail();
 const ids=new Set();for(const t of p.tracks){if(typeof t.id!=='string'||ids.has(t.id)||typeof t.name!=='string'||!finite(t.midi_channel,1,16)||!Number.isInteger(t.midi_channel)||!finite(t.gain,0,1.5)||!finite(t.pan,-1,1)||typeof t.mute!=='boolean'||typeof t.solo!=='boolean')fail();ids.add(t.id);}
 for(const events of [p.global_events,...p.tracks.map(t=>t.events)]){if(!Array.isArray(events)||events.length>200000)fail();for(const e of events)if(!finite(e.tick,0,p.timing.end_tick)||!finite(e.order,0,1e10)||!Array.isArray(e.data)||!e.data.every(n=>finite(n,0,255))||(e.status!==undefined&&!finite(e.status,128,255)))fail();}
 validateClips(p);validateScenes(p);if(p.performance!==undefined)validatePerformance(p.performance);
 if(!Array.isArray(s.voices)||s.voices.length!==p.tracks.length||!Array.isArray(s.chains)||s.chains.length!==p.tracks.length+3||!Array.isArray(s.sends)||s.sends.length!==p.tracks.length||!Array.isArray(s.buses)||s.buses.length!==3)fail();
 for(const chain of s.chains)if(!Array.isArray(chain)||chain.length>64)fail();
 for(const patch of [...s.voices,...s.chains.flat()]){
  if(!patch)fail();
  const ref=patch.libraryRef;
  if(ref!==undefined&&(!ref||typeof ref.id!=='string'||!ref.id.trim()||ref.id.length>200||!Number.isSafeInteger(ref.revision)||ref.revision<1||typeof ref.name!=='string'||!ref.name.trim()||ref.name.length>200))fail();
  if(typeof patch.code!=='string'||patch.code.length>60000||!patch.values||typeof patch.values!=='object'||!Object.values(patch.values).every(n=>finite(n,-1e12,1e12)))fail();}
 for(const v of s.voices)if(!finite(v.trim,0,10)||!finite(v.basePan,-1,1))fail();
 for(const f of s.chains.flat())if(![...libraryKinds,'custom'].includes(f.kind)||typeof f.id!=='string'||typeof f.bypassed!=='boolean')fail();
 for(const send of s.sends)if(!finite(send.delay,0,1)||!finite(send.reverb,0,1))fail();for(const b of s.buses)if(!finite(b.level,0,1.5)||typeof b.muted!=='boolean')fail();
}
export function parseFile(text:string){const f=JSON.parse(text);checkProjectVersion(f);if(f.encoding==='asset-table'){if(!Array.isArray(f.midi)||!Array.isArray(f.sources))throw Error('Invalid assets');const expand=(s:any)=>({...s,project:{...s.project,global_events:f.midi[s.project.global_events],tracks:s.project.tracks.map((t:any)=>({...t,events:f.midi[t.events]}))},voices:s.voices.map((v:any)=>({...v,code:f.sources[v.code]})),chains:s.chains.map((c:any[])=>c.map(v=>({...v,code:f.sources[v.code]})))});f.session=expand(f.session);if(f.history)f.history.entries=f.history.entries.map((e:any)=>({...e,before:expand(e.before),after:expand(e.after)}));}validateSession(f.session);const history=new History();if(f.history){if(!Array.isArray(f.history.entries)||f.history.entries.length>200||!Number.isInteger(f.history.cursor)||f.history.cursor<0||f.history.cursor>f.history.entries.length)throw Error('Invalid history');for(const e of f.history.entries){validateSession(e.before);validateSession(e.after);if(typeof e.label!=='string'||typeof e.time!=='string'||!['user','assistant'].includes(e.source))throw Error('Invalid history entry');}history.entries=f.history.entries;history.cursor=f.history.cursor;const expected=history.cursor?history.entries[history.cursor-1].after:history.entries[0]?.before;if(expected&&JSON.stringify(expected)!==JSON.stringify(f.session))throw Error('History does not match project');}return {session:f.session as Session,history};}

export function describeEdit(before:Session,after:Session){
 const parts:string[]=[];if(!equalSnapshot(before.project.performance,after.project.performance))parts.push('演奏图 / Performance');if(before.project.timing.bpm!==after.project.timing.bpm)parts.push(`BPM: ${before.project.timing.bpm??'MIDI'} → ${after.project.timing.bpm??'MIDI'}`);if(JSON.stringify(before.project.automation)!==JSON.stringify(after.project.automation))parts.push('自动化 / Automation');
 after.project.tracks.forEach((t,i)=>{const old=before.project.tracks[i];if(!old||old.id!==t.id)return;for(const key of ['gain','pan','mute','solo','name'] as const)if(t[key]!==old[key])parts.push(`CH ${i+1} ${key}: ${old[key]} → ${t[key]}`);const a=after.voices[i],b=before.voices[i];if(a.code!==b.code)parts.push(`CH ${i+1} Faust DSP`);for(const [key,n] of Object.entries(a.values))if(n!==b.values[key])parts.push(`CH ${i+1} ${key.split('/').at(-1)} → ${n}`);if(JSON.stringify(after.sends[i])!==JSON.stringify(before.sends[i]))parts.push(`CH ${i+1} Send A ${after.sends[i].delay} / B ${after.sends[i].reverb}`);});
 after.chains.forEach((chain,i)=>{if(JSON.stringify(chain)!==JSON.stringify(before.chains[i]))parts.push(`${i<after.project.tracks.length?'CH '+(i+1):['A','B','Master'][i-after.project.tracks.length]} FX`);});if(JSON.stringify(after.buses)!==JSON.stringify(before.buses))parts.push('Return / Master');return parts.join(' · ')||'工程修改 / Project edit';
}

export function packFile(session:Session,history?:History,conversation?:unknown[]){
 const midi:unknown[]=[];const sources:string[]=[];const midiIndex=new Map<string,number>(),sourceIndex=new Map<string,number>();
 const eventLists=new WeakMap<MidiEvent[],number>();
 const events=(data:MidiEvent[])=>{const existing=eventLists.get(data);if(existing!==undefined)return existing;const key=JSON.stringify(data);let id=midiIndex.get(key);if(id===undefined){id=midi.length;midiIndex.set(key,id);midi.push(data);}eventLists.set(data,id);return id;};
 const source=(code:string)=>{let id=sourceIndex.get(code);if(id===undefined){id=sources.length;sourceIndex.set(code,id);sources.push(code);}return id;};
 // 0.3.12 is the supported baseline for the asset-table format.
 let minAppVersion='0.3.12';
 let hasPerformance=false;
 const originalEffects=new Set(['compressor','delay','reverb','custom']);
 const pack=(s:Session)=>{
  if(s.project.performance!==undefined)hasPerformance=true;
  if(s.voices.some(v=>v.libraryRef)||s.chains.some(chain=>chain.some(fx=>fx.libraryRef)))minAppVersion='0.4.1';
  else if(minAppVersion!=='0.4.1'&&s.chains.some(chain=>chain.some(fx=>!originalEffects.has(fx.kind))))minAppVersion='0.4.0';
  else if(minAppVersion==='0.3.12'&&(s.project.clips?.length||s.project.scenes?.length))minAppVersion='0.3.18';
  return {...s,project:{...s.project,global_events:events(s.project.global_events),tracks:s.project.tracks.map(t=>({...t,events:events(t.events)}))},voices:s.voices.map(v=>({...v,code:source(v.code)})),chains:s.chains.map(c=>c.map(f=>({...f,code:source(f.code)})))};
 };
 const current=pack(session),saved=history?{cursor:history.cursor,entries:history.entries.map(e=>({...e,before:pack(e.before),after:pack(e.after)}))}:undefined;
 if(hasPerformance)minAppVersion='0.6.0-pre.1';
 return {format:'shallowgroove-project',version:1,savedWith:appVersion,minAppVersion,encoding:'asset-table',session:current,...(saved?{history:saved}:{}),midi,sources,...(conversation?{conversation}:{})};
}
