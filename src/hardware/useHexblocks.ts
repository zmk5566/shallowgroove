import {useEffect,useEffectEvent,useRef,useState} from 'react';
import type {MusicCommand} from '../assistant/contracts';
export interface HardwareModule {uid:string;name?:string;parent?:string|null;face?:number;hub?:boolean;descriptor?:{name?:string;nm?:string;channels?:{id:number;label:string;min?:number;max?:number;context?:string;derived?:boolean}[];[key:string]:unknown};channels:Record<string,{value:number;at:number}>}
export interface Connector {id:string;label:string;connected:boolean;transport:{connected:boolean;kind?:string;label?:string};modules:HardwareModule[]}
export function useHexblocks(onControl:(command:MusicCommand)=>Promise<unknown>){
 const [view,setView]=useState<{connected:boolean;active:boolean;connectors:Connector[];error:string}>({connected:false,active:false,connectors:[],error:''});
 const [config,setConfig]=useState<{token:string;path:string;network:boolean}|null>(null);
 const live=useRef(view),socket=useRef<WebSocket|null>(null);const control=useEffectEvent(onControl);
 useEffect(()=>{let cancelled=false,timer:ReturnType<typeof setTimeout>;const connect=async()=>{try{
  const r=await fetch('/api/hexblocks/config');if(!r.ok)throw Error('Hexblocks service unavailable');const conf=await r.json();if(cancelled)return;setConfig(conf);
  const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${conf.path}`);socket.current=ws;
  ws.onopen=()=>ws.send(JSON.stringify({type:'auth',role:'audio',token:conf.token}));
  ws.onmessage=async event=>{try{const m=JSON.parse(event.data);
   if(m.type==='welcome')live.current={...live.current,connected:true,error:''};
   if(m.type==='ownership')live.current={...live.current,active:m.active};
   if(m.type==='snapshot')live.current={...live.current,connectors:m.connectors};
   if(m.type==='sensor'){const mod=live.current.connectors.find(c=>c.id===m.connectorId)?.modules.find(d=>d.uid===m.uid);if(mod){mod.channels[m.channel]={value:m.value,at:m.at};live.current={...live.current};}}
   if(m.type==='error')live.current={...live.current,error:m.message};
   if(m.type==='control'){let result,error;try{if(!live.current.active)throw Error('Audio session is not active');result=await control(m.command);}catch(e){error=String(e);}if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'result',id:m.id,result,error}));}
  }catch(e){live.current={...live.current,error:String(e)};}};
  ws.onclose=()=>{live.current={connected:false,active:false,connectors:[],error:'Disconnected; reconnecting…'};if(!cancelled)timer=setTimeout(connect,1500);};ws.onerror=()=>ws.close();
 }catch(e){live.current={connected:false,active:false,connectors:[],error:String(e)};if(!cancelled)timer=setTimeout(connect,2000);}};void connect();const render=setInterval(()=>setView(live.current),100);return()=>{cancelled=true;clearTimeout(timer);clearInterval(render);socket.current?.close();};},[]);
 const send=(message:unknown)=>{if(socket.current?.readyState===WebSocket.OPEN)socket.current.send(JSON.stringify(message));};
 return {...view,config,live,claim:()=>send({type:'claim'}),subscribe:(connectorId:string,uid:string,channel:number)=>send({type:'subscribe',connectorId,uid,channel})};
}
