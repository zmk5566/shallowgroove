import {effectLibrary,libraryKinds} from '../src/model/effect-library.ts';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {FaustCompiler,LibFaust,instantiateFaustModuleFromFile,FaustMonoDspGenerator} from '@grame/faustwasm/dist/esm/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const compiler=new FaustCompiler(new LibFaust(await instantiateFaustModuleFromFile(path.join(root,'node_modules/@grame/faustwasm/libfaust-wasm/libfaust-wasm.js'))));
const sr=48000;
for(const kind of libraryKinds){
 const factory=await compiler.createMonoDSPFactory('Effect',fs.readFileSync(path.join(root,'patches/effects',kind+'.dsp'),'utf8'),'-ftz 2');
 const meta=JSON.parse(factory.json);assert.equal(meta.inputs,2);assert.equal(meta.outputs,2);
 const p=await new FaustMonoDspGenerator().createOfflineProcessor(sr,128,factory);p.start();
 const set=(label,value)=>{const d=p.getDescriptors().find(d=>d.label===label);assert.ok(d,label);p.setParamValue(d.address,value);};
 if(kind==='reverb'||kind==='delay')set('Mix',1);
 const zeros=n=>[new Float32Array(n),new Float32Array(n)];p.render(zeros(sr),sr);
 const input=zeros(sr*2);
 if(kind==='compressor'){input[0].fill(.6);input[1].fill(.3);}else{input[0][0]=1;input[1][0]=.5;}
 const output=p.render(input,sr*2);assert.ok(output.every(c=>c.every(Number.isFinite)));const energy=(start,end)=>output[0].slice(start,end).reduce((s,x)=>s+x*x,0);
 assert.ok(energy(0,sr*2)>1e-8,kind+' silent');
 if(kind==='compressor'){assert.ok(Math.abs(output[0][sr])<.35);assert.ok(Math.abs(output[0][sr]/output[1][sr]-2)<.001,'stereo image changed');}
 if(kind==='delay'){assert.ok(energy(0,11000)<1e-10,'wet return leaked dry signal');assert.ok(energy(11990,12100)>1e-5,'1/8 delay timing wrong');}
 if(kind==='reverb')assert.ok(energy(0,500)<1e-10,'pre-delay leaked dry signal');
 if(kind==='delay'){
  for(const [sync,bpm,ms,expected] of [[1,60,250,24000],[0,120,100,4800]]){
   p.instanceClear();set('Sync',sync);set('BPM',bpm);set('Time',ms);set('Feedback',0);p.render(zeros(sr),sr);
   const pulse=zeros(sr);pulse[0][0]=1;const delayed=p.render(pulse,sr)[0];
   const onset=delayed.findIndex(x=>Math.abs(x)>.01);assert.ok(Math.abs(onset-expected)<20,`delay time ${onset} vs ${expected}`);
  }
 }
 for(const preset of effectLibrary[kind].presets){
  p.instanceClear();
  for(const d of p.getDescriptors())set(d.label,d.init);
  for(const [label,value] of Object.entries(preset.values)){
   const control=p.getDescriptors().find(d=>d.label===label);
   assert.ok(control && value>=control.min && value<=control.max,preset.id+' '+label);
   set(label,value);
  }
  const signal=zeros(sr);
  for(let i=0;i<sr;i++){signal[0][i]=.4*Math.sin(2*Math.PI*220*i/sr);signal[1][i]=.2*Math.cos(2*Math.PI*330*i/sr);}
  const audio=p.render(signal,sr);
  assert.ok(audio.every(ch=>ch.every(Number.isFinite)&&ch.some(x=>Math.abs(x)>.001)),preset.id);
  if(preset.id==='mono')assert.ok(audio[0].slice(-1024).every((x,i)=>Math.abs(x-audio[1][sr-1024+i])<.0001));
 }
 p.instanceClear();const silence=p.render(zeros(sr),sr);assert.ok(silence.every(c=>c.every(x=>Math.abs(x)<1e-8)),'reset retained tail');
 console.log(kind+': stereo I/O, finite audio, wet/timing or dynamics, buffer clear passed');p.destroy();
}
