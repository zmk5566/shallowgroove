import {useEffect,useRef,useState} from 'react';
import type {MusicVersions,VersionCommand} from '../desktop';
import {AudioEngine} from '../audio/engine';
import {hydrate} from '../model/session';
import {readDocument} from '../model/project-files';
type Props={id:string;zh:boolean;close:()=>void;pause:()=>void;save:()=>Promise<boolean>;load:(text:string)=>Promise<void>;chat:()=>unknown[]};
export function ProjectVersions({id,zh,close,pause,save,load,chat}:Props){
 const dialog=useRef<HTMLDialogElement>(null),preview=useRef<AudioEngine|null>(null);
 const [state,setState]=useState<MusicVersions>(),[selected,select]=useState(''),[name,setName]=useState(''),[branch,setBranch]=useState(''),[url,setUrl]=useState(''),[share,setShare]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[playing,setPlaying]=useState(false);
 const [source,setSource]=useState<{url:string;commit:string}>();
 const t=(cn:string,en:string)=>zh?cn:en;
 useEffect(()=>{
  const el=dialog.current!;el.showModal();let active=true;
  window.shallowgrooveDesktop!.projectVersion(id,{action:'status'}).then(({state,source})=>{if(active){setSource(source);setState(state);select(state?.head??'');setUrl(state?.remote??'');}}).catch(e=>active&&setError(String(e))).finally(()=>active&&setBusy(false));
  return()=>{active=false;el.close();if(preview.current)void preview.current.dispose();};
 },[id]);
 async function stop(){const p=preview.current;preview.current=null;setPlaying(false);if(p)await p.dispose();}
 async function run(cmd:VersionCommand){
  setBusy(true);setError('');
  try{
   await stop();
   if(['init','link','checkpoint','branch','switch','pull'].includes(cmd.action)&&!await save())return;
   const result=await window.shallowgrooveDesktop!.projectVersion(id,cmd);
   if(cmd.action==='preview'&&result.text){
    pause();const music=readDocument(result.text);const p=new AudioEngine();preview.current=p;
    await hydrate(p,music.session);await p.play();setPlaying(true);
   }else{
    if(result.text)await load(result.text);
    setState(result.state);select(result.state?.head??'');setUrl(result.state?.remote??'');
    if(cmd.action==='checkpoint'){setShare(false);setName('');}
   }
  }catch(e){await stop();setError(String(e));}finally{setBusy(false);}
 }
 return <dialog ref={dialog} className="versions-dialog" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
  <header><strong>{t('工程版本','Project versions')}</strong><button disabled={busy} onClick={close} aria-label={t('关闭','Close')}>×</button></header>
  <fieldset disabled={busy}>
  {!state?<><button onClick={()=>void run({action:'init'})}>{t('创建本地版本库','Create local repository')}</button>{source&&<><small>{source.url} · {source.commit.slice(0,7)}</small><div><input placeholder={t('新分支名称','New branch name')} value={branch} onChange={e=>setBranch(e.target.value)}/><button disabled={!branch} onClick={()=>void run({action:'link',name:branch})}>{t('从 ZIP 原版本分叉','Branch from ZIP source')}</button></div></>}</>:<>
   <label>{t('当前分支','Branch')} <select value={state.branch} onChange={e=>void run({action:'switch',name:e.target.value})}>{[...new Set([...state.branches,...state.remoteBranches])].map(b=><option key={b}>{b}</option>)}</select></label>
   <div><input value={name} onChange={e=>setName(e.target.value)} placeholder={t('版本说明','Version message')}/><button onClick={()=>void run({action:'checkpoint',name,chat:share?chat():undefined})}>{t('保存版本','Save version')}</button></div>
   <label><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)}/>{t('将当前对话文本写入此版本的 Git 历史','Include current conversation text in Git history')}</label>
   <select size={Math.min(8,Math.max(2,state.commits.length))} aria-label={t('版本历史','History')} value={selected} onChange={e=>select(e.target.value)}>{state.commits.map(c=><option key={c.id} value={c.id}>{c.graph.replaceAll(' ','\u00a0')}{c.id.slice(0,7)} · {c.title} {c.refs&&'('+c.refs+')'}</option>)}</select>
   <small>{t('父版本','Parents')} · {state.commits.find(c=>c.id===selected)?.parents.split(' ').map(p=>p.slice(0,7)).join(', ')||'—'}</small>
   <div><button onClick={()=>playing?void stop():void run({action:'preview',commit:selected})}>{playing?t('停止试听','Stop preview'):t('试听所选版本','Preview version')}</button></div>
   <div><input value={branch} onChange={e=>setBranch(e.target.value)} placeholder={t('新分支名称','New branch name')}/><button disabled={!branch} onClick={()=>void run({action:'branch',name:branch,commit:selected})}>{t('从所选版本分叉','Branch from version')}</button></div>
   <div><input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/><button disabled={!url||url===state.remote} onClick={()=>void run({action:'remote',url})}>{t('连接远端','Connect remote')}</button></div>
   {state.remote&&<div><button onClick={()=>void run({action:'fetch'})}>{t('刷新远端分支','Fetch branches')}</button><button onClick={()=>void run({action:'pull'})}>Pull ↓</button><button onClick={()=>void run({action:'push'})}>Push ↑</button></div>}
  </>}
  </fieldset>{busy&&<small role="status">…</small>}{error&&<p role="alert">{error}</p>}
 </dialog>;
}
