const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {desktopAudio}=require('./native-output.cjs');
const automatic={device:null,sampleRate:null,bufferSize:null};
const selected={device:'Interface',sampleRate:48000,bufferSize:256};
const graph={racks:[{instrument:'test'}]};
const change={output:selected,graph,midiInputs:['keyboard'],monitor:{track:0,enabled:true}};

function fixture(t, intercept=()=>{}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sg-output-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const clients=[],events=[];
 const controller=desktopAudio({directory,onEvent:m=>events.push(m),create:({onEvent})=>{
  const h={calls:[],running:false,output:automatic,onEvent,status:()=>({available:true,running:h.running}),
   stop:async()=>{h.running=false;},request:async q=>{
    h.running=true;h.calls.push(q);
    await intercept(h,q,clients);
    if(q.op==='outputOptions')return {devices:['Interface'],sampleRates:[44100,48000],bufferSizes:[256,512]};
    if(q.op==='configureOutput'){h.output=q.output;return {midiInputs:[{id:'keyboard'}]};}
    if(q.op==='status')return {audioDevice:h.output.device||'Built in',sampleRate:h.output.sampleRate||44100,bufferSize:h.output.bufferSize||512,position:1.25,playing:false};
    return {ok:true};
   }};
  clients.push(h);return h;
 }});
 return {controller,clients,events,directory};
}
test('new native-capable profiles prefer native, and existing Web selection survives migration', t=>{
 const {controller,directory}=fixture(t);
 assert.equal(controller.preferences().engine,'native');
 fs.writeFileSync(path.join(directory,'audio-preferences.json'),JSON.stringify({engine:'web',midiInputs:['a']}));
 assert.deepEqual(controller.preferences(),{engine:'web',midiInputs:['a'],output:automatic});
});
test('apply prepares the project and MIDI on the new device before saving it', async t=>{
 const {controller,clients}=fixture(t);
 await controller.request({op:'load',...graph});
 assert.deepEqual(clients[0].calls[0],{op:'configureOutput',output:automatic});
 const result=await controller.applyOutput(change);
 assert.equal(result.bufferSize,256);
 assert.deepEqual(clients[1].calls.map(c=>c.op),['outputOptions','configureOutput','load','setMidiInputs','seek','setMonitor','status']);
 assert.equal(clients[1].calls[4].position,1.25);
 assert.equal(clients[0].running,false);
 assert.deepEqual(controller.preferences().output,selected);
});
test('failed graph load recovers a disturbed device and preserves saved output',async t=>{
 const {controller,clients,events}=fixture(t,(h,q,list)=>{
  if(h===list[1]&&q.op==='load'){list[0].onEvent({event:'deviceLost'});throw Error('load failed');}
 });
 await controller.request({op:'load',...graph});
 await assert.rejects(controller.applyOutput(change),/load failed/);
 assert.deepEqual(events,[]);
 assert.equal(clients[0].calls.filter(q=>q.op==='load').length,2);
 assert.equal(clients[1].running,false);
 assert.equal(clients[0].running,true);
 assert.deepEqual(controller.preferences().output,automatic);
});
test('option probing while inactive does not leave a device open',async t=>{
 const {controller,clients}=fixture(t);
 await controller.outputOptions(null);assert.equal(clients[1].running,false);
 assert.equal(controller.status().running,false);
});
test('a Web Audio user can replace a missing pinned device without starting it first',async t=>{
 const {controller,clients}=fixture(t);
 controller.savePreferences({engine:'web',output:{...selected,device:'Disconnected'}});
 await controller.applyOutput({...change,position:2,midiInputs:['keyboard','unplugged']});
 assert.equal(controller.preferences().engine,'native');
 assert.deepEqual(controller.preferences().output,selected);
 assert.deepEqual(clients[0].calls,[]);
 assert.equal(clients[1].calls.find(q=>q.op==='seek').position,2);
 assert.deepEqual(clients[1].calls.find(q=>q.op==='setMidiInputs').ids,['keyboard']);
});

test('stopping the engine during device setup cannot resurrect or persist a candidate',async t=>{
 let entered,release;
 const blocked=new Promise(r=>{entered=r;}),resume=new Promise(r=>{release=r;});
 const {controller,clients}=fixture(t,async(h,q,list)=>{
  if(h===list[1]&&q.op==='configureOutput'){entered();await resume;}
 });
 await controller.request({op:'load',...graph});
 const result=assert.rejects(controller.applyOutput(change),/stopped/);
 await blocked;
 await controller.stop();release();
 await result;
 assert.equal(clients.some(h=>h.running),false);
 assert.deepEqual(controller.preferences().output,automatic);
});
