import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import bridge from '../desktop/native-audio.cjs';
const helper=bridge.createNativeAudio({binary:resolve(process.argv[2]),args:['--headless','--sample-rate','48000']});
const request=(op,data)=>helper.request({op,...data});
const rate=48000,interval=.125;
const grid=[{seconds:0,tick:0,ppqn:480,bpm:240,slope:0,origin:0,step:240,beats:3}];
const energy=wave=>wave.reduce((sum,x)=>sum+x*x,0);
try{
 await request('load',{preset:{instrument:'freq=hslider("freq",440,20,20000,1); gain=hslider("gain",0.5,0,1,0.001); gate=button("gate"); process=(gate*gain*freq) <: _,_;'}});
 const play={position:.0625,end:2,events:[],beatGrid:grid,metronome:true};
 await request('play',{...play,countIn:{token:1,total:3,beats:3,interval}});
 for(let beat=0;beat<3;beat++){
  const {left}=await request('render',{frames:rate*interval});
  assert.ok(energy(left.slice(0,2000))>.1);
  assert.equal(energy(left.slice(2500)),0);
  assert.equal((await request('status')).position,play.position);
 }
 // Starting halfway through a beat leaves half a beat of silence after count-in.
 const {right}=await request('render',{frames:6000});
 assert.equal(energy(right.slice(0,3000)),0);
 assert.ok(energy(right.slice(3000))>.1);
 await request('metronome',{enabled:false});
 assert.equal(energy((await request('render',{frames:8000})).left),0);
 await request('play',{...play,position:0,loop:{start:0,end:.125}});
 const {left}=await request('render',{frames:12200});
 assert.deepEqual(left.slice(0,200),left.slice(6000,6200));
 assert.deepEqual(left.slice(0,200),left.slice(12000,12200));
 // A tempo change mid-beat preserves the meter's origin. A meter change starts a new bar.
 await request('play',{...play,position:0,beatGrid:[grid[0],
  {...grid[0],seconds:.0625,tick:120,bpm:120},
  {...grid[0],seconds:.3125,tick:360,bpm:120,origin:360,step:480,beats:4}]});
 const transition=(await request('render',{frames:22000})).left;
 for(const frame of [0,9000,15000]){
  assert.equal(transition[frame],0);
  assert.ok(energy(transition.slice(frame,frame+900))>.1);
 }
 for(const frame of [3000,6000,12000,18000])assert.equal(energy(transition.slice(frame,frame+128)),0);
 await request('stop');
 assert.equal(energy((await request('render',{frames:512})).right),0);
 const dsp={active:true,enabled:true,bpm:120,beats:4,unit:4,click:true};
 const stopped=(await request('status')).position;
 await request('performanceDsp',dsp);
 const performance=(await request('render',{frames:30000})).left;
 for(const frame of [0,24000])assert.ok(energy(performance.slice(frame,frame+2000))>.1);
 assert.equal(energy(performance.slice(3000,24000)),0);
 assert.equal((await request('status')).position,stopped);
 await request('performanceDsp',{...dsp,enabled:false});
 await request('render',{frames:512});
 assert.equal(energy((await request('render',{frames:30000})).left),0);
 console.log('Native count-in freezes position, beat grid honors offset, loop repeats sample-accurately, toggle and stop silence clicks.');
}finally{await helper.stop();}
