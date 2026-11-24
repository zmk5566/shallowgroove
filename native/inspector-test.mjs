import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import bridge from '../desktop/native-audio.cjs';
const helper=bridge.createNativeAudio({binary:resolve(process.argv[2]),args:['--headless','--sample-rate','48000']});
const ask=(op,fields={})=>helper.request({op,...fields});
const synth='import("stdfaust.lib");g=button("gate");process=os.osc(750)*g*.5 <: _,_;';
const inspect=(track,device)=>ask('inspectRead',{track,device,token:track+device,wave:true,spectrum:true,performance:device!=='channel'});
const open=()=>Promise.all([[0,'instrument'],[0,'fx'],[0,'channel'],['master','channel'],['delay','channel'],['delay','send-fx']].map(([t,d])=>inspect(t,d)));
const magnitude=wave=>Math.max(...Buffer.from(wave,'base64').map(v=>Math.abs(v-128)));
try{
 await ask('load',{racks:[{instrument:synth,pan:-1,effects:[{id:'fx',code:'process=*(.25),*(.25);'}],sends:{delay:.5}}],
   buses:{master:{effects:[]},delay:{gain:.5,effects:[{id:'send-fx',code:'process=_,_;',wetOnly:true}]}}});
 await open();await ask('meters');
 await ask('midi',{status:144,data1:60,data2:100});
 await ask('render',{frames:8192});
 const [instrument,fx,channel,master,send,sendFx]=await open();
 assert.equal(instrument.wave.length,1);assert.equal(fx.wave.length,2);
 assert.equal(Buffer.from(fx.wave[0],'base64').length,1024);assert.equal(Buffer.from(fx.spectrum[1],'base64').length,2048);
 assert.equal(fx.wave[0],instrument.wave[0]);
 assert.ok(Math.abs(magnitude(fx.wave[1])/magnitude(fx.wave[0])-.25)<.02);
 assert.equal(channel.wave[0],fx.wave[1]);
 const spec=Buffer.from(instrument.spectrum[0],'base64');
 assert.ok(spec[64]>200 && spec[32]<40 && spec[128]<40,'750 Hz peak');
 assert.ok(Math.abs(instrument.seconds-8192/48000)<1e-12);assert.ok(instrument.average>0 && instrument.peak>=instrument.average);
 assert.ok(fx.average>0 && fx.peak>=fx.average);
 assert.ok(magnitude(master.wave[0])>magnitude(channel.wave[0]));
 assert.ok(magnitude(send.wave[0])>0 && magnitude(sendFx.wave[0])>0);
 const {tracks,buses}=await ask('meters');
 assert.ok(tracks[0][0]>.1&&tracks[0][1]<1e-6);
 assert.ok(buses[2][0]>tracks[0][0]&&buses[0][0]>0);
 await ask('bypass',{track:'delay',device:'send-fx',bypassed:true});
 await ask('render',{frames:4096});
 assert.equal(magnitude((await inspect('delay','channel')).wave[0]),0);
 await ask('inspectClose',{track:0,device:'fx',token:'0fx'});
 await ask('render',{frames:4096});
 assert.equal((await inspect(0,'fx')).seconds,0,'reopened tap has fresh history');
 console.log('Native signal taps, input/output, spectrum, meters, performance and subscription cleanup passed');
} finally {await helper.stop();}
