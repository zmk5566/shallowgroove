import assert from 'node:assert/strict';
import test from 'node:test';
import {meterPercent,stereoLevel} from '../src/audio/stereo-meter.ts';

test('track meters measure independent post-pan channels and reuse the taps',()=>{
 const amplitudes=[.5,0];
 const taps:number[]=[];
 let links=0;
 const context={createChannelSplitter:()=>({connect:(m:{channel:number},ch:number)=>{m.channel=ch;taps.push(ch);}}),
  createAnalyser:()=>({channel:0,getFloatTimeDomainData(samples:Float32Array){samples.fill(amplitudes[this.channel]);}})};
 const output={context,connect(){links++;}} as unknown as AudioNode;
 assert.deepEqual(stereoLevel(output),[.5,0]);amplitudes.splice(0,2,0,.25);
 assert.deepEqual(stereoLevel(output),[0,.25]);assert.deepEqual(taps,[0,1]);assert.equal(links,1);
 assert.equal(meterPercent(0),0);assert.equal(meterPercent(1),100);
});
