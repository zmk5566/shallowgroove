const dgram=require('node:dgram');
const fs=require('node:fs');
const {join}=require('node:path');
const {isIPv4}=require('node:net');
const {networkInterfaces}=require('node:os');
const decoder=new TextDecoder('utf-8',{fatal:true});

function parseOsc(packet,time=Date.now()){
 const messages=[];
 function parse(buf,depth){
  if(!buf.length||buf.length%4||depth>8)throw Error('Invalid OSC packet');
  let offset=0;
  function string(){
   const end=buf.indexOf(0,offset);
   if(end<0)throw Error('Unterminated OSC string');
   const value=decoder.decode(buf.subarray(offset,end));
   offset=(end+4)&~3;
   if(offset>buf.length||buf.subarray(end,offset).some(byte=>byte!==0))throw Error('Invalid OSC string padding');
   return value;
  }
  const address=string();
  if(address==='#bundle'){
   if(buf.readBigUInt64BE(offset)!==1n)throw Error('Expected immediate OSC bundle');
   offset+=8;
   while(offset<buf.length){
    const size=buf.readInt32BE(offset);offset+=4;
    if(size<=0||offset+size>buf.length)throw Error('Invalid OSC bundle element');
    parse(buf.subarray(offset,offset+size),depth+1);offset+=size;
   }
   return;
  }
  if(!address.startsWith('/')||/[\x00-\x20\x7f]/.test(address))throw Error('Invalid OSC address');
  const tags=string();
  if(!tags.startsWith(','))throw Error('Missing OSC type tags');
  const args=[];
  for(const tag of tags.slice(1)){
   let value;
   switch(tag){
    case 'i':value=buf.readInt32BE(offset);offset+=4;break;
    case 'h':value=Number(buf.readBigInt64BE(offset));offset+=8;if(!Number.isSafeInteger(value))throw Error('Unrepresentable OSC integer');break;
    case 'f':value=buf.readFloatBE(offset);offset+=4;break;
    case 'd':value=buf.readDoubleBE(offset);offset+=8;break;
    case 's':case 'S':value=string();break;
    case 'T':value=true;break;
    case 'F':value=false;break;
    case 'N':value=null;break;
    default:throw Error('Unsupported OSC argument');
   }
   if(typeof value==='number'&&!Number.isFinite(value))throw Error('Invalid OSC numeric argument');
   args.push(value);
  }
  if(offset!==buf.length)throw Error('Trailing OSC data');
  messages.push({address,args,time,types:tags.slice(1)});
 }
 parse(packet,0);return messages;
}

function settings(value){
 if(typeof value?.id!=='string'||!value.id.trim()||value.id.length>300||
    typeof value.name!=='string'||!value.name.trim()||value.name.length>300||
    typeof value.enabled!=='boolean'||!Number.isInteger(value.port)||value.port<1||value.port>65535||
    typeof value.host!=='string'||!isIPv4(value.host))throw Error('Invalid OSC endpoint settings');
 return {id:value.id,name:value.name,enabled:value.enabled,host:value.host,port:value.port};
}

function createOscReceiver(directory,onMessages){
 const file=join(directory,'osc.json');
 const endpoints=new Map(),sockets=new Map();
 let queue=Promise.resolve(),closed=false;
 function serial(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
 function status(){
  const interfaces=[];
  for(const [name,addresses] of Object.entries(networkInterfaces()))
   for(const iface of addresses??[])if(iface.family==='IPv4')interfaces.push({name,address:iface.address});
  return {endpoints:[...endpoints.values()].map(e=>({...e,enabled:sockets.has(e.id)})),interfaces};
 }
 function save(next){
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(file+'.tmp',JSON.stringify({endpoints:[...next.values()]}),{mode:0o600});
  fs.renameSync(file+'.tmp',file);
 }
 async function stop(id){
  const live=sockets.get(id);if(!live)return;
  sockets.delete(id);clearTimeout(live.timer);
  live.socket.removeAllListeners('message');await new Promise(resolve=>live.socket.close(resolve));
 }
 async function start(e){
  const socket=dgram.createSocket('udp4');
  const live={socket,batch:[],timer:undefined};
  await new Promise((resolve,reject)=>{
   socket.once('error',reject);
   socket.bind(e.port,e.host,()=>{socket.off('error',reject);resolve();});
  }).catch(error=>{socket.close();throw error;});
  socket.on('error',()=>{void serial(async()=>{if(sockets.get(e.id)===live)await stop(e.id);});});
  socket.on('message',packet=>{
   let messages;try{messages=parseOsc(packet);}catch{return;}
   for(const message of messages){message.endpointId=e.id;live.batch.push(message);}
   if(live.batch.length>2048)live.batch.splice(0,live.batch.length-2048);
   if(live.batch.length&&!live.timer)live.timer=setTimeout(()=>{
    const messages=live.batch;live.batch=[];live.timer=undefined;onMessages(messages);
   },8);
  });
  sockets.set(e.id,live);
 }
 async function configure(command){
  if(closed)throw Error('OSC receiver closed');
  if(command?.op==='remove'){
   if(!endpoints.has(command.id))throw Error('Unknown OSC endpoint');
   const next=new Map(endpoints);next.delete(command.id);
   save(next);await stop(command.id);endpoints.delete(command.id);
  }else if(command?.op==='put'){
   const e=settings(command.endpoint),prior=endpoints.get(e.id),wasLive=sockets.has(e.id);
   const rebind=wasLive&&(!e.enabled||e.host!==prior.host||e.port!==prior.port);
   const open=e.enabled&&(!wasLive||rebind);
   if(rebind)await stop(e.id);
   try{
    if(open)await start(e);
    save(new Map(endpoints).set(e.id,e));
   }catch(error){
    if(open)await stop(e.id);
    if(rebind)try{await start(prior);}catch{/* status reports the unavailable endpoint. */}
    throw error;
   }
   endpoints.set(e.id,e);
  }else throw Error('Unknown OSC settings operation');
  return status();
 }
 const ready=serial(async()=>{
  let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return;}
  if(!saved||typeof saved!=='object')return;
  const legacy=!Array.isArray(saved.endpoints);
  const values=legacy?[{...saved,id:'default',name:'OSC'}]:saved.endpoints;
  for(const value of values){
   let e;try{e=settings(value);}catch{continue;}
   if(endpoints.has(e.id))continue;
   endpoints.set(e.id,e);
   if(e.enabled)try{await start(e);}catch{/* Other endpoints still start. */}
  }
  if(legacy&&endpoints.size)try{save(endpoints);}catch{/* Retry migration on next save. */}
 });
 return {
  ready,status:()=>serial(status),configure:command=>serial(()=>configure(command)),
  close:()=>{closed=true;return serial(()=>Promise.all([...sockets.keys()].map(stop)));}
 };
}
module.exports={createOscReceiver,parseOsc};
