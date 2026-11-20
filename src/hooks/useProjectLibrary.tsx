import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {ProjectManager,type ProjectAdapter} from '../model/project-manager';
import {projectStorage} from '../model/browser-projects';
import type {Locale} from '../model/descriptions';
type Request={kind:'name'|'leave';name?:string;resolve:(value:string|null)=>void};
function ProjectDialog({request,locale}:{request:Request|null;locale:Locale}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),zh=locale==='zh-CN';
 useEffect(()=>{if(request){dialog.current?.showModal();input.current?.focus();input.current?.select();}else dialog.current?.close();},[request]);
 const answer=(value:string|null)=>request?.resolve(value);
 return <dialog className="project-dialog" ref={dialog} onCancel={e=>{e.preventDefault();answer(null);}}>
  <span className="welcome-kicker">SHALLOWGROOVE / PROJECT</span><h2>{request?.kind==='name'?(zh?'保存你的项目':'Save your project'):(zh?'保存这次修改？':'Save your changes?')}</h2>
  {request?.kind==='name'?<form onSubmit={e=>{e.preventDefault();answer(input.current!.value);}}><label>{zh?'项目名称':'Project name'}<input ref={input} aria-label="Project name" defaultValue={request.name} key={request.name} required maxLength={200}/></label><p>{zh?'Example 的原件始终保留。':'The original example stays unchanged.'}</p><div className="project-dialog-actions"><button type="button" onClick={()=>answer(null)}>{zh?'取消':'Cancel'}</button><button className="primary" type="submit">{zh?'保存':'Save'}</button></div></form>:<><p>{zh?'保存到你的项目，或丢弃这次未保存的修改。':'Save to your project, or discard the changes from this session.'}</p><div className="project-dialog-actions"><button onClick={()=>answer(null)}>{zh?'取消':'Cancel'}</button><button onClick={()=>answer('discard')}>{zh?'不保存':'Don’t save'}</button><button className="primary" onClick={()=>answer('save')}>{zh?'保存':'Save'}</button></div></>}
 </dialog>;
}
export function useProjectLibrary(adapter:Omit<ProjectAdapter,'askName'|'askLeave'>,locale:Locale){
 const [request,setRequest]=useState<Request|null>(null);
 const ask=(kind:Request['kind'],name?:string)=>new Promise<string|null>(resolve=>setRequest({kind,name,resolve:value=>{setRequest(null);resolve(value);}}));
 const full:ProjectAdapter={...adapter,askName:name=>ask('name',name),askLeave:async()=>((await ask('leave'))??'cancel') as 'save'|'discard'|'cancel'};
 const [manager]=useState(()=>new ProjectManager(projectStorage(),full));manager.adapter=full;
 const state=useSyncExternalStore(listener=>{manager.notify=listener;return()=>{manager.notify=()=>{};}},()=>manager.state);
 useEffect(()=>{void manager.initialize();},[manager]);
 return {manager,state,dialog:<ProjectDialog request={request} locale={locale}/>};
}
