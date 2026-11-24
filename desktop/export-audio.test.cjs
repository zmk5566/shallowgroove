const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {resolve, join} = require('node:path');
const {exportAudio} = require('./export-audio.cjs');

const {engineName,createNativeAudio} = require('./native-audio.cjs');
const binary = process.env.SG_TEST_NATIVE_BINARY || resolve(__dirname, '../build-native', engineName());
async function fixture(t) {
 const dir = await fs.mkdtemp(join(tmpdir(), 'sg-export-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 const path = join(dir, 'arrangement.wav');
 await fs.writeFile(path, 'previous');
 return {dir, path, sampleRate:48000, binary};
}

for(const backend of ['native','wasm']) test(backend+' WAV contains stereo master, mixer automation, release and delayed echoes', {
 skip: backend==='native' && !createNativeAudio({binary}).status().available
}, async t => {
 const args = await fixture(t);
 if(backend==='wasm') args.createRenderer=(await import('./export-wasm.mjs')).createRenderer;
 const graph = {racks:[{instrument:'import("stdfaust.lib"); gate=button("gate"); process=en.asr(0.001,0.4,0.1,gate) <: _,_;'}],
  buses:{master:{gain:0.5, effects:[{id:'delay-right', code:'process=_,@(96000);'}]}}};
 const sequence = {events:[{time:0, track:0, status:144, data1:60, data2:127},
  {time:.04, track:0, device:'mixer', address:'gain', value:0.5}], end:.1};
 const progress = [];
 const result = await exportAudio({...args, graph, sequence, onProgress:p=>progress.push(p)});
 const bytes = await fs.readFile(args.path);
 assert.equal(bytes.toString('ascii',0,4),'RIFF');
 assert.equal(bytes.toString('ascii',8,16),'WAVEfmt ');
 assert.equal(bytes.readUInt16LE(20),1);
 assert.equal(bytes.readUInt16LE(22),2);
 assert.equal(bytes.readUInt32LE(24),48000);
 assert.equal(bytes.readUInt16LE(34),24);
 assert.equal(bytes.readUInt32LE(4)+8,bytes.length);
 assert.equal(bytes.readUInt32LE(40)+44,bytes.length);
 assert.equal(bytes.length,44+result.frames*6);
 const sample=(time,ch=0)=>bytes.readIntLE(44+(Math.round(time*48000)*2+ch)*3,3)/8388608;
 const start=sample(.03);
 assert.ok(start>.1 && start<.3);
 assert.ok(Math.abs(sample(.08)*2-start)<1e-4,'arrangement gain automation');
 assert.ok(sample(.115)>0 && sample(.115)<sample(.08),'note released at end despite no explicit note-off');
 assert.equal(sample(.5),0);
 assert.equal(sample(.5,1),0);
 assert.ok(Math.abs(sample(2.03,1)-start)<1e-5,'echo survives more than one silent render block');
 assert.ok(result.tailFrames>2*48000 && result.tailFrames<3*48000);
 assert.deepEqual(await fs.readdir(args.dir),['arrangement.wav']);
 assert.equal(progress[0],0);assert.equal(progress.at(-1),1);
 assert.ok(progress.every((p,i)=>i===0||p>=progress[i-1]));
});

for (const mode of ['cancel','failure']) test(mode+' leaves destination intact and cleans temporary file',async t=>{
 const args=await fixture(t), control=new AbortController();
 let stopped=false;
 const createRenderer=async()=>({
  async request(q){
   if(q.op==='load'&&mode==='failure')throw Error('DSP compile failed');
   if(q.op==='renderPcm24'){
    control.abort();
    return {frames:q.frames,pcm:Buffer.alloc(q.frames*6).toString('base64')};
   }
  },
  async stop(){stopped=true;}
 });
 await assert.rejects(exportAudio({...args,createRenderer,sequence:{end:.1,events:[]},graph:{},signal:control.signal}),
  mode==='cancel'?{name:'AbortError'}:/compile failed/);
 assert.equal(stopped,true);
 assert.equal(await fs.readFile(args.path,'utf8'),'previous');
 assert.deepEqual(await fs.readdir(args.dir),['arrangement.wav']);
});

test('WASM routes post-pan sends through return effects and applies effect and bus automation',async t=>{
 const args=await fixture(t);
 const {createRenderer}=await import('./export-wasm.mjs');
 const instrument='g=button("gate"); v=hslider("Level",0.25,0,1,0.01);process=g*v,g*v;';
 const fx='k=hslider("Amount",1,0,1,0.01);process=*(k),*(k);';
 const graph={racks:[{instrument,pan:-1,sends:{delay:.5,reverb:1},
  effects:[{id:'dry',code:'process=*(0),*(0);',bypass:true}]}],buses:{
   delay:{gain:.5,effects:[{id:'scaled',code:fx}]},reverb:{gain:1,effects:[{id:'wet',code:fx,bypass:true,wetOnly:true}]}
 }};
 const events=[{track:0,time:0,status:144,data1:60,data2:127},
  {track:'delay',device:'scaled',address:'/ShallowEffect/Amount',time:.02,value:0},
  {track:0,device:'instrument',address:'/ShallowSynth/Level',time:.04,value:.1},
  {track:'master',device:'mixer',address:'level',time:.06,value:.5}];
 const res=await exportAudio({...args,createRenderer,graph,sequence:{events,end:.08}});
 const bytes=await fs.readFile(res.path);
 const at=(s,c)=>bytes.readIntLE(44+(Math.round(s*48000)*2+c)*3,3)/8388608;
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,a+' != '+b);
 near(at(.01,0),.625);near(at(.01,1),0);
 near(at(.03,0),.5);near(at(.05,0),.2);near(at(.07,0),.1);
});
