import {fork} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
const backend=fork(process.env.SHALLOWGROOVE_CHECK_SERVER||new URL('./server.mjs',import.meta.url),[],{stdio:['ignore','ignore','inherit','ipc']});
const timeout=setTimeout(()=>{backend.kill();process.exitCode=1;},90000);
try{
 const [{port}]=await once(backend,'message');const base=`http://127.0.0.1:${port}`;
 assert.equal((await fetch(base)).status,200);
 assert.equal((await fetch(base+'/faust/libfaust-wasm.wasm')).status,200);
 const status=await fetch(base+'/api/assistant/status').then(r=>r.json());assert.equal(status.configured,status.keySource==='builtin');
 const ws=new WebSocket(`ws://127.0.0.1:${port}/hexblocks/ws`,{origin:base});await once(ws,'open');
 const welcome=once(ws,'message');ws.send(JSON.stringify({type:'auth',role:'audio'}));assert.equal(JSON.parse((await welcome)[0]).type,'welcome');ws.close();
 console.log('PASS: HTML, Faust WASM, assistant status, Hexblocks WebSocket');
 if(process.argv.includes('--live')){
  const response=await fetch(base+'/api/assistant/turn',{method:'POST',headers:{'Content-Type':'application/json','X-Shallowgroove-Token':status.token},body:JSON.stringify({sessionId:crypto.randomUUID(),text:'Reply with OK only. Do not call tools.',context:{selection:{}},mode:'discuss',locale:'en'})});
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  const error=events.find(e=>e.type==='error');if(error)throw Error(error.message);
  assert.ok(events.some(e=>e.type==='reply'&&e.text));console.log('PASS: live DeepSeek assistant reply');
  const sessionId=crypto.randomUUID();
  const toolResponse=await fetch(base+'/api/assistant/turn',{method:'POST',headers:{'Content-Type':'application/json','X-Shallowgroove-Token':status.token},body:JSON.stringify({sessionId,text:'Call inspect_selection once to inspect the current selection, then briefly report what you found.',context:{selection:{}},mode:'discuss',locale:'en'})});
  assert.equal(toolResponse.status,200);
  let buffer='',inspected=false,replied=false;
  const decoder=new TextDecoder();
  for await(const chunk of toolResponse.body){
   buffer+=decoder.decode(chunk,{stream:true});
   let end;
   while((end=buffer.indexOf('\n'))>=0){
    const event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
    if(event.type==='error')throw Error(event.message);
    if(event.type==='tool'){
     assert.equal(event.command.action,'inspect');inspected=true;
     const acknowledged=await fetch(base+'/api/assistant/result',{method:'POST',headers:{'Content-Type':'application/json','X-Shallowgroove-Token':status.token},body:JSON.stringify({sessionId,id:event.id,result:{selection:null,tracks:[],message:'Isolated packaging test: empty project.'}})});
     assert.equal(acknowledged.status,200);
    }
    if(event.type==='reply'&&event.text)replied=true;
   }
  }
  assert.ok(inspected&&replied,'Music tool round-trip must finish');
  console.log('PASS: live music inspection tool round-trip (isolated empty project)');
 }
}finally{clearTimeout(timeout);backend.kill('SIGTERM');}
