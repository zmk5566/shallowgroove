import {libraryKinds} from '../model/effect-library.ts';
import {declaredPatchName} from '../model/patch-name';
import type {AudioEngine} from '../audio/engine';
import type {Project} from '../model/project';
import type {Selection,MusicCommand} from './contracts';
import {finiteRange,sendTarget,resolveParameterTarget} from './contracts';
export interface MusicHost {engine:AudioEngine;project:Project;projectId:string;generation:string;ready:boolean;busy:boolean;notify:()=>void;setBusy:(busy:boolean)=>void;instrumentChanged:(index:number,code:string)=>void;}
export async function executeMusicCommand(host:MusicHost,selection:Selection,command:MusicCommand):Promise<{result:unknown;undo?:()=>Promise<void>;selection?:Selection}> {
 const {engine,project,ready}=host;const target=selection.channel;
 if(typeof target==='number'&&!project.tracks[target])throw Error('Track no longer exists');
 if(!ready||!engine.effects)throw Error('Enable audio first');
 if(host.busy)throw Error('A device is compiling. Try again when it finishes.');
 const rack=engine.effects;
 if(command.action==='set_parameter'){
  const voice=typeof target==='number'?engine.voices[target]:undefined;
  const candidates=[...(voice?[{id:'instrument',controls:engine.describe(voice.node)}]:[]),...(rack.chain(target)?.effects.map(d=>({id:d.id,controls:d.controls}))??[])];
  const resolved=resolveParameterTarget(selection,command.address,candidates);
  selection=resolved.selection;command={...command,address:resolved.address};
 }
 if(command.action==='replace_patch'&&selection.device==='channel'&&typeof target==='number')selection={...selection,device:'instrument'};
 const device=selection.device==='channel'||selection.device==='instrument'?undefined:rack.chain(target)?.effects.find(d=>d.id===selection.device);
 if(selection.device!=='channel'&&selection.device!=='instrument'&&!device)throw Error('The selected patch was removed. Select a patch again.');
 const refresh=()=>host.notify();
 async function structural(fn:()=>Promise<void>){host.setBusy(true);try{await fn();}finally{host.setBusy(false);refresh();}}
 if(command.action==='set_send'){
  const index=sendTarget(selection);const kind=command.destination;if(kind!=='delay'&&kind!=='reverb')throw Error('Choose delay or reverb');
  const amount=finiteRange(command.amount,0,1),before=rack.tracks[index].amounts[kind];rack.setSend(index,kind,amount);refresh();
  return {selection:{channel:index,device:'channel'},result:{trackId:project.tracks[index].id,destination:kind,before,amount},undo:async()=>{if(rack.tracks[index].amounts[kind]!==amount)throw Error('Send changed since this action; undo would overwrite a newer edit.');rack.setSend(index,kind,before);refresh();}};
 }
 if(command.action==='set_parameter'){
  const index=typeof target==='number'?target:-1;const voice=engine.voices[index];
  const controls=device?.controls??(voice?engine.describe(voice.node):[]);const control=controls.find(c=>c.address===command.address);
  if(!control)throw Error('Unknown parameter address. Inspect the selected patch first.');
  if(device?.wetOnly&&control.label==='Mix')throw Error('Return effects must stay 100% wet. Use the track send amount.');
  const originalCode=device?.code??voice.code;
  const value=finiteRange(command.value,control.min,control.max),before=device?device.values[control.address]:voice.values[control.address]??control.init;
  const set=(n:number)=>{if(device)rack.setParameter(device,control.address,n);else engine.setParameter(index,control.address,n);refresh();};set(value);
  return {selection,result:{channel:target,device:selection.device,parameter:control.label,before,value},undo:async()=>{if(device? rack.chain(target)?.effects.find(d=>d.id===device.id)!==device : engine.voices[index]!==voice||voice.code!==originalCode)throw Error('The selected patch has been replaced.');const current=device?device.values[control.address]:voice.values[control.address];if(current!==value)throw Error('Parameter changed since this action.');set(before);}};
 }
 if(command.action==='add_effect'){
  const kind=command.kind;if(!kind||![...libraryKinds,'custom'].includes(kind))throw Error('Select an effect kind from the library');
  if(kind==='custom'&&(typeof command.code!=='string'||command.code.length<10||command.code.length>60000))throw Error('Custom effect requires Faust source, 10–60000 characters.');
  let id='';await structural(async()=>{const added=await engine.addEffect(target,kind,command.code,command.presetId);id=added.id;});
  return {selection:{channel:target,device:id},result:{channel:target,kind,presetId:command.presetId,deviceId:id,position:'end of chain'},undo:async()=>structural(async()=>{await engine.removeEffect(target,id);})};
 }
 if(command.action==='replace_patch'){
  if(selection.device==='channel')throw Error('Select an instrument or effect patch first.');
  const code=command.code;if(typeof code!=='string'||code.length<10||code.length>60000)throw Error('Expected Faust DSP source (10–60000 characters).');
  const index=typeof target==='number'?target:-1;const before=device?.code??engine.voices[index]?.code;
  if(!before)throw Error('No active DSP source');
  const beforeValues={...(device?.values??engine.voices[index]?.values)};
  const replace=async(source:string)=>structural(async()=>{if(device)await engine.replaceEffect(target,device.id,source);else{await engine.replaceInstrument(index,source);host.instrumentChanged(index,source);}});
  await replace(code);
  return {selection,result:{channel:target,device:selection.device,name:declaredPatchName(code)??(device?'Custom Faust effect':'Custom Faust instrument'),compiled:true},undo:async()=>{const active=device?rack.chain(target)?.effects.find(d=>d.id===device.id)?.code:engine.voices[index]?.code;if(active!==code)throw Error('Patch changed since this action.');await replace(before);if(device){const restored=rack.chain(target)?.effects.find(d=>d.id===device.id);if(restored)for(const c of restored.controls){const n=beforeValues[c.address];if(n!==undefined)rack.setParameter(restored,c.address,n);}}else for(const c of engine.describe(engine.voices[index].node)){const n=beforeValues[c.address];if(n!==undefined)engine.setParameter(index,c.address,n);}refresh();}};
 }
 throw Error('Unknown music command');
}
