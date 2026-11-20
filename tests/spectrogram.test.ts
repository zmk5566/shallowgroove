import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpectrogram} from '../public/spectrogram.js';

test('spectrogram maps FFT peaks to log-frequency rows and advances on the audio clock',()=>{
 const frame=new Uint8ClampedArray(128*4);
 const shifts:number[]=[],clears:number[]=[];
 let writes=0;
 const context={
  createImageData:()=>({data:frame}),
  clearRect:(_x:number,_y:number,width:number)=>clears.push(width),
  drawImage:(_canvas:unknown,shift:number)=>shifts.push(shift),
  putImageData:()=>writes++,
 };
 const draw=createSpectrogram({getContext:()=>context},48000,['#000000','#ffffff']);
 const bins=new Uint8Array(2048);
 bins[Math.round(1000*4096/48000)]=255;
 draw(bins,0);
 const row=frame.findIndex((v,i)=>i%4===0&&v===255)/4;
 assert.ok(Math.abs(row-128*Math.log(24000/1000)/Math.log(24000/20))<2);
 draw(bins,0.01);assert.equal(writes,1);
 draw(bins,0.05);draw(bins,0.25);draw(bins,9);
 assert.equal(writes,4);
 assert.deepEqual(shifts,[1,4]);assert.deepEqual(clears,[160,1,4,160]);
});
