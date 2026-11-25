const {test}=require('node:test');
const assert=require('node:assert/strict');
const dgram=require('node:dgram');
const {mkdtemp,rm,writeFile,readFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {createOscReceiver,parseOsc}=require('./osc.cjs');

function str(value){
 const bytes=Buffer.from(value);const buf=Buffer.alloc((bytes.length+4)&~3);
 bytes.copy(buf);return buf;
}
function int(value){const buf=Buffer.alloc(4);buf.writeInt32BE(value);return buf;}
function float(value){const buf=Buffer.alloc(4);buf.writeFloatBE(value);return buf;}
function bundle(...members){
 return Buffer.concat([str('#bundle'),Buffer.from([0,0,0,0,0,0,0,1]),...members.flatMap(m=>[int(m.length),m])]);
}
const data=Buffer.concat([str('/probe'),str(',ifsTFN'),int(-10),float(.25),str('键盘')]);
test('decodes immediate nested bundles, types and packet timestamps atomically',()=>{
 const message={address:'/probe',types:'ifsTFN',args:[-10,.25,'键盘',true,false,null],time:12};
 assert.deepEqual(parseOsc(bundle(data,bundle(data)),12),[message,message]);
 for(const bad of [Buffer.alloc(7),data.subarray(0,-4),bundle(data,Buffer.alloc(4)),Buffer.concat([data,int(1)]),
  Buffer.concat([str('/x'),str(',f'),float(NaN)])])assert.throws(()=>parseOsc(bad));
 const scheduled=bundle(data);scheduled.writeBigUInt64BE(2n,8);assert.throws(()=>parseOsc(scheduled));
});
async function boundSocket(){
 const s=dgram.createSocket('udp4');
 await new Promise((resolve,reject)=>{s.once('error',reject);s.bind(0,'127.0.0.1',resolve);});return s;
}
async function tempDir(t){
 const directory=await mkdtemp(join(tmpdir(),'sg-osc-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 return directory;
}
async function freePort(){
 const s=await boundSocket(),port=s.address().port;
 await new Promise(resolve=>s.close(resolve));return port;
}
test('simultaneous endpoints isolate identical address traffic, binding errors and removal',async t=>{
 const directory=await tempDir(t);
 const peer=await boundSocket();t.after(()=>peer.close());
 const seen=[];
 const receiver=createOscReceiver(directory,messages=>seen.push(...messages));
 const put=endpoint=>receiver.configure({op:'put',endpoint});
 t.after(()=>receiver.close());
 const initial=await receiver.status();
 assert.deepEqual(initial.endpoints,[]);
 assert.ok(initial.interfaces.some(i=>i.name&&i.address==='127.0.0.1'));
 const a={id:'a',name:'First',enabled:true,host:'127.0.0.1',port:await freePort()};
 await put(a);
 const b={...a,id:'b',name:'Second',port:await freePort()};
 await put(b);
 await assert.rejects(put({...b,port:a.port}),/EADDRINUSE/);
 await assert.rejects(put({...a,host:'remote'}));
 assert.deepEqual((await receiver.status()).endpoints,[a,b]);
 const send=(port,packet)=>new Promise((ok,fail)=>peer.send(packet,port,'127.0.0.1',err=>err?fail(err):ok()));
 async function waitFor(n){
  const until=Date.now()+2000;
  while(seen.length<n&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
  assert.equal(seen.length,n);
 }
 await send(a.port,Buffer.from('broken'));await Promise.all([send(a.port,bundle(data)),send(b.port,data)]);
 await waitFor(2);
 assert.deepEqual(seen.map(m=>m.endpointId).sort(),['a','b']);
 for(const m of seen){assert.equal(m.address,'/probe');assert.equal(m.types,'ifsTFN');assert.equal(m.args[1],.25);}
 await put({...a,enabled:false});await send(a.port,data);await send(b.port,data);await waitFor(3);
 assert.equal(seen[2].endpointId,'b');
 await receiver.configure({op:'remove',id:a.id});
 const edited={...b,name:'LAN',host:'0.0.0.0'};
 await put(edited);await receiver.close();
 const restored=createOscReceiver(directory,()=>{});t.after(()=>restored.close());
 assert.deepEqual((await restored.status()).endpoints,[edited]);
});
test('legacy settings become the default endpoint and are persisted in multi-endpoint format',async t=>{
 const directory=await tempDir(t);
 const file=join(directory,'osc.json');
 const legacy={enabled:false,port:12000,host:'192.168.10.37'};
 await writeFile(file,JSON.stringify(legacy));
 const receiver=createOscReceiver(directory,()=>{});t.after(()=>receiver.close());
 const migrated={endpoints:[{...legacy,id:'default',name:'OSC'}]};
 assert.deepEqual((await receiver.status()).endpoints,migrated.endpoints);
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')),migrated);
});
