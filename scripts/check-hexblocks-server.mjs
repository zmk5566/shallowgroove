import {createServer} from 'node:http';import {WebSocket} from 'ws';import assert from 'node:assert/strict';import {attachHexblocks,trustedLocalPeer} from '../server/hexblocks.mjs';
const server=createServer(),bridge=attachHexblocks(server,{SHALLOWGROOVE_HEXBLOCKS_TOKEN:'fixture-token'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,url=`ws://127.0.0.1:${port}/hexblocks/ws`,clients=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function client(role,id,token='',origin=`http://127.0.0.1:${port}`){const ws=new WebSocket(url,{headers:origin?{Origin:origin}:{}});clients.push(ws);const messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});ws.send(JSON.stringify({type:'auth',role,id,token}));return {ws,messages,send:v=>ws.send(JSON.stringify(v))};}
async function wait(c,predicate){for(let n=0;n<100;n++){const m=c.messages.find(predicate);if(m)return m;await pause(20);}throw Error('Message timeout '+JSON.stringify(c.messages));}
try{
 assert.equal(trustedLocalPeer('192.168.1.2',`127.0.0.1:${port}`,undefined),false);assert.equal(trustedLocalPeer('127.0.0.1',`evil.example:${port}`,undefined),false);assert.equal(trustedLocalPeer('::1',`[::1]:${port}`,undefined),true);
 const bad=await client('connector','bad','wrong','https://untrusted.example');await wait(bad,m=>m.type==='error');
 const a=await client('audio');await wait(a,m=>m.type==='ownership'&&m.active);const second=await client('audio');await wait(second,m=>m.type==='ownership'&&!m.active);
 const c=await client('connector','connect-test','',null);await wait(c,m=>m.type==='welcome');c.send({type:'transport',connected:true,kind:'sim'});c.send({type:'event',event:{type:'hello',uid:'AABBCCDD',id:'Knob',parent_is_hub:true,parent_face:1}});c.send({type:'event',event:{type:'sensor',uid:'AABBCCDD',channel_id:40,value:.75}});await wait(a,m=>m.type==='sensor'&&m.value===.75);
 const context='HEX25 absolute position: E1=0, E12=1; wrap to 0; hold on release';c.send({type:'event',event:{type:'descriptor',uid:'AABBCCDD',data:{channels:[{id:240,label:'Outer position',min:0,max:1,derived:true,context}]}}});
 const remote=await client('remote');await wait(remote,m=>m.type==='welcome');remote.send({type:'control',id:'seek-1',command:{action:'seek',seconds:3}});const control=await wait(a,m=>m.type==='control');assert.equal(remote.messages.some(m=>m.type==='result'),false);a.send({type:'result',id:control.id,result:{position:3}});assert.equal((await wait(remote,m=>m.type==='result')).result.position,3);
 second.send({type:'claim'});await wait(second,m=>m.type==='ownership'&&m.active);
 const replay=await client('audio');assert.equal((await wait(replay,m=>m.type==='snapshot'&&m.connectors.length)).connectors[0].modules[0].channels[40].value,.75);
 const descriptorSnapshot=await wait(replay,m=>m.type==='snapshot'&&m.connectors[0]?.modules[0]?.descriptor?.channels?.length);assert.deepEqual(descriptorSnapshot.connectors[0].modules[0].descriptor.channels[0],{id:240,label:'Outer position',min:0,max:1,derived:true,context});
 c.ws.close();await wait(a,m=>m.type==='snapshot'&&m.connectors.length===0);console.log('HEXBLOCKS_AUTH_REPLAY_OWNERSHIP_REMOTE_ACK_PASS');
}finally{for(const ws of clients)ws.terminate();bridge.close();await new Promise(r=>server.close(r));}
