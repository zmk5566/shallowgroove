import {useLayoutEffect,useRef,useState,type PointerEvent,type ReactNode} from 'react';
import {canRoutePerformance,defaultPerformancePosition,isPerformanceNumericSource,isPerformanceUnitSource,retriggerDivisions,type PerformanceEdit,type PerformanceGraph,type PerformanceLink,type PerformanceNode,type PerformanceRoute} from '../model/performance.ts';
import {OscBinding,OscEndpointName,SignalMonitor} from './SignalMonitor';
import type {PerformanceSignals} from '../hardware/performance-signals';
import {PerformanceNodePicker,type NodeGroup} from './PerformanceNodePicker';
import './performance-view.css';

type Parameter={address:string;label:string;min:number;max:number;value:number;step?:number};
type Device={trackId:string;device:string;name:string;parameters:Parameter[]};
type SensorRef={uid:string;channel:number;name:string;moduleName?:string;messageName?:string};
const sensorKey=(uid:string,channel:number)=>JSON.stringify([uid,channel]);
type Mode='graph'|'stack';
type Point={x:number;y:number};
type Visual={mode:Mode;selectedNode:string|null;viewport:Point & {width:number;height:number}};
type Props={
  signals:PerformanceSignals;graph:PerformanceGraph; zh:boolean; devices:Device[];
  sensors:SensorRef[]; savedSensors?:{uid:string;channel:number}[]; values:Record<string,number>;
  onEdit:(edit:PerformanceEdit)=>void; onInput:(id:string,value:number)=>void;
  midiInputs:{id:string;name:string;enabled:boolean}[]; onRefreshMidi:()=>void; onEnableMidi:(id:string)=>void;
  onParameter:(trackId:string,device:string,address:string,value:number)=>void; onTrigger:(id:string)=>void;
  onSelectEffect:(trackId:string,device:string)=>void;
  onOpenEffect:(trackId:string,device:string)=>void;
  onVisualContext?:(context:Visual)=>void; initialVisual?:Point & {mode:Mode;selectedNode:string|null};
};
const width=192,portY=62,firstParameterY=62,parameterStep=24;
type RouteInput=PerformanceRoute['input'];
type OutputPort={node:string;kind:'output';rise?:boolean};
type Port=OutputPort|{node:string;kind:'parameter';address:string}|{node:string;kind:'route';input:RouteInput};
type Wire=PerformanceLink|PerformanceRoute;
const samePort=(a:Port|undefined,b:Port)=>a?.node===b.node&&a.kind===b.kind&&
  ((b.kind==='output'&&a.kind==='output'&&!!a.rise===!!b.rise)||(a.kind==='parameter'&&b.kind==='parameter'&&a.address===b.address)||(a.kind==='route'&&b.kind==='route'&&a.input===b.input));
type Cable={from:Port;start:Point;origin:Point;point:Point;pointerId:number;moved:boolean;hover?:Port};
function curve(a:Point,b:Point){
  const bend=Math.max(40,Math.abs(b.x-a.x)/2);
  return `M ${a.x} ${a.y} C ${a.x+bend} ${a.y}, ${b.x-bend} ${b.y}, ${b.x} ${b.y}`;
}
const fmt=(v:number)=>Number(v.toFixed(3));
const id=()=>crypto.randomUUID();

function LinkEditor({link,params,zh,onEdit,close,direct}:{direct:boolean;link:PerformanceLink;params:Parameter[];zh:boolean;onEdit:Props['onEdit'];close:()=>void}){
  const [draft,set]=useState(link);
  const [error,setError]=useState('');
  const t=(en:string,cn:string)=>zh?cn:en;
  const update=(v:Partial<PerformanceLink>)=>{set({...draft,...v});setError('');};
  return <form className="perf-editor" onSubmit={e=>{
    e.preventDefault();
    if(!(draft.min<draft.max)){setError(t('Start must be lower than end.','起点必须小于终点。'));return;}
    if(draft.scale==='log'&&(draft.min<=0||draft.max<=0)){setError(t('Logarithmic endpoints must be positive.','对数映射的两个端点都必须大于零。'));return;}
    onEdit({op:'put_link',link:draft});close();
  }}>
    <div className="perf-heading"><strong>{t('Edit mapping','编辑映射')}</strong><button type="button" onClick={close} aria-label={t('Close','关闭')}>×</button></div>
    <label>{t('Parameter','参数')}<select value={draft.address} onChange={e=>{
      const p=params.find(p=>p.address===e.target.value);if(p)update({address:p.address,min:p.min,max:p.max});
    }}>{!params.some(p=>p.address===draft.address)&&<option value={draft.address}>{draft.address}</option>}
    {params.map(p=><option key={p.address} value={p.address}>{p.label}</option>)}</select></label>
    {!direct&&<div className="perf-pair">{(['min','max'] as const).map((k,i)=><label key={k}>{i?t('End','终点'):t('Start','起点')}
      <input key={draft.address} type="number" step="any" required defaultValue={draft[k]} onChange={e=>update({[k]:e.target.valueAsNumber})}/>
    </label>)}</div>}
    <label>{t('Smoothing (ms)','平滑时间（毫秒）')}<input type="number" min={0} step="any" required defaultValue={draft.smoothMs} onChange={e=>update({smoothMs:e.target.valueAsNumber})}/></label>
    {!direct&&<label>{t('Curve','曲线')}<select value={draft.scale} onChange={e=>update({scale:e.target.value as PerformanceLink['scale']})}><option value="linear">{t('Linear','线性')}</option><option value="log">{t('Logarithmic','对数')}</option></select></label>}
    {error&&<p role="alert">{error}</p>}
    <div className="perf-actions"><button type="button" onClick={()=>{onEdit({op:'remove_link',id:link.id});close();}}>{t('Disconnect','断开连接')}</button><button className="perf-primary">{t('Apply','应用')}</button></div>
  </form>;
}

type NumberSettingProps={
  label:string;value:number|undefined;inline?:boolean;min?:number;max?:number;step?:number|'any';
  accept?:(value:number)=>boolean;onCommit:(value:number)=>void;
};
function NumberSetting({label,value,inline=false,min,max,step='any',accept,onCommit}:NumberSettingProps){
  const field=<input key={value} aria-label={label} data-manual={inline||undefined} type="number" min={min} max={max} step={step} defaultValue={value??''} placeholder={value===undefined?'—':undefined}
    onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} onBlur={e=>{
      const field=e.currentTarget,next=field.valueAsNumber;
      if(!Number.isFinite(next)||!field.validity.valid||(accept&&!accept(next))){field.value=value===undefined?'':String(value);return;}
      if(next!==value)onCommit(next);
    }}/>;
  return inline?field:<label>{label}{field}</label>;
}
const pitches=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
function scaleNames(t:(en:string,cn:string)=>string){
  return {major:t('Major','大调'),minor:t('Minor','小调'),'major-pentatonic':t('Major pentatonic','大调五声音阶'),'minor-pentatonic':t('Minor pentatonic','小调五声音阶'),chromatic:t('Chromatic','半音阶')};
}
function sensorInventory(sensors:SensorRef[],saved:Props['savedSensors'],graph:PerformanceGraph){
  const refs=new Map<string,SensorRef>();
  for(const ref of saved??[])refs.set(sensorKey(ref.uid,ref.channel),{...ref,name:'HexBlocks'});
  for(const n of graph.nodes)if(n.kind==='sensor'&&n.uid&&n.channel!==undefined)
    refs.set(sensorKey(n.uid,n.channel),{uid:n.uid,channel:n.channel,name:n.name});
  const live=new Set<string>();
  for(const sensor of sensors){
    const key=sensorKey(sensor.uid,sensor.channel);
    refs.set(key,sensor);live.add(key);
  }
  const devices=new Map<string,{key:string;name:string;items:{key:string;name:string}[]}>();
  for(const [key,ref] of refs){
    let device=devices.get(ref.uid);
    if(!device){
      const label=ref.moduleName??(ref.name.includes(' / ')?ref.name.split(' / ')[0]:ref.uid);
      device={key:ref.uid,name:label===ref.uid?ref.uid:label+' · '+ref.uid,items:[]};devices.set(ref.uid,device);
    }
    device.items.push({key,name:(ref.messageName??(ref.name.includes(' / ')?ref.name.split(' / ').at(-1):'CH '+ref.channel))+' · '+ref.channel});
  }
  return {refs,live,devices:[...devices.values()]};
}
function SensorBinding({node,inventory,zh,onEdit}:{node:PerformanceNode;inventory:ReturnType<typeof sensorInventory>;zh:boolean;onEdit:Props['onEdit']}){
  const {refs,live,devices}=inventory;
  const value=node.uid&&node.channel!==undefined?sensorKey(node.uid,node.channel):'';
  return <div className="perf-editor perf-settings"><label>{zh?'HexBlocks 输入引用':'HexBlocks input reference'}
    <select value={value} disabled={!refs.size} onChange={e=>{
      const ref=refs.get(e.target.value);if(!ref)return;
      onEdit({op:'put_node',node:{...node,uid:ref.uid,channel:ref.channel,name:ref.name}});
    }}>
      <option value="" disabled>{zh?'未绑定':'Unassigned'}</option>
      {devices.map(device=><optgroup key={device.key} label={device.name}>{device.items.map(({key,name})=><option key={key} value={key}>{name}{live.has(key)?'':zh?'（离线）':' (offline)'}</option>)}</optgroup>)}
    </select></label>{!refs.size&&<small>{zh?'连接 HexBlocks 后即可选择模块通道。':'Connect HexBlocks to choose a module channel.'}</small>}</div>;
}

function NodeSettings({node,signals,zh,midiInputs,onEnableMidi,onEdit,directPitch}:Pick<Props,'signals'|'zh'|'midiInputs'|'onEnableMidi'|'onEdit'>&{node:PerformanceNode;directPitch:boolean}){
  const t=(en:string,cn:string)=>zh?cn:en;
  const change=(updated:PerformanceNode)=>onEdit({op:'put_node',node:updated});
  if(node.kind==='osc-input')return <OscBinding signals={signals} key={JSON.stringify([node.id,node.endpointId,node.address,node.argument])} node={node} t={t} onSave={change}/>;
  if(node.kind==='scale')return <div className="perf-editor perf-settings"><label>{t('Root','主音')}<select aria-label={t('Root','主音')} value={node.root} onChange={e=>change({...node,root:Number(e.target.value)})}>
    {pitches.map((n,i)=><option key={n} value={i}>{n}</option>)}</select></label>
    <label>{t('Scale','音阶')}<select aria-label={t('Scale','音阶')} value={node.scale} onChange={e=>change({...node,scale:e.target.value as typeof node.scale})}>
    {Object.entries(scaleNames(t)).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>;
  if(node.kind==='midi-input'||node.kind==='midi-control')return <div className="perf-editor perf-settings"><label>{t('MIDI device','MIDI 设备')}
    <select aria-label={t('MIDI device','MIDI 设备')} value={node.midiDeviceId} onChange={e=>{const m=midiInputs.find(m=>m.id===e.target.value);if(m)change({...node,midiDeviceId:m.id,name:m.name});}}>
      {!midiInputs.some(m=>m.id===node.midiDeviceId)&&<option value={node.midiDeviceId}>{node.name}{t(' (disconnected)','（已断开）')}</option>}
      {midiInputs.map(m=><option key={m.id} value={m.id}>{m.name}{m.enabled?'':t(' (disabled)','（已停用）')}</option>)}</select></label>
      {node.kind==='midi-control'&&<><label>{t('Message','消息')}<select aria-label={t('Message','消息')} value={node.message}
        onChange={e=>change({...node,message:e.target.value as typeof node.message,controller:node.controller??1})}>
        <option value="cc">CC</option><option value="bend">{t('Pitch bend','弯音')}</option><option value="pressure">{t('Channel pressure','通道压力')}</option></select></label>
        <label>{t('Channel','通道')}<select aria-label={t('Channel','通道')} value={node.channel??0} onChange={e=>change({...node,channel:Number(e.target.value)})}>
        <option value={0}>{t('Omni','全部通道')}</option>{Array.from({length:16},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label>
        {node.message==='cc'&&<NumberSetting label={t('CC number','CC 编号')} value={node.controller??1} min={0} max={127} step={1} onCommit={v=>change({...node,controller:v})}/>}</>}
      {midiInputs.some(m=>m.id===node.midiDeviceId&&!m.enabled)&&<button onClick={()=>onEnableMidi(node.midiDeviceId)}>{t('Enable MIDI input','启用 MIDI 输入')}</button>}</div>;
  if(node.kind!=='note'||directPitch)return null;
  return <div className="perf-editor perf-settings">
    <NumberSetting label={t('Pitch input minimum','输入音高下限')} value={node.pitchMin??0} min={0} max={node.pitchMax??127} step={1} onCommit={v=>change({...node,pitchMin:v})}/>
    <NumberSetting label={t('Pitch input maximum','输入音高上限')} value={node.pitchMax??127} min={node.pitchMin??0} max={127} step={1} onCommit={v=>change({...node,pitchMax:v})}/>
  </div>;
}

export function PerformanceView({signals,graph,zh,devices,sensors,savedSensors,values,midiInputs,onRefreshMidi,onEnableMidi,onEdit,onInput,onParameter,onTrigger,onSelectEffect,onOpenEffect,onVisualContext,initialVisual}:Props){
  const [picker,setPicker]=useState<{anchor:Point;position:Point}|null>(null);
  const oscPosition=useRef<Point|undefined>(undefined);
  const [oscDraft,setOscDraft]=useState<Extract<PerformanceNode,{kind:'osc-input'}>|null>(null);
  const [pending,setPending]=useState<OutputPort|null>(null);
  const [cable,setCable]=useState<Cable|null>(null);
  const [selected,setSelected]=useState(initialVisual?.selectedNode??'');
  const [edit,setEdit]=useState('');
  const [mode,setMode]=useState<Mode>(initialVisual?.mode??'graph');
  const [drag,setDrag]=useState<{id:string;pos:Point}|null>(null);
  const origin=useRef<{id:string;pos:Point;pointer:Point}|null>(null);
  const panel=useRef<HTMLElement>(null);
  const view=useRef<HTMLDivElement>(null);
  const initial=useRef(initialVisual);
  const emit=useRef(onVisualContext);
  emit.current=onVisualContext;
  const getNode=(key:string)=>graph.nodes.find(n=>n.id===key);
  const selection=getNode(selected);
  const selectedNode=selection?.id??null;
  useLayoutEffect(()=>{
    if(initial.current&&view.current){view.current.scrollTo(initial.current.x,initial.current.y);initial.current=undefined;}
  },[]);
  useLayoutEffect(()=>{
    const el=view.current;if(!el)return;
    const publish=()=>emit.current?.({mode,selectedNode,viewport:{x:el.scrollLeft,y:el.scrollTop,width:el.clientWidth,height:el.clientHeight}});
    publish();const observer=new ResizeObserver(publish);observer.observe(el);
    el.addEventListener('scroll',publish);
    return ()=>{observer.disconnect();el.removeEventListener('scroll',publish);};
  },[mode,selectedNode]);
  const t=(en:string,cn:string)=>zh?cn:en;
  const kind=(k:PerformanceNode['kind'])=>({
    'midi-control':t('MIDI control','MIDI 控制器'),threshold:t('Threshold / Gate','阈值 / 门控'),scale:t('Scale','音阶'),
    knob:t('Virtual knob','虚拟旋钮'),sensor:t('HexBlocks sensor','HexBlocks 传感器'),effect:t('Device','设备'),
    'osc-input':t('OSC input','OSC 输入'),'midi-input':t('MIDI input','MIDI 输入'),note:t('Note','音符'),retrigger:t('Retrigger','重复触发'),remap:t('Remap','数值映射')
  })[k];
  const retriggerName=(free:boolean)=>free?t('Free retrigger','自由重复触发'):t('Quantized retrigger','量化重复触发');
  const routes=graph.routes??[];
  const wires:Wire[]=[...graph.links,...routes];
  const inputLabel=(input:RouteInput)=>({pitch:t('Pitch','音高'),trigger:t('Trigger','触发'),midi:t('MIDI In','MIDI 输入'),
    gate:t('Gate','门控'),low:t('Low','低阈值'),high:t('High','高阈值'),value:t('Value In','数值输入'),velocity:t('Velocity','力度'),lengthMs:t('Length (ms)','时长（毫秒）'),interval:t('Interval','间隔'),enabled:t('Enabled','启用'),
    inMin:t('Input start','输入起点'),inMax:t('Input end','输入终点'),outMin:t('Output start','输出起点'),outMax:t('Output end','输出终点')})[input];
  const outputLabel=(n:PerformanceNode,rise=false)=>n.kind==='threshold'?(rise?t('Rising trigger','上升沿触发'):t('Gate Out','门控输出')):
    n.kind==='scale'?t('Pitch Out','音高输出'):n.kind==='note'||n.kind==='midi-input'?t('MIDI Out','MIDI 输出'):
    (n.kind==='retrigger'||(n.kind==='osc-input'&&n.output==='trigger'))?t('Trigger Out','触发输出'):t('Value Out','数值输出');
  const inputs=(n:PerformanceNode):RouteInput[]=>{
    switch(n.kind){
      case 'note':return ['pitch','velocity','lengthMs','trigger','gate'];
      case 'scale':return ['value'];
      case 'threshold':return ['value','low','high'];
      case 'retrigger':return ['interval','enabled'];
      case 'remap':return ['value','inMin','inMax','outMin','outMax'];
      case 'effect':return n.device==='instrument'?['midi']:[];
      default:return [];
    }
  };
  const getDevice=(n?:PerformanceNode)=>devices.find(d=>n?.trackId===d.trackId&&n?.device===d.device);
  const position=(n:PerformanceNode)=>drag?.id===n.id?drag.pos:graph.layout[n.id]??defaultPerformancePosition;
  const source=pending&&getNode(pending.node), editing=wires.find(l=>l.id===edit);
  const stageW=Math.max(610,...graph.nodes.map(n=>position(n).x+width+32));
  const stageH=Math.max(180,...graph.nodes.map(n=>position(n).y+Math.max(146,110+parameterStep*(inputs(n).length+(getDevice(n)?.parameters.length??0)))));
  const choices=[
    ...devices.map(d=>({k:JSON.stringify(['effect',d.trackId,d.device]),fields:{kind:'effect' as const,trackId:d.trackId,device:d.device,name:d.name}})),
  ];
  const midi=midiInputs.find(m=>m.enabled)??midiInputs[0];
  const item=(key:string,name:string,disabled=false)=>({key,name,disabled});
  const inventory=sensorInventory(sensors,savedSensors,graph);
  const groups:NodeGroup[]=[
    {name:t('Inputs','输入'),items:[item('knob',kind('knob')),
      {key:'midi',name:'MIDI',items:[
        item('midi-input',t('Note input (Note On / Off)','音符输入（Note On / Off）'),!midi),
        item('midi-control',t('Controller input (CC, pitch bend, pressure)','控制器输入（CC、弯音、通道压力）'),!midi)]},
      {key:'osc',name:'OSC',items:[
        item('osc-value',t('Value input','数值输入')),item('osc-trigger',t('Trigger input','触发输入'))]},
      {key:'hexblocks',name:'HexBlocks',disabled:!inventory.devices.length,items:inventory.devices.map(device=>({...device,items:device.items.map(msg=>({...msg,name:msg.name+(inventory.live.has(msg.key)?'':t(' (offline)','（离线）'))}))}))}]},
    {name:t('Value processing','数值处理'),items:[item('remap',kind('remap')),item('threshold',kind('threshold'))]},
    {name:t('Note processing','音符处理'),items:[item('note',kind('note')),item('retrigger',retriggerName(false)),item('retrigger-free',retriggerName(true)),item('scale',kind('scale'))]},
    ...[true,false].map(instrument=>({name:instrument?t('Instruments','乐器'):t('Effects','效果器'),
      items:choices.filter(c=>c.fields.kind==='effect'&&(c.fields.device==='instrument')===instrument).map(c=>item(c.k,c.fields.name))}))
  ];
  function add(n:PerformanceNode,position?:Point){
    onEdit({op:'put_node',node:n,position});setSelected(n.id);setEdit('');setOscDraft(null);
  }
  function openPicker(anchor:Point,click?:Point){
    const el=view.current;if(!el)return;
    const r=el.getBoundingClientRect();
    const x=click?click.x-r.left:el.clientWidth/2-width/2;
    const y=click?click.y-r.top:el.clientHeight/2-portY;
    setPicker({anchor,position:{x:Math.max(0,Math.round(el.scrollLeft+x)),y:Math.max(0,Math.round(el.scrollTop+y))}});
  }
  function choose(choice:string){
    if(!picker)return;
    const position=picker.position,create=(node:PerformanceNode)=>add(node,position);
    setPicker(null);
    const sensor=inventory.refs.get(choice);
    if(sensor){create({id:id(),kind:'sensor',uid:sensor.uid,channel:sensor.channel,name:sensor.name});return;}
    if(choice==='midi-input'&&midi){create({id:id(),kind:'midi-input',midiDeviceId:midi.id,name:midi.name});return;}
    if(choice==='midi-control'&&midi){create({id:id(),kind:'midi-control',midiDeviceId:midi.id,name:midi.name,message:'cc',controller:1,channel:0});return;}
    if(choice==='osc-value'||choice==='osc-trigger'){
      setOscDraft({id:id(),kind:'osc-input',address:'',name:'OSC',argument:0,output:choice==='osc-value'?'value':'trigger'});oscPosition.current=position;return;
    }
    if(choice==='knob'){create({id:id(),kind:'knob',name:t('Virtual knob ','虚拟旋钮 ')+(graph.nodes.filter(n=>n.kind==='knob').length+1),value:0});return;}
    if(choice==='remap'){create({id:id(),kind:'remap',name:kind('remap'),inMin:0,inMax:1,outMin:0,outMax:127,manualValue:0});return;}
    if(choice==='scale'){create({id:id(),kind:'scale',name:kind('scale'),manualValue:60,root:0,scale:'major'});return;}
    if(choice==='threshold'){create({id:id(),kind:'threshold',name:kind('threshold'),manualValue:0,low:0.4,high:0.6});return;}
    if(choice==='note'){create({id:id(),kind:'note',name:kind('note'),pitch:60,velocity:100,lengthMs:180});return;}
    if(choice==='retrigger'||choice==='retrigger-free'){
      const free=choice==='retrigger-free';create({id:id(),kind:'retrigger',name:retriggerName(free),enabled:false,timing:free?'free':'sync',division:1,intervalMs:250});return;
    }
    const c=choices.find(c=>c.k===choice);if(c)create({id:id(),...c.fields});
  }
  function freeParams(target:PerformanceNode,except?:string){
    return (getDevice(target)?.parameters??[]).filter(p=>p.min<p.max&&!graph.links.some(l=>{
      const dest=getNode(l.target);
      return l.id!==except&&dest?.trackId===target.trackId&&dest?.device===target.device&&l.address===p.address;
    }));
  }
  function existingWire(port:Port){
    if(port.kind==='parameter'){
      const target=getNode(port.node);
      return graph.links.find(l=>{
        if(l.address!==port.address)return false;
        const other=getNode(l.target);
        return other?.trackId===target?.trackId&&other?.device===target?.device;
      });
    }
    if(port.kind==='route')return routes.find(r=>r.target===port.node&&r.input===port.input);
  }
  function accepts(output:OutputPort,input:Port){
    const target=getNode(input.node),sender=getNode(output.node);
    if(!target||!sender||input.kind==='output')return false;
    if(sender.kind==='threshold'&&!!output.rise!==(input.kind==='route'&&input.input==='trigger'))return false;
    const control=isPerformanceNumericSource(sender);
    if(input.kind==='parameter')return control&&target.kind==='effect'&&freeParams(target).some(p=>p.address===input.address);
    if(!canRoutePerformance(sender,target,input.input,graph))return false;
    if((input.input==='gate'||input.input==='trigger')&&routes.some(r=>r.target===target.id&&(r.input==='gate'||r.input==='trigger')))return false;
    return !routes.some(r=>r.target===target.id&&r.input===input.input&&(r.input!=='midi'||r.source===output.node));
  }
  function connectPorts(output:OutputPort,input:Port){
    if(!accepts(output,input))return;
    if(input.kind==='parameter'){
      const p=freeParams(getNode(input.node)!).find(p=>p.address===input.address)!;
      onEdit({op:'put_link',link:{id:id(),source:output.node,target:input.node,address:p.address,min:p.min,max:p.max,smoothMs:0,scale:'linear'}});
    }else if(input.kind==='route')onEdit({op:'put_route',route:{id:id(),source:output.node,target:input.node,input:input.input}});
    setSelected(input.node);setEdit('');
  }
  function activate(port:Port){
    if(port.kind==='output'){setPending(samePort(pending??undefined,port)?null:port);setSelected(port.node);setEdit('');return;}
    if(pending&&accepts(pending,port))connectPorts(pending,port);
    else {setSelected(port.node);setEdit(existingWire(port)?.id??'');}
    setPending(null);
  }
  function dropTarget(from:Port,x:number,y:number){
    const el=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-perf-port]');
    if(!el||!view.current?.contains(el))return;
    const node=el.dataset.perfPort!;
    const port:Port=el.dataset.address!==undefined?{node,kind:'parameter',address:el.dataset.address}:
      el.dataset.input?{node,kind:'route',input:el.dataset.input as RouteInput}:{node,kind:'output',rise:el.dataset.output==='rise'};
    if((from.kind==='output')===(port.kind==='output'))return;
    const input=from.kind==='output'?port:from,output=from.kind==='output'?from:port;
    if(output.kind!=='output'||!accepts(output,input))return;
    const r=el.getBoundingClientRect();
    return {port,point:{x:port.kind==='output'?r.left+r.width/2:r.left,y:r.top+r.height/2}};
  }
  function selectWire(link:Wire){
    setEdit(link.id);setSelected(link.target);panel.current?.focus({preventScroll:true});
  }
  function portEvents(port:Port){
    return {
      onPointerDown(e:PointerEvent<HTMLButtonElement>){
        if(e.button!==0||!e.isPrimary)return;
        e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
        const rect=e.currentTarget.getBoundingClientRect(),input=port.kind!=='output';
        const start={x:input?rect.left:rect.left+rect.width/2,y:rect.top+rect.height/2};
        const point={x:e.clientX,y:e.clientY};
        setCable({from:port,start,point,origin:point,pointerId:e.pointerId,moved:false});
      },
      onPointerMove(e:PointerEvent<HTMLButtonElement>){
        if(!cable||e.pointerId!==cable.pointerId)return;
        const moved=cable.moved||Math.hypot(e.clientX-cable.origin.x,e.clientY-cable.origin.y)>=3;
        const target=moved?dropTarget(port,e.clientX,e.clientY):undefined;
        setCable({...cable,hover:target?.port,point:target?.point??{x:e.clientX,y:e.clientY},moved});
      },
      onPointerUp(e:PointerEvent<HTMLButtonElement>){
        if(!cable||e.pointerId!==cable.pointerId)return;
        if(cable.moved){
          const other=dropTarget(port,e.clientX,e.clientY)?.port;
          if(other){if(port.kind==='output')connectPorts(port,other);else if(other.kind==='output')connectPorts(other,port);}
          setPending(null);
        }else activate(port);
        setCable(null);
      },
      onLostPointerCapture(){setCable(null);},
      onClick(e:React.MouseEvent<HTMLButtonElement>){e.stopPropagation();if(e.detail===0)activate(port);}
    };
  }
  function manual(n:PerformanceNode,input:RouteInput){
    const label=inputLabel(input),change=(node:PerformanceNode)=>onEdit({op:'put_node',node});
    if(n.kind==='scale'&&input==='value')return <NumberSetting inline label={label} value={n.manualValue} onCommit={v=>change({...n,manualValue:v})}/>;
    if(n.kind==='threshold'&&(input==='value'||input==='low'||input==='high')){
      const field=input==='value'?'manualValue':input;
      return <NumberSetting inline label={label} value={n[field]} accept={v=>input==='low'?v<n.high:input==='high'?v>n.low:true} onCommit={v=>change({...n,[field]:v})}/>;
    }
    if(n.kind==='note'){
      if(input==='trigger'&&!routes.some(r=>r.target===n.id&&r.input==='gate'))return <button data-manual onClick={()=>onTrigger(n.id)}>{t('Trigger once','触发一次')}</button>;
      if(input==='pitch'||input==='velocity'||input==='lengthMs')return <NumberSetting inline label={label} value={n[input]}
        min={input==='velocity'?1:0} max={input==='lengthMs'?undefined:127} step={input==='lengthMs'?'any':1}
        accept={v=>input!=='lengthMs'||v>0} onCommit={v=>change({...n,[input]:v})}/>;
    }
    if(n.kind==='remap'){
      if(input==='value')return <NumberSetting inline label={label} value={n.manualValue} onCommit={v=>change({...n,manualValue:v})}/>;
      if(input==='inMin'||input==='inMax'||input==='outMin'||input==='outMax')return <NumberSetting inline label={label} value={n[input]}
        accept={v=>input==='inMin'?v!==n.inMax:input==='inMax'?v!==n.inMin:true} onCommit={v=>change({...n,[input]:v})}/>;
    }
    if(n.kind==='retrigger'){
      if(input==='enabled')return <button data-manual aria-pressed={n.enabled} onClick={()=>change({...n,enabled:!n.enabled})}>
        {n.enabled?t('Stop','停止'):t('Start','启动')}</button>;

    }
    return null;
  }
  function intervalSlider(node:Extract<PerformanceNode,{kind:'retrigger'}>,wire:Wire|undefined){
    const free=node.timing==='free';
    const value=wire?values[wire.id]:(free?node.intervalMs??250:node.division);
    const divisions=[...retriggerDivisions].reverse();
    if(!free&&value!==undefined&&!divisions.some(d=>d.beats===value)){
      divisions.push({label:fmt(value)+' '+t('beats','拍'),beats:value});
      divisions.sort((a,b)=>b.beats-a.beats);
    }
    // Four decades, from 10 seconds on the left to 1 ms on the right.
    const position=free?1000-250*Math.log10(value??1):divisions.findIndex(d=>d.beats===value);
    const display=value===undefined?'—':free?fmt(value)+' ms':divisions[position].label;
    const label=free?t('Interval (ms)','间隔（毫秒）'):t('Note division','音符时值');
    return <div className="perf-interval">
      <input type="range" aria-label={label} aria-valuetext={display} min={0} max={free?1000:divisions.length-1}
        step={1} disabled={!!wire} data-unavailable={value===undefined||undefined} value={Math.max(0,Math.round(position))}
        onChange={e=>{
          const pos=e.currentTarget.valueAsNumber;
          onInput(node.id,free?Math.round(10**((1000-pos)/250)*100)/100:divisions[pos].beats);
        }}/>
      {wire?<button className="perf-interval-source" title={(getNode(wire.source)?.name??wire.source)+' · '+display}
        onClick={e=>{e.stopPropagation();selectWire(wire);}}>{display}</button>:
        free?<NumberSetting inline label={label} value={value} accept={v=>v>0} onCommit={v=>onInput(node.id,v)}/>:<output>{display}</output>}
    </div>;
  }
  function wireValue(wire:Wire,reading?:string|number){
    const source=getNode(wire.source)?.name??wire.source,display=typeof reading==='number'?fmt(reading):reading;
    return <button className="perf-driven" title={source+(display==null?'':' · '+display)} onClick={e=>{e.stopPropagation();selectWire(wire);}}>
      <span>{source}</span>{display!=null&&<output>{display}</output>}</button>;
  }
  function driven(n:PerformanceNode,input:RouteInput,wire:Wire){
    let reading:string|number|undefined=values[wire.id];
    if(n.kind==='retrigger'&&input==='enabled'){
      if(reading!==undefined)reading=reading>=0.5?t('On','开'):t('Off','关');
    }else if(input==='pitch')reading??=values[n.id];
    return wireValue(wire,reading);
  }
  function inputRow(port:Exclude<Port,{kind:'output'}>,label:string,wire:Wire|undefined,content:ReactNode){
    const key=port.kind==='route'?port.input:port.address;
    return <div key={key} className="perf-input-row">
      <button className="perf-parameter-input" data-perf-port={port.node} data-input={port.kind==='route'?port.input:undefined}
        data-address={port.kind==='parameter'?port.address:undefined} aria-label={t('Connect input: ','连接输入：')+label}
        title={label} data-connected={!!wire} data-drop-target={samePort(cable?.hover,port)||undefined} {...portEvents(port)}>
        <span>{label}</span></button>{content}
    </div>;
  }
  function endDrag(e:PointerEvent<HTMLButtonElement>){
    const start=origin.current;
    if(start&&e.type!=='pointercancel'&&(e.clientX!==start.pointer.x||e.clientY!==start.pointer.y)){
      onEdit({op:'move_node',id:start.id,x:Math.max(0,start.pos.x+e.clientX-start.pointer.x),y:Math.max(0,start.pos.y+e.clientY-start.pointer.y)});
    }
    origin.current=null;setDrag(null);
  }
  function mapping(l:Wire){
    if('input' in l)return <button key={l.id} className="perf-mapping" onClick={e=>{e.stopPropagation();selectWire(l);}}>
      <span>{getNode(l.source)?.name} → {getNode(l.target)?.name}</span><strong>{inputLabel(l.input)}</strong></button>;
    const dest=getNode(l.target),p=getDevice(dest)?.parameters.find(p=>p.address===l.address);
    const v=values[l.id]??p?.value;
    return <button key={l.id} className="perf-mapping" onClick={e=>{e.stopPropagation();selectWire(l);}}>
      <span>{getNode(l.source)?.name} → {dest?.name}</span><strong>{p?.label??l.address}</strong>
      <small>{isPerformanceUnitSource(getNode(l.source))?(v!=null?fmt(v):''):<>{fmt(l.min)} → {fmt(l.max)}{v!=null&&Number.isFinite(v)?' · '+fmt(v):''}</>}</small></button>;
  }
  return <section ref={panel} tabIndex={-1} className="performance-view" aria-label={t('Performance graph','演奏映射图')} onKeyDown={e=>{
    if((e.key==='Delete'||e.key==='Backspace')&&editing&&!e.nativeEvent.isComposing&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
      if((e.target as Element).closest('input,textarea,select,[contenteditable=true]'))return;
      e.preventDefault();e.stopPropagation();onEdit({op:'input' in editing?'remove_route':'remove_link',id:editing.id});setEdit('');return;
    }
    if(e.key==='Escape'){setPending(null);setEdit('');setCable(null);}}}>
    <div className="perf-toolbar">
      <button aria-label={t('Add to canvas','添加到画布')} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();openPicker({x:r.left,y:r.bottom});}}>＋ {t('Add','添加')}</button>
      {picker&&<PerformanceNodePicker anchor={picker.anchor} groups={groups} zh={zh} onPick={choose} onClose={()=>setPicker(null)}/>}
      <button onClick={onRefreshMidi}>{t('Refresh MIDI','刷新 MIDI')}</button>
      <span className="perf-modes"><button aria-pressed={mode==='graph'} onClick={()=>setMode('graph')}>{t('Graph','节点图')}</button><button aria-pressed={mode==='stack'} onClick={()=>setMode('stack')}>{t('Stack','堆栈')}</button></span>
    </div>
    {oscDraft&&<OscBinding signals={signals} key={oscDraft.id} node={oscDraft} onSave={n=>add(n,oscPosition.current)} onCancel={()=>setOscDraft(null)} t={t}/>}
    <SignalMonitor signals={signals} t={t} add={add}/>
    {source&&<div className="perf-status" role="status">{t('Choose an input for ','请选择目标输入：')}{source.name}<button onClick={()=>setPending(null)}>{t('Cancel','取消')}</button></div>}
    <div className="perf-body"><div className="perf-viewport" ref={view} onContextMenu={e=>{
      if(mode!=='graph'||(e.target as Element).closest('.perf-card,.perf-wire-hit'))return;
      e.preventDefault();const point={x:e.clientX,y:e.clientY};openPicker(point,point);
    }} onClick={e=>{if(e.target===view.current||(e.target as Element).classList.contains('perf-stage'))setEdit('');}}>
      {!graph.nodes.length?<div className="perf-empty">{t('Add a project device to see its parameter inputs.','添加工程设备即可看到它的参数输入端口。')}</div>:
      <div className={'perf-stage'+(mode==='stack'?' perf-stack':'')} style={mode==='stack'?undefined:{width:stageW,height:stageH}}>
        {mode==='graph'&&<svg width={stageW} height={stageH} className="perf-wires" aria-hidden="true">{wires.map(l=>{
          const a=getNode(l.source),b=getNode(l.target);if(!a||!b)return null;
          const typed=inputs(b),parameterIndex='address' in l?getDevice(b)?.parameters.findIndex(p=>p.address===l.address)??-1:-1;
          const index='input' in l?typed.indexOf(l.input):parameterIndex<0?-1:parameterIndex+typed.length;
          if(index<0)return null;
          const start=position(a),end=position(b);
          const path=curve({x:start.x+width,y:start.y+portY+(a.kind==='threshold'&&'input' in l&&l.input==='trigger'?parameterStep:0)},{x:end.x,y:end.y+firstParameterY+(index+(b.kind==='effect'?0:b.kind==='threshold'?2:1))*parameterStep});
          return <g key={l.id} className={edit===l.id?'is-selected':''}><path d={path}/><path d={path} className="perf-wire-hit" onClick={()=>selectWire(l)}/></g>;
        })}</svg>}
        {graph.nodes.map(n=>{
          const pos=position(n),value=n.kind==='knob'?(n.value??0):(values[n.id]??0), device=getDevice(n),effect=n.kind==='effect';
          const links=wires.filter(l=>l.target===n.id||l.source===n.id);
          return <article key={n.id} className={'perf-card perf-'+n.kind+(selected===n.id?' is-selected':'')} style={mode==='stack'?undefined:{left:pos.x,top:pos.y}} onClick={()=>{setSelected(n.id);setEdit('');if(effect&&n.trackId&&n.device)onSelectEffect(n.trackId,n.device);}}>
            <button className="perf-handle" title={t('Select or drag node','选择或拖动节点')} onPointerDown={e=>{
              if(mode==='stack'||e.button!==0)return;
              e.currentTarget.setPointerCapture(e.pointerId);origin.current={id:n.id,pos,pointer:{x:e.clientX,y:e.clientY}};
            }} onPointerMove={e=>{
              const start=origin.current;if(!start||start.id!==n.id)return;
              setDrag({id:n.id,pos:{x:Math.max(0,start.pos.x+e.clientX-start.pointer.x),y:Math.max(0,start.pos.y+e.clientY-start.pointer.y)}});
            }} onPointerUp={endDrag} onPointerCancel={endDrag}><span>{n.kind==='retrigger'?retriggerName(n.timing==='free'):n.kind==='osc-input'?(n.output==='value'?t('OSC Value','OSC 数值'):t('OSC Trigger','OSC 触发')):kind(n.kind)}</span><span aria-hidden="true">⠿</span></button>
            {effect?<div className="perf-device-title"><button className="perf-effect-name" title={n.name}>{n.name}</button>
              <button className="perf-device-open" aria-label={t('Open device editor','打开设备编辑器')} title={t('Open device editor','打开设备编辑器')}
                onClick={e=>{e.stopPropagation();setSelected(n.id);setEdit('');if(n.trackId&&n.device){onSelectEffect(n.trackId,n.device);onOpenEffect(n.trackId,n.device);}}}>↗</button>
            </div>:<strong>{n.name}</strong>}
            {!effect&&(n.kind==='threshold'?[false,true]:[false]).map(rise=>{
              const port:OutputPort={node:n.id,kind:'output',rise},label=outputLabel(n,rise);
              return <div key={String(rise)} className="perf-output-row"><small>{label}{!rise&&['remap','scale','midi-control','threshold'].includes(n.kind)&&values[n.id]!=null?' · '+fmt(values[n.id]):''}</small>
                <button className="perf-port output" data-output={rise?'rise':'main'} data-drop-target={samePort(cable?.hover,port)||undefined}
                  data-perf-port={n.id} aria-label={label+' · '+n.name} title={label} aria-pressed={samePort(pending??undefined,port)} {...portEvents(port)}/></div>;
            })}
            <div className="perf-inputs">{inputs(n).map(input=>{
              const port:Port={node:n.id,kind:'route',input};
              const wire=existingWire(port),label=n.kind==='retrigger'&&input==='interval'&&n.timing==='free'?t('Interval (ms)','间隔（毫秒）'):inputLabel(input);
              return inputRow(port,label,wire,n.kind==='retrigger'&&input==='interval'?intervalSlider(n,wire):wire?driven(n,input,wire):manual(n,input));
            })}{device?.parameters.map(p=>{
              const port:Port={node:n.id,kind:'parameter',address:p.address},wire=existingWire(port);
              return inputRow(port,p.label,wire,wire?wireValue(wire,values[wire.id]??p.value):
                <NumberSetting inline label={p.label} value={p.value} min={p.min} max={p.max} step={p.step&&p.step>0?p.step:'any'}
                  onCommit={v=>onParameter(device.trackId,device.device,p.address,v)}/>);
            })}</div>
            {n.kind==='knob'?<div className="perf-control"><input type="range" aria-label={n.name} min={0} max={1} step={0.001} value={value} onChange={e=>onInput(n.id,e.target.valueAsNumber)}/><output>{fmt(value)}</output></div>:
              n.kind==='sensor'?<div className="perf-control"><meter min={0} max={1} value={value}/><output>{values[n.id]===undefined?'—':fmt(value)}</output></div>:
              n.kind==='osc-input'?<small className="perf-osc-readout" title={n.address}><OscEndpointName signals={signals} id={n.endpointId} t={t}/> · {n.address}{n.output==='value'?' ['+n.argument+'] · '+(values[n.id]!=null?fmt(values[n.id]):'—'):''}</small>:
              (n.kind==='midi-input'||n.kind==='midi-control')?<small className="perf-device-state">{midiInputs.find(m=>m.id===n.midiDeviceId)?.enabled?t('Enabled','已启用'):midiInputs.some(m=>m.id===n.midiDeviceId)?t('Disabled','已停用'):t('Disconnected','已断开')}</small>:null}
            {n.kind==='scale'&&<small>{pitches[n.root]} · {scaleNames(t)[n.scale]}</small>}
            {n.kind==='midi-control'&&<small>{n.message==='cc'?'CC '+(n.controller??1):n.message==='bend'?t('Pitch bend','弯音'):t('Channel pressure','通道压力')} · {n.channel?t('Ch ','通道 ')+n.channel:t('Omni','全部通道')}</small>}
            {effect&&!device&&<small>{t('Unavailable','设备不可用')}</small>}
            <small className="perf-count">{links.length} {t(links.length===1?'mapping':'mappings','条映射')}</small>
            {mode==='stack'&&links.filter(l=>l.source===n.id).map(mapping)}
          </article>;
        })}
      </div>}
    </div><aside className="perf-inspector">
      {editing&&'input' in editing?<div className="perf-editor"><div className="perf-heading"><strong>{inputLabel(editing.input)}</strong><button aria-label={t('Close','关闭')} onClick={()=>setEdit('')}>×</button></div>
        <span>{getNode(editing.source)?.name} → {getNode(editing.target)?.name}</span><button onClick={()=>{onEdit({op:'remove_route',id:editing.id});setEdit('');}}>{t('Disconnect','断开连接')}</button></div>:editing?<LinkEditor key={editing.id} direct={isPerformanceUnitSource(getNode(editing.source))} link={editing} params={freeParams(getNode(editing.target)!,editing.id)} zh={zh} onEdit={onEdit} close={()=>setEdit('')}/>:
        <><div className="perf-heading"><strong>{selection?.name??t('Mappings','映射')}</strong>{selection&&<button aria-label={t('Show all mappings','显示全部映射')} onClick={()=>setSelected('')}>×</button>}</div>
        {selection?.kind==='sensor'&&<SensorBinding node={selection} inventory={inventory} zh={zh} onEdit={onEdit}/>}
        {selection&&<NodeSettings signals={signals} key={selection.id} directPitch={isPerformanceUnitSource(getNode(routes.find(r=>r.target===selection.id&&r.input==='pitch')?.source??''))} node={selection} zh={zh} midiInputs={midiInputs} onEnableMidi={onEnableMidi} onEdit={onEdit}/>}
        {selection&&<button className="perf-remove" onClick={()=>{onEdit({op:'remove_node',id:selection.id});setSelected('');}}>{t('Remove node','移除节点')}</button>}
        {wires.filter(l=>!selection||l.source===selected||l.target===selected).map(mapping)}
        {!wires.some(l=>!selection||l.source===selected||l.target===selected)&&<p>{t('Drag an output to a compatible input.','从输出端口拖到对应的输入端口。')}</p>}</>}
    </aside></div>
    {cable?.moved&&<svg className="perf-cable-preview" aria-hidden="true"><path d={cable.from.kind==='output'?curve(cable.start,cable.point):curve(cable.point,cable.start)}/></svg>}
  </section>;
}
