import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
async function start(){
 const child=fork(process.env.SHALLOWGROOVE_CHECK_SERVER||new URL('./server.mjs',import.meta.url),[],{stdio:['ignore','ignore','inherit','ipc']});
 const port=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(Error('Backend startup timeout'));},10000);
  child.once('message',message=>{clearTimeout(timer);resolve(message.port);});
  child.once('exit',code=>{clearTimeout(timer);reject(Error(`Backend exited ${code}`));});
 });
 return {port,async close(){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}};
}
async function reserve(){
 const server=createServer();
 const available=await new Promise((resolve,reject)=>{server.once('error',error=>error.code==='EADDRINUSE'?resolve(false):reject(error));server.listen(5198,'127.0.0.1',()=>resolve(true));});
 return available?server:null;
}
test('desktop prefers 5198 when available and remains usable when occupied',async t=>{
 const probe=await reserve();
 if(probe){
  await new Promise(resolve=>probe.close(resolve));
  const first=await start();
  try{assert.equal(first.port,5198);}finally{await first.close();}
 }else t.diagnostic('5198 already belongs to another app; checking fallback without stopping it');
 const occupied=await reserve();
 try{
  const second=await start();
  try{assert.notEqual(second.port,5198);const response=await fetch(`http://127.0.0.1:${second.port}/api/hexblocks/config`);assert.equal(response.status,200);assert.equal((await response.json()).path,'/hexblocks/ws');}finally{await second.close();}
 }finally{if(occupied)await new Promise(resolve=>occupied.close(resolve));}
});
