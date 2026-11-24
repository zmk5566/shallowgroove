// Compare the desktop helper with the same Faust WASM factories used by the worklet.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {FaustCompiler, LibFaust, instantiateFaustModuleFromFile, FaustPolyDspGenerator, FaustMonoDspGenerator} from '@grame/faustwasm/dist/esm/index.js';
import bridge from '../desktop/native-audio.cjs';
import {parseFile} from '../src/model/session.ts';
import {timeline} from '../src/model/project.ts';

const root = resolve(import.meta.dirname, '..');
const {session} = parseFile(await readFile(resolve(root,'tests/fixtures/native-preview.json'),'utf8'));
const [track] = session.project.tracks;
const [voice] = session.voices;
const [fx] = session.chains[0];
const rate = 48000, block = 16, frames = rate * 2;
const gain = track.gain * voice.trim * .2;
const events = timeline(session.project).map(e=>({time:e.seconds,track:0,status:e.status,data1:e.data[0],data2:e.data[1]}));
const compiler = new FaustCompiler(new LibFaust(await instantiateFaustModuleFromFile(resolve(root,'node_modules/@grame/faustwasm/libfaust-wasm/libfaust-wasm.js'))));
const synthFactory = await compiler.createPolyDSPFactory('ShallowSynth',voice.code,'-ftz 2');
const fxFactory = await compiler.createMonoDSPFactory('ShallowEffect',fx.code,'-ftz 2');
const {mixerModule} = await compiler.getAsyncInternalMixerModule(false);
const synth = await new FaustPolyDspGenerator().createOfflineProcessor(rate,block,16,synthFactory,mixerModule,null);
const effect = await new FaustMonoDspGenerator().createOfflineProcessor(rate,block,fxFactory);
synth.start();
effect.start();
const wasm = Array.from({length:2},()=>new Float32Array(frames));
const stereoBlock = () => Array.from({length:2},()=>new Float32Array(block));
const dry = stereoBlock(), wet = stereoBlock();
let index = 0;
for (let frame=0; frame<frames; frame+=block) {
 while (index<events.length && Math.round(events[index].time*rate)<=frame) {
  const e=events[index++];
  synth.midiMessage([e.status,e.data1,e.data2]);
 }
 synth.compute([],dry);
 effect.compute(dry,wet);
 for(let ch=0;ch<2;ch++) for(let i=0;i<block;i++) wasm[ch][frame+i]=wet[ch][i]*gain;
}
const helper = bridge.createNativeAudio({binary:resolve(root,'build-native',bridge.engineName()),args:['--headless','--sample-rate',String(rate)]});
const rms = (data,start,end) => Math.sqrt(data.slice(start,end).reduce((sum,x)=>sum+x*x,0)/(end-start));
function measure(channels) {
 return channels.map(data => {
  assert.equal(data.length,frames);
  assert.ok(data.every(Number.isFinite));
  return {onset:data.findIndex(x=>Math.abs(x)>1e-5),rms:rms(data,0,frames),release:rms(data,18000,18240)};
 });
}
try {
 const start = performance.now();
 const preset={instrument:voice.code,values:voice.values,effects:[{id:fx.id,code:fx.code,values:fx.values,bypass:fx.bypassed}],gain,pan:track.pan};
 await helper.request({op:'load',racks:[preset]});
 const compileMs = Math.round(performance.now()-start);
 await helper.request({op:'play',events,position:0,end:2});
 const native = [[],[]];
 for(let i=0;i<frames;i+=8192) {
  const {left,right} = await helper.request({op:'render',frames:Math.min(8192,frames-i)});
  native[0].push(...left);
  native[1].push(...right);
 }
 const reference=measure(wasm), actual=measure(native);
 console.table(actual.map((a,i)=>({channel:i+1,wasmOnset:reference[i].onset,nativeOnset:a.onset,wasmRms:reference[i].rms,nativeRms:a.rms,levelDifferenceDb:20*Math.log10(a.rms/reference[i].rms)})));
 console.log('Native helper start and rack compilation (ms)',compileMs);
 for(let i=0;i<2;i++) {
  const a=actual[i],b=reference[i];
  assert.ok(b.onset>=6000 && a.onset>=6000 && Math.abs(a.onset-b.onset)<=128,'note onset exceeds one audio block');
  assert.ok(a.release>1e-5 && b.release>1e-5,'missing release tail');
  assert.ok(Math.abs(20*Math.log10(a.rms/b.rms))<1,'level mismatch exceeds 1 dB');
 }
 // Hot reload in the middle of the first note, then reject a malformed edit.
 await helper.request({op:'play',events,position:0,end:2});
 await helper.request({op:'render',frames:9000});
 const edited={...preset,instrument:preset.instrument.replace('0.008,0.001','0.012,0.001')};
 await helper.request({op:'replaceRack',track:0,preset:edited});
 await assert.rejects(helper.request({op:'replaceRack',track:0,preset:{...edited,instrument:'process = ;'}}));
 assert.equal((await helper.request({op:'snapshot'})).racks[0].instrument,edited.instrument);
 assert.equal((await helper.request({op:'status'})).playing,true);
 const held=await helper.request({op:'render',frames:2048});
 assert.ok(held.left.every(Number.isFinite) && rms(held.left,0,2048)>1e-5,'held note lost during hot swap');
 await helper.request({op:'load',racks:[preset]});
 const pedalEvents=[[0,0xb0,64,127],[.02,0x90,64,100],[.12,0x80,64,0],[.8,0xb0,64,0]]
  .map(([time,status,data1,data2])=>({time,track:0,status,data1,data2}));
 await helper.request({op:'play',events:pedalEvents,position:.4,end:1});
 const sustained=await helper.request({op:'render',frames:4096});
 assert.ok(rms(sustained.left,512,4096)>1e-5,'seek lost a pedal-held note');
 console.log('Live rack replacement retained the held note, and a rejected edit preserved playback and source.');
} finally {
 await helper.stop();
 synth.destroy();
 effect.destroy();
}
