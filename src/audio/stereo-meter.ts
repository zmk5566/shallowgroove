export type StereoLevel=readonly [number,number];

function attach(output:AudioNode){
 const ctx=output.context,splitter=ctx.createChannelSplitter(2);
 const channels=[ctx.createAnalyser(),ctx.createAnalyser()];
 channels.forEach((meter,index)=>{meter.fftSize=256;splitter.connect(meter,index);});
 output.connect(splitter);
 return {channels,samples:new Float32Array(256)};
}
const meters=new WeakMap<AudioNode,ReturnType<typeof attach>>();

// The pan node is disconnected with its voice. Meters follow that node's lifetime.
export function stereoLevel(output:AudioNode):StereoLevel{
 let meter=meters.get(output);
 if(!meter){meter=attach(output);meters.set(output,meter);}
 const {channels,samples}=meter;
 function rms(channel:number){
  channels[channel].getFloatTimeDomainData(samples);
  let sum=0;for(const sample of samples)sum+=sample*sample;
  return Math.sqrt(sum/samples.length);
 }
 return [rms(0),rms(1)];
}

export function meterPercent(rms:number){
 return Math.max(0,Math.min(100,(60+20*Math.log10(rms))/60*100));
}
