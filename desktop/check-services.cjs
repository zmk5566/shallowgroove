const {startMusic,startConnect,stopService}=require('./services.cjs');
const {resolve,join}=require('node:path');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {createServer}=require('node:net');
const assert=require('node:assert/strict');
const {WebSocket}=require('ws');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const resources=resolve(process.argv[2]),root=join(resources,'app');
 const dataDirectory=mkdtempSync(join(tmpdir(),'shallowgroove-services-'));
 const blockers=[];let music,connect,ws;
 try{
  for(const port of [5198,8766]){
   const server=createServer(socket=>socket.destroy());
   await new Promise((done,reject)=>{server.once('error',error=>error.code==='EADDRINUSE'?done():reject(error));server.listen(port,'127.0.0.1',()=>{blockers.push(server);done();});});
  }
  music=startMusic({root,resources,dataDirectory});const musicPort=await music.ready;
  assert.notEqual(musicPort,5198);
  connect=startConnect({resources,musicPort,smoke:true});const connectPort=await connect.ready;
  assert.notEqual(connectPort,8766);
  const base=`http://127.0.0.1:${connectPort}`;
  let state;
  for(let i=0;i<100;i++){
   state=await fetch(base+'/api/state').then(r=>r.json());
   if(state.networkConnected&&state.modules.length===2)break;
   await delay(100);
  }
  assert.equal(state.networkConnected,true);assert.equal(state.modules.length,2);
  assert.equal('ports' in state,false);
  const html=await fetch(base).then(r=>r.text());
  assert.ok(html.includes('connect-ble'));assert.ok(!html.includes('connect-serial'));
  const rejected=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Connect-Token':state.csrf},body:JSON.stringify({action:'connect',kind:'serial',address:'COM1'})});
  assert.equal(rejected.status,400);
  assert.equal((await fetch(base+'/api/state').then(r=>r.json())).transport.kind,'sim');

  assert.equal(state.server,`ws://127.0.0.1:${musicPort}/hexblocks/ws`);
  ws=new WebSocket(state.server,{origin:`http://127.0.0.1:${musicPort}`});
  const sample=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Sensor timeout')),10000);
   ws.on('error',reject);
   ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='sensor'&&m.uid==='C0FFEE01'&&m.value===0.37){clearTimeout(timer);resolve();}});
  });
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  ws.send(JSON.stringify({type:'auth',role:'audio'}));
  const response=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Connect-Token':state.csrf},body:JSON.stringify({action:'sim_value',value:0.37})});
  assert.equal(response.status,200);await sample;ws.close();
  await Promise.all([stopService(connect),stopService(music)]);
  await assert.rejects(fetch(base+'/api/state'));
  await assert.rejects(fetch(`http://127.0.0.1:${musicPort}/`));
  console.log('PASS: integrated Python/Node startup, both port fallbacks, automatic link, sensor forwarding, coordinated shutdown');
 }finally{
  ws?.close();await Promise.allSettled([stopService(connect),stopService(music)]);
  for(const server of blockers)await new Promise(done=>server.close(done));
  rmSync(dataDirectory,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
