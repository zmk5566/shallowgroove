// Compile the exact WASM backend used in the browser, render actual MIDI excerpts,
// and validate that each instrument emits finite non-silent audio and stops.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {FaustCompiler,LibFaust,instantiateFaustModuleFromFile,FaustPolyDspGenerator} from '@grame/faustwasm/dist/esm/index.js';
import {secondsToTick,normalizedValue,physicalValue} from '../src/model/automation.ts';
import {timeline} from '../src/model/project.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const projectId=process.argv[2]??'DaisyBell';
const bankDirectory={Korobeiniki:'korobeiniki',DaisyBell:'daisy-bell'}[projectId];
assert.ok(bankDirectory,'Unknown patch bank');
const directory=path.join(root,'patches',bankDirectory);
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
const project=JSON.parse(fs.readFileSync(path.join(root,`demo-projects/${projectId}.json`)));
const events=timeline(project);
const compiler=new FaustCompiler(new LibFaust(await instantiateFaustModuleFromFile(path.join(root,'node_modules/@grame/faustwasm/libfaust-wasm/libfaust-wasm.js'))));
const {mixerModule}=await compiler.getAsyncInternalMixerModule(false);
const sr=48000,block=128,report=[];
const labels={Swell:['渐强','Reed swell time after onset'],Sustain:['持续电平','Held-note amplitude'],Frication:['擦音','Unvoiced consonant noise'],Warmth:['温暖度','Upper harmonic level'],'Max Hold':['最长持续时间','Maximum held-note duration before automatic release'],Breath:['气声','Breath noise level'],Level:['音量','Voice output level'],Attack:['起音','Amplitude attack time'],Release:['释音','Amplitude release time'],Brightness:['亮度','Filter brightness'],Detune:['失谐','Oscillator detuning'],Cutoff:['截止频率','Low-pass cutoff'], 'Filter Env':['滤波包络','Filter envelope amount'],Decay:['衰减','Envelope decay time'],Sub:['次八度','Sub-octave mix'],'Brass Bite':['铜管锐度','Brass filter envelope amount'],Vowel:['元音','Fixed formant color'],Ensemble:['合奏宽度','Detuned ensemble color'],Metal:['金属感','Metallic partial mix'],Pluck:['拨弦瞬态','Noise pluck transient'],'Pitch Sweep':['音高扫动','Pitch envelope depth'],Tuning:['调音','Pitch multiplier'],Noise:['噪声','Noise transient mix'],Click:['起音颗粒','Attack noise amount'],Vibrato:['颤音','Vibrato depth'],Kick:['底鼓','Kick level'],Snare:['军鼓','Snare level'],'Hi Hat':['踩镲','Hi-hat level'],'Drum Tail':['鼓尾音','Snare noise decay'],Highpass:['高通频率','High-pass cutoff'],Air:['空气感','Noise component mix']};
function wav(file,left,right){const frames=left.length,b=Buffer.alloc(44+frames*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*4,40);for(let i=0;i<frames;i++){b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,left[i]))*32767),44+i*4);b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,right[i]))*32767),46+i*4);}fs.writeFileSync(file,b);}
const renderDir=process.env.SHALLOW_PREVIEW_DIR;if(renderDir)fs.mkdirSync(renderDir,{recursive:true});
for(const patch of manifest.patches){
 const code=fs.readFileSync(path.join(directory,patch.file),'utf8');
 const factory=await compiler.createPolyDSPFactory(patch.id.replaceAll('-','_'),code,'-ftz 2');assert.ok(factory);
 const meta=JSON.parse(factory.json);assert.equal(meta.inputs,0);assert.equal(meta.outputs,2);
 const generator=new FaustPolyDspGenerator();const processor=await generator.createOfflineProcessor(sr,block,16,factory,mixerModule,null);
 processor.start();
 const controls=processor.getDescriptors().filter(d=>!['freq','gain','gate'].includes(d.address.split('/').at(-1)));
 patch.parameters=controls.map(d=>({id:d.label.toLowerCase().replaceAll(' ','-'),faust_label:d.label,name:{'zh-CN':labels[d.label]?.[0]??d.label,en:d.label},description:{'zh-CN':`${labels[d.label]?.[0]??d.label}控制`,en:labels[d.label]?.[1]??d.label},default:d.init,min:d.min,max:d.max,step:d.step,unit:d.meta?.find(m=>m.unit)?.unit??'linear'}));
 patch.source_sha256=createHash('sha256').update(code).digest('hex');
 const trackIndex=project.tracks.findIndex(t=>t.id===patch.track_id);assert.ok(trackIndex>=0,patch.track_id);
 const te=events.filter(e=>e.trackIndex===trackIndex);
 const first=te.find(e=>e.status>>4===9&&e.data[1]>0).seconds;
 const lanes=(project.automation??[]).filter(l=>l.trackId===patch.track_id&&l.device==='instrument'&&l.mode==='read');
 for(const lane of lanes)assert.ok(controls.some(c=>c.address===lane.address),'Missing automated control '+lane.address);
 let cursor=0,peak=0,sum=0;const length=Math.ceil(6*sr/block)*block,left=new Float32Array(length),right=new Float32Array(length);
 for(let frame=0;frame<length;frame+=block){
  const now=first+frame/sr;
  while(cursor<te.length&&te[cursor].seconds<=now){const e=te[cursor++];if(e.seconds>=first&&[8,9,11,14].includes(e.status>>4))processor.midiMessage([e.status,...e.data]);}
  for(const lane of lanes){const value=normalizedValue(lane,secondsToTick(project,now));if(value!==null)processor.setParamValue(lane.address,physicalValue(lane,value));}
  const output=[new Float32Array(block),new Float32Array(block)];processor.compute([],output);
  for(let j=0;j<block;j++){for(const channel of output){assert.ok(Number.isFinite(channel[j]),patch.id);peak=Math.max(peak,Math.abs(channel[j]));sum+=channel[j]**2;}left[frame+j]=output[0][j];right[frame+j]=output[1][j];}
 }
 assert.ok(peak>0.0001,`${patch.id}: silent`);assert.ok(peak<3,`${patch.id}: excessive output ${peak}`);
 processor.allNotesOff(true);const silence=processor.render([],block*4);assert.ok(silence.every(c=>c.every(x=>Math.abs(x)<1e-7)),`${patch.id}: panic did not silence`);
 const checkedDrumNotes=[];
 if(project.tracks[trackIndex].annotation?.rhythm_map){
  for(const note of [...new Set(te.filter(e=>e.status>>4===9&&e.data[1]>0).map(e=>e.data[0]))].sort((a,b)=>a-b)){
   const drum=await generator.createOfflineProcessor(sr,block,16,factory,mixerModule,null);drum.start();drum.midiMessage([0x90|(patch.midi_channel-1),note,100]);
   drum.render([],block*2);drum.midiMessage([0x80|(patch.midi_channel-1),note,0]);
   const audio=drum.render([],Math.ceil(.15*sr/block)*block);let notePeak=0;
   for(const channel of audio)for(const value of channel){assert.ok(Number.isFinite(value));notePeak=Math.max(notePeak,Math.abs(value));}
   assert.ok(notePeak>.0001,`${patch.id}: unmapped/silent drum note ${note}`);checkedDrumNotes.push(note);drum.destroy();
  }
  processor.allNotesOff(true);
 }
 const result={id:patch.id,first_note_seconds:first,peak,rms:Math.sqrt(sum/(length*2)),finite:true,panic_silent:true,...(checkedDrumNotes.length?{checked_drum_notes:checkedDrumNotes}:{})};report.push(result);console.log(JSON.stringify(result));
 if(renderDir)wav(path.join(renderDir,patch.id+'.wav'),left,right);
 processor.destroy();
}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.mkdirSync(path.join(root,'build','validation'),{recursive:true});
fs.writeFileSync(path.join(root,'build','validation',`${bankDirectory}.json`),JSON.stringify({compiler:compiler.version(),sample_rate:sr,block_size:block,method:'6-second actual-MIDI excerpt from each track first note; events quantized to 128-frame offline blocks; not an original-recording similarity test',patches:report},null,2)+'\n');
