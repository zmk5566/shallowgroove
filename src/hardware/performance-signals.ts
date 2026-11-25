import {oscSignalKey} from '../model/performance.ts';
import type {Connector} from './useHexblocks';

export type OscArgument=number|string|boolean|null;
export type OscMessage={endpointId?:string;address:string;args:OscArgument[];time:number;types?:string};
export type OscEndpoint={id:string;name:string;enabled:boolean;host:string;port:number};
export type OscSettings={endpoints:OscEndpoint[];interfaces?:{name:string;address:string}[]};
export type OscChange={op:'put';endpoint:OscEndpoint}|{op:'remove';id:string};
export interface OscBridge {
 status():Promise<OscSettings>;
 configure(change:OscChange):Promise<OscSettings>;
 onMessages(fn:(messages:OscMessage[])=>void):()=>void;
}
export type SignalRow={id:string;kind:'osc'|'sensor';endpointId?:string;name:string;time:number;args:OscArgument[];types?:string;history:number[];uid?:string;channel?:number};
type Snapshot={osc:OscSettings;available:boolean;rows:SignalRow[]};
const capacity=128;
export class PerformanceSignals {
 private bridge:OscBridge|undefined;
 private rows=new Map<string,SignalRow>();
 private listeners=new Set<()=>void>();
 private settingsListeners=new Set<()=>void>();
 private initialized=false;
 private sensorSubscriptions=new Map<string,number>();
 private current:Snapshot;
 private changed=true;
 readonly oscValues=new Map<string,readonly OscArgument[]>();
 constructor(bridge?:OscBridge){
  this.bridge=bridge;
  this.current={osc:{endpoints:[]},available:!!bridge,rows:[]};
 }
 snapshot=()=>this.current;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};};
 subscribeSettings=(fn:()=>void)=>{this.settingsListeners.add(fn);return ()=>{this.settingsListeners.delete(fn);};};
 async initialize(){
  if(!this.bridge)return;
  const status=await this.bridge.status();
  if(!Array.isArray(status?.endpoints)){
   this.bridge=undefined;this.current={...this.current,available:false};
   this.settings({endpoints:[]});
   throw Error('请保存工程并重启 Electron 以载入新版 OSC 接口。 / Save and restart Electron to load the current OSC interface.');
  }
  this.settings(status);
 }
 async configure(change:OscChange){
  if(!this.bridge)throw Error('OSC requires the desktop application');
  this.settings(await this.bridge.configure(change));
 }
 private settings(osc:OscSettings){
  for(const [id,row] of this.rows){
   if(row.kind!=='osc')continue;
   const before=this.current.osc.endpoints.find(e=>e.id===row.endpointId);
   const after=osc.endpoints.find(e=>e.id===row.endpointId);
   if(after?.enabled&&(!before||(before.host===after.host&&before.port===after.port)))continue;
   this.rows.delete(id);
   this.oscValues.delete(oscSignalKey(row.endpointId,row.name));
  }
  this.current={...this.current,osc};this.initialized=true;this.changed=true;this.publish();
  for(const fn of this.settingsListeners)fn();
 }
 private record(row:Omit<SignalRow,'history'>){
  const previous=this.rows.get(row.id),sample=row.args.find((v):v is number=>typeof v==='number');
  const history=previous?.history??[];
  this.rows.delete(row.id);
  this.rows.set(row.id,{...row,history:sample===undefined?history:[...history.slice(-47),sample]});
  if(this.rows.size>capacity){
   const oldest=this.rows.values().next().value!;
   this.rows.delete(oldest.id);
   if(oldest.kind==='osc')this.oscValues.delete(oscSignalKey(oldest.endpointId,oldest.name));
  }
  this.changed=true;
 }
 receive(msg:OscMessage){
  const endpointId=msg.endpointId??'default';
  if(this.initialized&&!this.current.osc.endpoints.some(e=>e.id===endpointId&&e.enabled))return false;
  const key=oscSignalKey(endpointId,msg.address);
  this.record({id:'osc:'+key,kind:'osc',endpointId,name:msg.address,time:msg.time,args:msg.args,types:msg.types});
  this.oscValues.set(key,msg.args);return true;
 }
 sensors(connectors:Connector[],subscribe:(id:string,uid:string,channel:number)=>void){
  const live=new Set<string>(),now=Date.now();
  for(const c of connectors)if(c.transport.connected)for(const module of c.modules){
   for(const channel of new Set([...(module.descriptor?.channels??[]).map(d=>d.id),...Object.keys(module.channels).map(Number)])){
    const id=JSON.stringify([c.id,module.uid,channel]);live.add(id);
    const sample=module.channels[channel];
    if(this.listeners.size&&(!this.sensorSubscriptions.has(id)||(!sample&&now-this.sensorSubscriptions.get(id)!>2000))){
     subscribe(c.id,module.uid,channel);this.sensorSubscriptions.set(id,now);
    }
    if(!sample||this.rows.get(id)?.time===sample.at)continue;
    this.record({id,kind:'sensor',name:(module.name??module.uid)+' / '+(module.descriptor?.channels?.find(d=>d.id===channel)?.label??channel),uid:module.uid,channel,time:sample.at,args:[sample.value]});
   }
  }
  for(const id of this.sensorSubscriptions.keys())if(!live.has(id))this.sensorSubscriptions.delete(id);
  for(const [id,row] of this.rows)if(row.kind==='sensor'&&!live.has(id)){this.rows.delete(id);this.changed=true;}
 }
 publish(){
  if(!this.changed)return;
  this.changed=false;this.current={...this.current,rows:[...this.rows.values()].reverse()};
  for(const fn of this.listeners)fn();
 }
}
