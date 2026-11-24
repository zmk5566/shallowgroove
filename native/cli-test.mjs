import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

const child=spawn(process.argv[2],['--headless','--sample-rate','48000'],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
let id=0;
async function command(op,fields={}){
 const request={op,id:++id,...fields};
 child.stdin.write(JSON.stringify(request)+'\n');
 const {value,done}=await lines.next();
 assert.equal(done,false,'native helper closed');
 const result=JSON.parse(value);
 assert.equal(result.id,request.id);
 if(!result.ok)throw Error(result.error);
 return result;
}
const code='import("stdfaust.lib"); freq=hslider("freq",440,1,20000,1); gain=hslider("gain",0.5,0,1,0.001); gate=button("gate"); process=os.osc(freq)*gain*gate <: _,_;';
const peak=values=>values.reduce((v,s)=>Math.max(v,Math.abs(s)),0);
try{
 const options=await command('outputOptions',{device:null});
 assert.deepEqual(options.sampleRates,[48000]);
 assert.deepEqual(options.bufferSizes,[512]);
 const defaults={device:null,sampleRate:null,bufferSize:null};
 await command('configureOutput',{output:defaults});
 await command('configureOutput',{output:{...defaults,sampleRate:48000,bufferSize:512}});
 for(const invalid of [{sampleRate:44101},{sampleRate:true},{bufferSize:32.5},{device:'missing'}])
  await assert.rejects(command('configureOutput',{output:{...defaults,...invalid}}));
 assert.equal((await command('status')).sampleRate,48000);
 await command('load',{preset:{instrument:code,gain:.5}});
 await command('setMonitor',{enabled:true});
 assert.equal((await command('status')).monitoring,true);
 await command('setMonitor',{enabled:false});
 await command('play',{events:[{time:.01,track:0,status:144,data1:62,data2:100},{time:.05,track:0,status:128,data1:62,data2:0}],position:0,end:.2});
 const onset=await command('render',{frames:960});
 assert.equal(peak(onset.left.slice(0,480)),0);
 assert.ok(peak(onset.left.slice(480))>.01);
 await command('seek',{position:.03});
 assert.ok(peak((await command('render',{frames:128})).right)>.01,'seek chases held note');
 await command('setLoop',{loop:{start:.02,end:.04}});
 await command('render',{frames:960});
 const {position,playing}=await command('status');
 assert.equal(playing,true);assert.ok(position>=.02&&position<.04);
 await assert.rejects(command('replaceRack',{preset:{instrument:'invalid?;'}}));
 assert.ok(peak((await command('render',{frames:256})).left)>.01,'failed DSP preserves active rack');
 const snapshot=await command('snapshot');assert.equal(snapshot.racks[0].instrument,code);
 await command('stop');
 assert.equal((await command('status')).playing,false);
 // Two constant-voice racks make routing and transition levels measurable at exact frames.
 const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,actual+' != '+expected);
 const constant=level=>({instrument:'g=button("gate");process=g*'+level+' <: _,_;'});
 const times=(frame)=>frame/48000;
 const note=(frame,track,status=144)=>({time:times(frame),track,status,data1:60,data2:127});
 const fx=id=>({id,code:'process=*(2),*(2);',values:{},bypass:false});
 const returns={delay:{gain:.5,effects:[{...fx('echo'),wetOnly:true}]},reverb:{gain:1,effects:[]},master:{gain:.5,effects:[fx('master-gain')]}};
 await command('load',{racks:[{...constant('0.25'),effects:[fx('a1'),fx('a2')],sends:{delay:.5,reverb:1}},constant('0.125')],buses:returns});
 await command('setMonitor',{enabled:true,track:1});assert.equal((await command('status')).monitorTrack,1);
 await command('setMidiInputs',{ids:[]});assert.equal((await command('status')).monitorTrack,1);
 await command('play',{events:[note(0,0),note(0,1),{time:times(32),track:0,device:'mixer',address:'send.delay',value:0},
  {time:times(64),track:'master',device:'mixer',address:'gain',value:.25}],end:.1});
 const mixed=(await command('render',{frames:96})).left;
 near(mixed[0],1.625);near(mixed[32],1.125);near(mixed[64],.5625);
 await command('setMix',{track:0,sends:{delay:1}});
 await command('bypass',{track:'delay',device:'echo',bypassed:true});
 near((await command('render',{frames:16})).left[15],.5625);
 await command('bypass',{track:'delay',device:'echo',bypassed:false});
 near((await command('render',{frames:16})).left[15],1.0625);
 await command('setMix',{track:'master',gain:0});
 near(peak((await command('render',{frames:16})).left),0);
 await command('load',{racks:[constant('0.25'),constant('0.125')]});
 await command('play',{events:[note(0,0),note(0,1)],end:times(120)});
 await command('launch',{at:times(32),slots:[{track:0,duration:times(32),events:[note(8,0),note(24,0,128)]}]});
 const clip=(await command('render',{frames:100})).left;
 for(const [frame,level] of [[0,.375],[31,.375],[32,.125],[40,.375],[56,.125],[64,.125],[72,.375],[88,.125]])near(clip[frame],level);
 await command('launch',{at:times(112),slots:[{track:0,duration:0,events:[]}]});
 await command('render',{frames:32});
 const extending=await command('status');assert.ok(extending.playing&&extending.sessionPosition>times(120));
 await command('launch',{at:times(132),slots:[{track:0,arrangement:true}]});
 await command('render',{frames:32});assert.equal((await command('status')).playing,false);
 // Return to arrangement inside a held note before the arrangement ends.
 await command('play',{events:[note(0,0)],end:1,slots:[{track:0,duration:0,events:[]}]});
 await command('launch',{at:times(16),slots:[{track:0,arrangement:true}]});
 const returned=(await command('render',{frames:32})).left;near(returned[15],0);near(returned[16],.25);
 // Musical clip time accelerates with the arrangement's BPM ramp, then
 // repeats the local ramp across a 30-tick arrangement loop (clip is 24 ticks).
 const grid=[{tick:0,seconds:0,ppqn:480,bpm:120,slope:2,origin:0,step:480,beats:4}];
 const timeAt=tick=>60*Math.log1p(tick/60)/(480*2);
 const tickSlot={track:0,duration:timeAt(24),lengthTicks:24,phaseTicks:0,events:[
  {...note(0,0),time:timeAt(4),tick:4},{...note(0,0,128),time:timeAt(8),tick:8}
 ]};
 for(const looping of [false,true]){
  const loopEnd=Math.round(timeAt(30)*48000);
  const sampleAt=tick=>looping?Math.floor(tick/30)*loopEnd+Math.round(timeAt(tick%30)*48000):Math.round(timeAt(tick)*48000);
  await command('play',{events:[],slots:[tickSlot],end:.4,beatGrid:grid,loop:looping?{start:0,end:timeAt(30)}:undefined});
  const samples=(await command('render',{frames:sampleAt(80)+40})).left;
  const onsets=[],releases=[];
  for(let i=1;i<samples.length;++i){
   if(samples[i]>.1&&samples[i-1]<=.1)onsets.push(i);
   if(samples[i]<=.1&&samples[i-1]>.1)releases.push(i);
  }
  assert.equal(onsets.length,4);assert.equal(releases.length,4);
  for(let i=0;i<4;++i){
   assert.ok(Math.abs(onsets[i]-sampleAt(4+24*i))<=1,'ramped clip onset '+i);
   assert.ok(Math.abs(releases[i]-sampleAt(8+24*i))<=1,'ramped clip release '+i);
  }
 }
 await command('quit');console.log('Native transport, routing, Session tempo ramps, monitoring and failed-swap rollback passed');
}finally{child.stdin.end();child.kill();}
