const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createNativeAudio,engineName} = require('./native-audio.cjs');

function harness(source, options = {}) {
 return createNativeAudio({binary: process.execPath, args: ['-e', source], arch:'arm64', platform:'darwin', ...options});
}

test('status probes without starting audio and rejects an unavailable binary', async () => {
 const bridge = createNativeAudio({binary:'/missing/ShallowGrooveEngine'});
 assert.deepEqual(bridge.status(), {available:false, running:false});
 await assert.rejects(bridge.request({op:'status'}), /unavailable/);
});

test('routes replies by id, forwards events and rejects pending requests when stopped', async t => {
 const events = [];
 const bridge = harness(`
  require('node:readline').createInterface({input:process.stdin}).on('line', line => {
   const {id,op} = JSON.parse(line);
   if(op === 'wait') return;
   if(op === 'status') console.log(JSON.stringify({event:'clock',frame:512}));
   setTimeout(() => console.log(JSON.stringify({id, ok:op!=='bad', op, error:'bad patch'})), op === 'status' ? 20 : 0);
  });
 `, {onEvent:e=>events.push(e)});
 t.after(()=>bridge.stop());
 assert.equal(bridge.status().running,false);
 const results = await Promise.all([bridge.request({op:'status'}),bridge.request({op:'noteOn'})]);
 assert.deepEqual(results.map(r=>r.op), ['status','noteOn']);
 await assert.rejects(bridge.request({op:'bad'}), /bad patch/);
 assert.deepEqual(events,[{event:'clock',frame:512}]);
 const pending = assert.rejects(bridge.request({op:'wait'}), /exited/);
 await bridge.stop();
 await pending;
 assert.equal(bridge.status().running,false);
 assert.equal(events.length,1);
 assert.equal((await bridge.request({op:'status'})).ok,true);
});

test('an unexpected helper exit notifies the renderer and releases pending requests',async () => {
 const events = [];
 const bridge = harness('process.exit(7)',{onEvent:e=>events.push(e)});
 await assert.rejects(bridge.request({op:'load'}),/exited/);
 assert.equal(events[0].event,'disconnected');
 assert.equal(bridge.status().running,false);
});

test('engine and MIDI choices persist independently across process lifetimes',t=>{
 const fs=require('node:fs'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'sg-audio-prefs-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const make=()=>require('./native-audio.cjs').audioPreferences(dir);
 assert.deepEqual(make().preferences(),{engine:'web',midiInputs:[],output:{device:null,sampleRate:null,bufferSize:null}});
 make().savePreferences({engine:'native'});
 make().savePreferences({midiInputs:['first','first']});
 assert.deepEqual(make().preferences(),{engine:'native',midiInputs:['first'],output:{device:null,sampleRate:null,bufferSize:null}});
 assert.throws(()=>make().savePreferences({engine:'invalid'}));
 assert.equal(make().preferences().engine,'native');
});

test('late meter polls and inspector disposal leave a stopped engine stopped',async()=>{
 const bridge=harness('');
 await assert.rejects(bridge.request({op:'meters'}),/stopped/);
 await assert.rejects(bridge.request({op:'inspectRead'}),/stopped/);
 assert.ok((await bridge.request({op:'inspectClose'})).ok);
 assert.equal(bridge.status().running,false);
});

test('selects the Windows x64 executable and detects supported desktop runtimes', () => {
 assert.equal(engineName('win32'),'ShallowGrooveEngine.exe');
 assert.equal(engineName('darwin'),'ShallowGrooveEngine');
 for(const [platform,arch,available] of [['win32','x64',true],['darwin','arm64',true],['win32','ia32',false],['linux','x64',false]]){
  assert.equal(createNativeAudio({binary:process.execPath,platform,arch}).status().available,available);
 }
});
