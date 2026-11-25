import {useId,useState,useSyncExternalStore} from 'react';
import type {PerformanceSignals,OscEndpoint,SignalRow} from '../hardware/performance-signals';
import type {PerformanceNode} from '../model/performance.ts';

type OscNode=Extract<PerformanceNode,{kind:'osc-input'}>;
type Text=(english:string,chinese:string)=>string;
type AddNode=(node:PerformanceNode)=>void;

function useEndpoints(signals:PerformanceSignals){
  return useSyncExternalStore(signals.subscribeSettings,()=>signals.snapshot().osc.endpoints);
}
export function OscEndpointName({signals,id,t}:{signals:PerformanceSignals;id?:string;t:Text}){
  const key=id??'default',endpoint=useEndpoints(signals).find(item=>item.id===key);
  return <span>{endpoint?.name??(key+' · '+t('Offline','离线'))}</span>;
}
function newListener(endpoints:OscEndpoint[]):OscEndpoint{
  let port=9000;
  while(endpoints.some(e=>e.port===port)&&port<65535)port++;
  return {id:crypto.randomUUID(),name:'',host:'127.0.0.1',port,enabled:false};
}
export function OscBinding({node,signals,onSave,onCancel,t}:{node:OscNode;signals:PerformanceSignals;onSave:(node:OscNode)=>void;onCancel?:()=>void;t:Text}){
  const endpoints=useEndpoints(signals),original=node.endpointId??'default';
  const [chosen,setEndpoint]=useState<string|null>(onCancel?null:original);
  const endpointId=chosen??(endpoints.length===1?endpoints[0].id:'');
  const [draft,setDraft]=useState<OscEndpoint|null>(null);
  const {available,osc}=signals.snapshot();
  const [address,setAddress]=useState(node.address),[argument,setArgument]=useState(node.argument);
  return <><form className="perf-editor perf-osc-binding" onSubmit={e=>{
    e.preventDefault();const next=address.trim();
    if(!endpointId||!next.startsWith('/')||/\s/.test(next)||!Number.isSafeInteger(argument)||argument<0)return;
    onSave({...node,endpointId,address:next,argument,name:next});
  }}>
    <label>{t('OSC listener','OSC 监听端点')}<select aria-label={t('OSC listener','OSC 监听端点')} value={endpointId} disabled={!endpointId&&!endpoints.length} required onChange={e=>setEndpoint(e.target.value)}>
      {!endpointId&&<option value="">{endpoints.length?t('Choose a listener','选择监听端点'):t('No listeners yet','尚无监听端点')}</option>}
      {endpointId&&!endpoints.some(e=>e.id===endpointId)&&<option value={endpointId}>{endpointId} · {t('Offline','离线')}</option>}
      {endpoints.map(e=><option key={e.id} value={e.id}>{e.name} · {e.host}:{e.port}</option>)}</select></label>
    {available?<button type="button" disabled={!!draft} onClick={()=>setDraft(newListener(endpoints))}>{t('+ New listener','＋ 新建监听端点')}</button>:
      <small className="perf-osc-guide">{t('Open the current Electron desktop app to configure OSC listeners.','请在新版 Electron 桌面应用里配置 OSC 监听端点。')}</small>}
    <label>{t('OSC address','OSC 地址')}<input aria-label={t('OSC address','OSC 地址')} placeholder="/controller/1" value={address}
      required maxLength={300} pattern="/[^\s]*" onChange={e=>setAddress(e.target.value)}/></label>
    {node.output==='value'&&<label>{t('Argument index (0-based)','参数索引（从 0 开始）')}<input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1}
      required value={Number.isNaN(argument)?'':argument} onChange={e=>setArgument(e.target.valueAsNumber)}/></label>}
    <div className="perf-actions">{onCancel&&<button type="button" onClick={onCancel}>{t('Cancel','取消')}</button>}
      <button className="perf-primary" disabled={!endpointId||!!draft}>{onCancel?t('Add OSC node','添加 OSC 节点'):t('Apply','应用')}</button></div>
  </form>
    {draft&&<EndpointForm initial={draft} interfaces={osc.interfaces??[]} t={t} startOnSave
      onCancel={()=>setDraft(null)} onSave={async endpoint=>{
        await signals.configure({op:'put',endpoint:{...endpoint,enabled:true}});
        setEndpoint(endpoint.id);setDraft(null);
      }}/>}</>;
}

function Sparkline({history,label}:{history:number[];label:string}){
  const values=history.slice(-64).filter(Number.isFinite);
  if(!values.length)return null;
  const low=Math.min(...values),high=Math.max(...values);
  const points=values.map((v,i)=>[(64-values.length+i)*2,high===low?10:18-16*(v-low)/(high-low)].join(','));
  return <svg role="img" aria-label={label} viewBox="0 0 128 20" className="perf-spark">
    <polyline points={points.join(' ')}/>{values.length===1&&<circle cx={126} cy={10} r={1.5}/>}</svg>;
}

function Signal({row,t,add}:{row:SignalRow;t:Text;add:AddNode}){
  const [index,choose]=useState(0),isOsc=row.kind==='osc';
  const choices=row.args.flatMap((value,i)=>typeof value==='number'||typeof value==='boolean'?[i]:[]);
  const argument=choices.includes(index)?index:choices[0];
  function addOsc(output:'value'|'trigger'){
    add({id:crypto.randomUUID(),kind:'osc-input',name:row.name,endpointId:row.endpointId??'default',address:row.name,argument:output==='value'?argument:0,output});
  }
  const decoder=row.types??row.args.map(a=>a===null?'null':typeof a).join(', ');
  return <li className="perf-signal">
    <div className="perf-signal-info"><strong title={row.name}>{row.name}</strong>
      <span title={decoder}>{isOsc?'OSC':'HEX'}{decoder?' · '+decoder:''}</span></div>
    <output className="perf-signal-value">{row.args.map(a=>typeof a==='number'?String(Number(a.toPrecision(6))):JSON.stringify(a)).join('  ')||'—'}</output>
    <Sparkline history={row.history} label={t('Recent samples','最近采样')+' · '+row.name}/>
    <div className="perf-signal-actions">{isOsc?<>{choices.length>1&&<select value={argument} aria-label={t('OSC argument','OSC 参数')+' · '+row.name} onChange={e=>choose(Number(e.target.value))}>
      {choices.map(i=><option key={i} value={i}>arg {i}</option>)}</select>}
      {choices.length>0&&<button onClick={()=>addOsc('value')}>{t('+ Value','+ 数值')}</button>}
      <button onClick={()=>addOsc('trigger')}>{t('+ Trigger','+ 触发')}</button></>:
      row.uid!==undefined&&row.channel!==undefined&&<button onClick={()=>add({id:crypto.randomUUID(),kind:'sensor',name:row.name,uid:row.uid,channel:row.channel})}>{t('+ Sensor','+ 传感器')}</button>}</div>
  </li>;
}

type LocalInterface={name:string;address:string};
function EndpointForm({initial,interfaces,t,onSave,onCancel,startOnSave=false}:{startOnSave?:boolean;initial:OscEndpoint;interfaces:LocalInterface[];t:Text;onSave:(endpoint:OscEndpoint)=>Promise<void>;onCancel:()=>void}){
  const [name,setName]=useState(initial.name),[host,setHost]=useState(initial.host),[port,setPort]=useState(String(initial.port));
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const choices=useId();
  return <form className="perf-listener" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setError('');
    try{await onSave({...initial,name:name.trim(),host:host.trim(),port:Number(port)});}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }}>
    <label>{t('Name','名称')}<input autoFocus required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>{t('Local bind IP','本地监听 IP')}<input list={choices} required value={host} onChange={e=>setHost(e.target.value)} placeholder="127.0.0.1"/></label>
    <datalist id={choices}><option value="127.0.0.1">{t('This computer','本机')}</option><option value="0.0.0.0">{t('All local interfaces','所有本机网卡')}</option>
      {interfaces.filter(i=>i.address!=='127.0.0.1'&&i.address!=='0.0.0.0').map(i=><option key={i.name+i.address} value={i.address}>{i.name}</option>)}</datalist>
    <label>{t('UDP port','UDP 端口')}<input required type="number" min={1} max={65535} step={1} value={port} onChange={e=>setPort(e.target.value)}/></label>
    <button disabled={busy||!name.trim()||!host.trim()}>{startOnSave?t('Save and listen','保存并开始监听'):t('Save listener','保存监听端点')}</button>
    <button type="button" disabled={busy} onClick={onCancel}>{t('Cancel','取消')}</button>
    {error&&<span role="alert">{error}</span>}
  </form>;
}

function EndpointGroup({endpoint,signals,interfaces,rows,add,t}:{endpoint:OscEndpoint;signals:PerformanceSignals;interfaces:LocalInterface[];rows:SignalRow[];add:AddNode;t:Text}){
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[removing,setRemoving]=useState(false);
  const destinations=endpoint.host==='0.0.0.0'?[...new Set(interfaces.map(i=>i.address))]:[endpoint.host];
  async function act(remove=false){
    setBusy(true);setError('');
    try{await signals.configure(remove?{op:'remove',id:endpoint.id}:{op:'put',endpoint:{...endpoint,enabled:!endpoint.enabled}});}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <section className="perf-listener-group" data-endpoint-id={endpoint.id}>
    <div className="perf-listener-bar"><strong>{endpoint.name}</strong><code>{t('Bind','监听')} {endpoint.host}:{endpoint.port}</code>
      <small>{endpoint.enabled?t('Listening','正在监听'):t('Stopped','已停止')}</small>
      <button disabled={busy||editing||removing} onClick={()=>void act()}>{endpoint.enabled?t('Stop listener','停止监听'):t('Start listener','开始监听')}</button>
      <button disabled={busy||removing} onClick={()=>setEditing(!editing)}>{t('Edit','编辑')}</button>
      <button disabled={busy||editing||removing} onClick={()=>setRemoving(true)}>{t('Remove','移除')}</button>
    </div>
    <div className="perf-destinations">{t('Send OSC to','OSC 发送目标')} {destinations.length?destinations.map(ip=><code key={ip}>{ip}:{endpoint.port}</code>):t('Local IPv4 address unavailable','本机 IPv4 地址不可用')}</div>
    {error&&<span role="alert">{error}</span>}
    {removing&&<div className="perf-listener-bar"><span>{t('Remove listener','移除监听端点')} {endpoint.name}?</span>
      <button disabled={busy} onClick={()=>void act(true)}>{t('Remove listener','移除监听端点')}</button><button disabled={busy} onClick={()=>setRemoving(false)}>{t('Cancel','取消')}</button></div>}
    {editing&&<EndpointForm initial={endpoint} interfaces={interfaces} t={t} onCancel={()=>setEditing(false)} onSave={async updated=>{await signals.configure({op:'put',endpoint:updated});setEditing(false);}}/>}
    {rows.length>0?<ul>{rows.map(row=><Signal key={row.id} row={row} t={t} add={add}/>)}</ul>:
      endpoint.enabled&&<p className="perf-monitor-message">{t('Waiting for OSC messages.','等待 OSC 消息。')}</p>}
  </section>;
}
function SignalList({signals,t,add}:{signals:PerformanceSignals;t:Text;add:AddNode}){
  const {osc,available,rows}=useSyncExternalStore(signals.subscribe,signals.snapshot);
  const [draft,setDraft]=useState<OscEndpoint|null>(null);
  const sensors=rows.filter(r=>r.kind==='sensor');
  return <div className="perf-monitor-body">
    <div className="perf-monitor-heading"><strong>{t('OSC listeners','OSC 监听端点')}</strong>{available&&<button disabled={!!draft} onClick={()=>setDraft(newListener(osc.endpoints))}>{t('Add listener','添加监听端点')}</button>}</div>
    {draft&&<EndpointForm initial={draft} interfaces={osc.interfaces??[]} t={t} onCancel={()=>setDraft(null)} onSave={async endpoint=>{await signals.configure({op:'put',endpoint});setDraft(null);}}/>}
    {available?osc.endpoints.map(endpoint=><EndpointGroup key={endpoint.id} endpoint={endpoint} signals={signals} interfaces={osc.interfaces??[]} t={t} add={add}
      rows={rows.filter(r=>r.kind==='osc'&&(r.endpointId??'default')===endpoint.id)}/>):<p className="perf-monitor-message">{t('OSC UDP reception is available in the desktop app.','桌面应用支持接收 OSC UDP。')}</p>}
    <div className="perf-monitor-heading"><strong>{t('Hex sensors','Hex 传感器')}</strong></div>
    {sensors.length?<ul>{sensors.map(row=><Signal key={row.id} row={row} t={t} add={add}/>)}</ul>:
      <p className="perf-monitor-message">{t('Waiting for sensor input.','等待传感器输入。')}</p>}
  </div>;
}
export function SignalMonitor(props:{signals:PerformanceSignals;t:Text;add:AddNode}){
  const [open,setOpen]=useState(false),id=useId();
  return <section className="perf-monitor"><button className="perf-monitor-toggle" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>
    <span aria-hidden="true">{open?'▾':'▸'}</span> {props.t('Input monitor','输入监视器')}</button>
    {open&&<div id={id}><SignalList {...props}/></div>}</section>;
}
