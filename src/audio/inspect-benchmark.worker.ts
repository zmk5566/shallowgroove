import {FaustMonoDspGenerator,FaustPolyDspGenerator,type FaustDspFactory} from '@grame/faustwasm';
import type {Compiled} from './engine';

interface Benchmark {rate:number; factory:FaustDspFactory; compiled?:Compiled; values:Record<string,number>}
self.onmessage=async({data}:{data:Benchmark})=>{
 try {
  const {rate,factory,compiled,values}=data;
  const synth=compiled && await new FaustPolyDspGenerator().createOfflineProcessor(rate,128,16,factory,compiled.mixerModule,compiled.effectFactory);
  const dsp=synth ?? await new FaustMonoDspGenerator().createOfflineProcessor(rate,128,factory);
  if(!dsp)throw Error('DSP unavailable');
  for(const [address,value] of Object.entries(values))dsp.setParamValue(address,value);
  dsp.start();
  synth?.keyOn(0,60,100);
  const frames=8192;
  const tone=Float32Array.from({length:frames},(_,i)=>0.25*Math.sin(i*2*Math.PI*440/rate));
  const input=synth?[]:[tone,tone];
  dsp.render(input,frames);
  const loads=[];
  for(let i=0;i<16;i++){
   const start=performance.now();
   dsp.render(input,frames);
   loads.push((performance.now()-start)*rate/(10*frames));
  }
  self.postMessage({average:loads.reduce((a,b)=>a+b)/loads.length,peak:Math.max(...loads)});
 } catch(error){self.postMessage({error:String(error)});}
};
