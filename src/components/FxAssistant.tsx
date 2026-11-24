import {useEffect,useRef,useState} from 'react';
import {Assistant,type AssistantContext} from './Assistant';
import type {MusicCommand} from '../assistant/contracts';
import type {Locale} from '../model/descriptions';

type Patch={thread?:{id:string;scope:string};scope:string;generation:string;name:string;code:string;draftCode:string;values:Record<string,number>;controls:unknown[]};
type Backend={
 addEventListener(name:string,receive:(event:{promiseId:number;result:unknown})=>void):unknown;
 emitEvent(name:string,value:unknown):void;
};
const backend=(window as Window & {__JUCE__?:{backend:Backend}}).__JUCE__?.backend;
let nextId=0;
const pending=new Map<number,(value:unknown)=>void>();
backend?.addEventListener('__juce__complete',({promiseId,result})=>{
 pending.get(promiseId)?.(result);pending.delete(promiseId);
});
function native<T>(command:object):Promise<T>{
 if(!backend)return Promise.reject(Error('Open this panel inside ShallowGroove FX.'));
 const id=++nextId;
 return new Promise(resolve=>{
  pending.set(id,result=>resolve(result as T));
  backend.emitEvent('__juce__invoke',{name:'fxCommand',params:[command],resultId:id});
 });
}
const selection={channel:0,device:'effect'} as const;
export function FxAssistant({locale}:{locale:Locale}){
 const latest=useRef<Patch|null>(null),[scope,setScope]=useState(''),[error,setError]=useState('');
 async function inspect(){
  const patch=await native<Patch>({action:'inspect'});
  latest.current=patch;setScope(patch.scope);return patch;
 }
 useEffect(()=>{void inspect().catch(e=>setError(String(e)));},[]);
 function context():AssistantContext{
  const patch=latest.current!;
  return {selection,projectId:patch.scope,conversationProject:patch.scope,generation:patch.scope,label:patch.name,
   workspace:{view:'vst-effect'},activePatch:patch,availableDevices:[{id:'effect',name:patch.name}]};
 }
 async function execute(_:unknown,command:MusicCommand,generation:string){
  const patch=latest.current;
  if(!patch||patch.scope!==generation)throw Error('Effect instance changed.');
  const result=await native<Record<string,unknown>>({...command,generation:patch.generation});
  await inspect();
  if(result.error)throw Error(String(result.error));
  return {result};
 }
 return <main className="fx-assistant">{scope?<Assistant key={scope} locale={locale} projectScope={scope} heading={<strong>{locale==='en'?'Assistant':'助手'}</strong>}
  initialThread={latest.current?.thread} onThreadChange={thread=>{void native({action:'remember',...thread});}}
  context={{selection,generation:scope}} getContext={context} refreshContext={async()=>{await inspect();return context();}}
  execute={execute} onUserGesture={()=>{}}/>:<p role="status">{error||'…'}</p>}</main>;
}
