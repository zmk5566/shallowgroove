import {useRef,useState} from 'react';

const messages={
 invalid:['The key was rejected. Check it and try again.','密钥未通过验证，请检查后重试。'],
 network:['Could not reach DeepSeek. Try again later.','暂时无法验证，请稍后重试。'],
 storage:['Could not access the saved key. Unlock system storage or replace the key.','无法访问已保存的密钥。请解锁系统凭据存储，或重新配置。'],
 busy:['Another update is in progress.','正在更新密钥，请稍后重试。'],
 verified:['Saved key verified.','已验证保存的密钥。'],
 saved:['Key verified and saved.','密钥已验证并保存。'],
 removed:['Personal key removed.','个人密钥已移除。'],
};
export function DeepSeekSettings({zh,welcome=false}:{zh:boolean;welcome?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [key,setKey]=useState(''),[source,setSource]=useState(''),[message,setMessage]=useState<keyof typeof messages|null>(null),[busy,setBusy]=useState(false);
 const desktop=window.shallowgrooveDesktop;
 if(!desktop?.setAssistantKey)return null;
 async function status(){
  const response=await fetch('/api/assistant/status');if(!response.ok)throw Error();
  setSource((await response.json()).keySource);
 }
 async function open(){
  setKey('');setMessage(null);setSource('');dialog.current?.showModal();
  try{await status();if(await desktop!.assistantStorageIssue())setMessage('storage');}catch{setMessage('network');}
 }
 async function testSaved(){
  setBusy(true);setMessage(null);
  try{const result=await desktop!.testAssistantKey();setMessage(result==='ok'?'verified':result);}
  catch{setMessage('storage');}finally{setBusy(false);}
 }
 async function apply(value:string|null){
  setBusy(true);setMessage(null);
  try{
   const result=await desktop!.setAssistantKey(value);
   if(result!=='ok'){setMessage(result);return;}
   setKey('');setMessage(value?'saved':'removed');
   window.dispatchEvent(new Event('shallowgroove-key-changed'));await status();
  }catch{setMessage('storage');}finally{setBusy(false);}
 }
 return <><button type="button" onClick={()=>void open()}>{welcome?(zh?'连接 DeepSeek（可选）':'Connect DeepSeek (optional)'):(zh?'AI 设置':'AI settings')}</button>
 <dialog ref={dialog} className="project-dialog deepseek-settings" aria-label={zh?'AI 设置':'AI settings'} onClose={()=>setKey('')} onCancel={e=>{if(busy)e.preventDefault();}}>
  <h2>{zh?'DeepSeek 设置':'DeepSeek settings'}</h2>
  <p>{source==='user'?(zh?'已配置个人密钥':'Using your personal key'):source==='builtin'?(zh?'正在使用内置密钥':'Using the included key'):source==='none'?(zh?'可以先使用音乐工作台，随时回来配置 AI。':'You can use the music workstation and configure AI later.'):'…'}</p>
  <form onSubmit={e=>{e.preventDefault();void apply(key.trim());}}>
   <label>DeepSeek API Key<input type="password" value={key} autoComplete="off" spellCheck={false} disabled={busy} maxLength={512} onChange={e=>setKey(e.target.value)}/></label>
   <p role="status">{message?messages[message][+zh]:''}</p>
   <div className="project-dialog-actions">{source==='user'&&<button type="button" disabled={busy} onClick={()=>void testSaved()}>{zh?'测试已存密钥':'Test saved key'}</button>}{(source==='user'||message==='storage')&&<button type="button" disabled={busy} onClick={()=>void apply(null)}>{zh?'移除个人密钥':'Remove personal key'}</button>}
    <button type="button" disabled={busy} onClick={()=>dialog.current?.close()}>{welcome&&source==='none'?(zh?'跳过':'Skip'):(zh?'关闭':'Close')}</button>
    <button className="primary" disabled={busy||!key.trim()}>{busy?(zh?'处理中…':'Working…'):(zh?'测试并保存':'Test and save')}</button></div>
  </form></dialog></>;
}
