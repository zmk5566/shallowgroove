import {WebSocketServer,WebSocket} from 'ws';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const identifier=v=>typeof v==='string'&&/^[\w.-]{1,80}$/.test(v);
const send=(ws,data)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<1000000)ws.send(JSON.stringify(data));};
export function trustedLocalPeer(address,host,origin){
 return loopback(address)&&/^((localhost|127\.0\.0\.1)(:\d+)?|\[::1\](:\d+)?)$/.test(host||'')&&(!origin||origin===`http://${host}`);
}
export function attachHexblocks(server,env={}){
 const token=env.SHALLOWGROOVE_HEXBLOCKS_TOKEN||randomBytes(24).toString('hex');
 const wss=new WebSocketServer({noServer:true,maxPayload:128*1024});const peers=new Map(),connectors=new Map(),pending=new Map();let owner=null;
 const publish=data=>{for(const [ws,p] of peers)if(p.role==='audio')send(ws,data);};
 const snapshot=()=>({type:'snapshot',connectors:[...connectors.values()].map(c=>({id:c.id,label:c.label,connected:true,transport:c.transport,modules:[...c.modules.values()]}))});
 const ownership=()=>{for(const [ws,p] of peers)if(p.role==='audio')send(ws,{type:'ownership',active:owner===ws});};
 const upgrade=(req,socket,head)=>{if(req.url?.split('?')[0]!=='/hexblocks/ws')return;wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));};server.on('upgrade',upgrade);
 wss.on('connection',(ws,req)=>{
  let authenticated=false;ws.alive=true;ws.on('pong',()=>{ws.alive=true;});const timer=setTimeout(()=>ws.close(1008,'Authentication timeout'),5000);
  ws.on('message',raw=>{try{
   const m=JSON.parse(raw.toString());if(!authenticated){
    if(m.type!=='auth'||(!trustedLocalPeer(req.socket.remoteAddress,req.headers.host,req.headers.origin)&&!equal(m.token,token))||!['audio','connector','remote'].includes(m.role))throw Error('Authentication failed');
    if(m.role==='audio'&&(!loopback(req.socket.remoteAddress)||req.headers.origin!==`http://${req.headers.host}`))throw Error('Audio owner requires local application origin');
    if(m.role==='connector'&&(!identifier(m.id)||connectors.has(m.id)))throw Error('Connector ID invalid or already connected');
    authenticated=true;clearTimeout(timer);peers.set(ws,{role:m.role,id:m.id});
    if(m.role==='connector')connectors.set(m.id,{id:m.id,label:String(m.label||m.id).slice(0,120),transport:{connected:false},modules:new Map(),ws});
    if(m.role==='audio'&&!owner)owner=ws;
    send(ws,{type:'welcome',role:m.role});send(ws,snapshot());ownership();publish(snapshot());return;
   }
   const peer=peers.get(ws);
   if(peer.role==='audio'&&m.type==='claim'){owner=ws;ownership();return;}
   if(peer.role==='connector'){
    const c=connectors.get(peer.id);if(m.type==='transport'){
     c.transport={connected:m.connected===true,kind:String(m.kind||''),label:String(m.label||'').slice(0,120)};if(!c.transport.connected)c.modules.clear();publish(snapshot());return;
    }
    if(m.type==='event'){
     const e=m.event;if(!e||typeof e.type!=='string')throw Error('Invalid event');
     if(e.type==='command_ack'){publish({type:'hardware_ack',connectorId:c.id,event:e});return;}
     if(!/^[a-fA-F0-9]{8}$/.test(e.uid)||!c.transport.connected)return;e.uid=e.uid.toUpperCase();
     if(['unplug','detach_pending'].includes(e.type)){c.modules.delete(e.uid);publish(snapshot());return;}
     if(!c.modules.has(e.uid)){if(c.modules.size>=128)throw Error('Module limit');c.modules.set(e.uid,{uid:e.uid,channels:{}});}
     const mod=c.modules.get(e.uid);
     if(e.type==='sensor'){
      if(!Number.isInteger(e.channel_id)||e.channel_id<0||e.channel_id>255||!Number.isFinite(e.value))return;
      const sample={value:e.value,at:Date.now()};mod.channels[e.channel_id]=sample;publish({type:'sensor',connectorId:c.id,uid:e.uid,channel:e.channel_id,...sample});return;
     }
     if(['hello','module_info'].includes(e.type))mod.name=String(e.id||e.uid).slice(0,120);
     if(e.type==='descriptor'&&e.data&&typeof e.data==='object'&&!Array.isArray(e.data)){
      const d=e.data;mod.descriptor={...d,name:typeof d.name==='string'?d.name.slice(0,120):undefined,nm:typeof d.nm==='string'?d.nm.slice(0,120):undefined,channels:Array.isArray(d.channels)?d.channels.filter(ch=>ch&&Number.isInteger(ch.id)&&ch.id>=0&&ch.id<=255).slice(0,256).map(ch=>({id:ch.id,label:String(ch.label||ch.id).slice(0,80),min:Number.isFinite(ch.min)?ch.min:undefined,max:Number.isFinite(ch.max)?ch.max:undefined,...(typeof ch.context==='string'?{context:ch.context.slice(0,2000)}:{}),...(ch.derived===true?{derived:true}:{})})):[]};
     }
     if(['hello','topology','face_swap'].includes(e.type)){mod.parent=e.parent_uid??e.new_parent_uid??null;mod.face=e.parent_face??e.new_parent_face;mod.hub=e.parent_is_hub??e.new_parent_is_hub;}
     publish(snapshot());return;
    }
   }
   if(peer.role==='audio'&&m.type==='subscribe'&&owner===ws){
    const c=connectors.get(m.connectorId);if(c?.transport.connected&&c.modules.has(m.uid)&&Number.isInteger(m.channel)&&m.channel>=0&&m.channel<=255)send(c.ws,{type:'subscribe',uid:m.uid,channel:m.channel});return;
   }
   // Remote controls execute in the active browser; acknowledgement is never synthesized by the server.
   if(peer.role==='remote'&&m.type==='control'){
    if(!identifier(m.id)||!['play','pause','stop','seek','set_loop','set_mix','set_parameter','set_send'].includes(m.command?.action))throw Error('Unsupported control');
    if(!owner){send(ws,{type:'result',id:m.id,error:'No active audio session'});return;}
    if(pending.size>=32)throw Error('Too many pending controls');const id=randomUUID(),target=owner;
    const timeout=setTimeout(()=>{pending.delete(id);send(ws,{type:'result',id:m.id,error:'Audio session acknowledgement timed out; inspect before retrying'});},15000);
    pending.set(id,{ws,id:m.id,target,timeout});send(target,{type:'control',id,command:m.command});return;
   }
   if(peer.role==='audio'&&m.type==='result'){
    const p=pending.get(m.id);if(p?.target===ws){clearTimeout(p.timeout);pending.delete(m.id);send(p.ws,{type:'result',id:p.id,result:m.result,error:m.error});}return;
   }
  }catch(error){send(ws,{type:'error',message:String(error.message)});if(!authenticated)ws.close(1008,'Authentication failed');}});
  ws.on('close',()=>{clearTimeout(timer);const p=peers.get(ws);peers.delete(ws);if(p?.role==='connector'){connectors.delete(p.id);publish(snapshot());}if(owner===ws){owner=null;ownership();}for(const [id,r] of pending)if(r.target===ws||r.ws===ws){clearTimeout(r.timeout);pending.delete(id);if(r.ws!==ws)send(r.ws,{type:'result',id:r.id,error:'Audio session disconnected'});}});
 });
 const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},10000);heartbeat.unref();
 return {token,close(){clearInterval(heartbeat);for(const r of pending.values())clearTimeout(r.timeout);for(const ws of wss.clients)ws.terminate();wss.close();server.off('upgrade',upgrade);}};
}
export function hexblocksPlugin(env={}){
 let bridge;const install=server=>{bridge=attachHexblocks(server.httpServer,env);server.middlewares.use((req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/hexblocks/config')return next();
  const host=req.headers.host,local=loopback(req.socket.remoteAddress),same=!req.headers.origin||req.headers.origin===`http://${host}`;
  if(req.method!=='GET'||!local||!same||req.headers['sec-fetch-site']==='cross-site'||!/^((localhost|127\.0\.0\.1)(:\d+)?|\[::1\](:\d+)?)$/.test(host||'')){res.writeHead(403);res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token:bridge.token,path:'/hexblocks/ws',network:env.SHALLOWGROOVE_NETWORK==='1'}));
 });server.httpServer.once('close',()=>bridge.close());};
 return {name:'shallowgroove-hexblocks',configureServer:install,configurePreviewServer:install};
}
