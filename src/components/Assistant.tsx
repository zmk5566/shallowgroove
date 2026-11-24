import {DeepSeekSettings} from './DeepSeekSettings';
import {acceptedFiles,readAttachment,type ChatAttachment} from '../assistant/attachments';
import {hasToolProtocolLeak,protocolFailure} from '../assistant/protocol';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../model/descriptions';
import type {MusicCommand,Selection} from '../assistant/contracts';
export interface AssistantContext {generation:string;projectId:string;selection:Selection;label:string;[key:string]:unknown}
type Entry={id:string;role:'user'|'assistant'|'tool'|'error';text:string;context?:string;undo?:()=>Promise<void>;undone?:boolean};
type Status={configured:boolean;model?:string;message?:string;token?:string};
type AssistantProps={refreshContext?:(selection:Selection)=>Promise<AssistantContext>;heading:React.ReactNode;onUserGesture:()=>void;locale:Locale;context:Pick<AssistantContext,'selection'|'generation'>;getContext:(selection:Selection)=>AssistantContext;execute:(selection:Selection,command:MusicCommand,generation:string)=>Promise<{result:unknown;undo?:()=>Promise<void>;selection?:Selection}>};
type Thread={scope?:string;id:string;title:string;updated:number};
type OpenThread={scope?:string;id:string;entries:Entry[]};
type ThreadRef={id:string;scope:string};
export function Assistant({projectScope,initialThread,onThreadChange,...props}:AssistantProps&{projectScope:string;initialThread?:ThreadRef;onThreadChange?:(thread:ThreadRef)=>void}){
 const zh=props.locale==='zh-CN',key='shallowgroove.conversation.'+projectScope;
 const [threads,setThreads]=useState<Thread[]>([]),[opened,setOpened]=useState<OpenThread|null>(null);
 const [chatVersion,setChatVersion]=useState(0);
 const [locked,setLocked]=useState(false),[loading,setLoading]=useState(true),[issue,setIssue]=useState(''),[attempt,setAttempt]=useState(0);
 const token=useRef('');
 const [otherThreads,setOtherThreads]=useState<Thread[]|null>(null);
 function remember(id:string,scope:string){onThreadChange?.({id,scope});try{localStorage.setItem(key,id);localStorage.setItem(key+'.scope',scope);}catch{/* History is also indexed by the server. */}}
 async function api(route:string,data:object,signal?:AbortSignal){
  const response=await fetch('/api/assistant/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Shallowgroove-Token':token.current},body:JSON.stringify({scope:projectScope,...data}),signal});
  if(!response.ok)throw Error('HTTP '+response.status);
  return response.json();
 }
 useEffect(()=>{
  const controller=new AbortController(),{signal}=controller;
  setLoading(true);setIssue('');
  void (async()=>{
   const status=await fetch('/api/assistant/status',{signal}).then(r=>r.json());
   token.current=status.token;
   const list:Thread[]=await api('conversations',{},signal);
   let last:string|null=null,scope=projectScope;
   try{last=localStorage.getItem(key);scope=localStorage.getItem(key+'.scope')??scope;}catch{}
   if(initialThread?.id){last=initialThread.id;scope=initialThread.scope;}
   const id=last??list[0]?.id??crypto.randomUUID();
   const entries=(scope!==projectScope||list.some(t=>t.id===id))?await api('conversation',{sessionId:id,scope},signal):[];
   if(!signal.aborted){setThreads(list);setOpened({id,entries,scope});remember(id,scope);}
  })().catch(e=>{if(!signal.aborted)setIssue(String(e));}).finally(()=>{if(!signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[projectScope,attempt]);
 async function choose(id:string,scope=projectScope){
  if(locked||loading)return;
  setLoading(true);setIssue('');
  try{const entries=id?await api('conversation',{sessionId:id,scope}):[];
   const next=id||crypto.randomUUID();remember(next,scope);setOpened({id:next,entries,scope});setChatVersion(n=>n+1);
  }catch(e){setIssue(String(e));}finally{setLoading(false);}
 }
 const threadPicker=useRef<HTMLDialogElement>(null);
 function pick(id:string,scope?:string){
  threadPicker.current?.close();
  void choose(id,scope);
 }
 const controls=<div className="assistant-threads">
  <button type="button" aria-haspopup="dialog" disabled={locked||loading} onClick={()=>{setOtherThreads(null);threadPicker.current?.showModal();void api('conversations',{}).then(setThreads).catch(e=>setIssue(String(e)));}}>{zh?'对话':'Chats'} ▾</button>
  {issue&&<button title={issue} onClick={()=>setAttempt(n=>n+1)}>{zh?'重试':'Retry'}</button>}
  <dialog ref={threadPicker} className="thread-picker" aria-label={zh?'历史对话':'Conversation history'} onClick={e=>{
   if(e.target!==e.currentTarget)return;
   const r=e.currentTarget.getBoundingClientRect();
   if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();
  }}>
   <header><strong>{zh?'历史对话':'Conversation history'}</strong><button type="button" aria-label={zh?'关闭':'Close'} onClick={()=>threadPicker.current?.close()}>×</button></header>
   <button className="thread-new" type="button" onClick={()=>pick('')}>{zh?'＋ 新对话':'+ New chat'}</button>
   <button type="button" onClick={async()=>{try{setOtherThreads(otherThreads?null:await api('conversations',{all:true}));}catch(e){setIssue(String(e));}}}>{otherThreads?(zh?'当前会话列表':'Current workspace'):(zh?'所有工作区的对话':'Chats from all workspaces')}</button>
   {(otherThreads??threads).length>0?<div className="thread-list">{(otherThreads??threads).map(t=><button key={t.id} type="button" aria-current={t.id===opened?.id?'true':undefined} title={t.title} onClick={()=>pick(t.id,t.scope)}>
    <span>{t.title}</span><time dateTime={new Date(t.updated).toISOString()}>{new Date(t.updated).toLocaleDateString(props.locale,{month:'short',day:'numeric'})}</time>
   </button>)}</div>:<p>{zh?'暂无历史对话':'No conversations yet'}</p>}
  </dialog>
 </div>;
 const header=<header className="assistant-heading">{props.heading}{controls}</header>;
 if(!opened)return <aside className="assistant expanded"><div className="assistant-body">{header}</div></aside>;
 return <Chat key={opened.id+':'+chatVersion} {...props} controls={header} thread={opened} onWorking={setLocked} onMessage={text=>{
  if(!opened.scope||opened.scope===projectScope)setThreads(current=>[{id:opened.id,title:current.find(t=>t.id===opened.id)?.title??text.slice(0,80),updated:Date.now()},...current.filter(t=>t.id!==opened.id)]);
 }} loading={loading}/>;
}
function Chat({refreshContext,onUserGesture,locale,context,getContext,execute,thread,controls,onWorking,onMessage,loading}:AssistantProps&{thread:OpenThread;controls:React.ReactNode;onWorking:(value:boolean)=>void;onMessage:(text:string)=>void;loading:boolean}){
 const zh=locale==='zh-CN';const [input,setInput]=useState(''),[entries,setEntries]=useState<Entry[]>(thread.entries),[working,setWorking]=useState(false),[continuations,setContinuations]=useState(0),[canResume,setCanResume]=useState(false),[status,setStatus]=useState<Status>({configured:false});
 const [files,setFiles]=useState<ChatAttachment[]>([]),[reading,setReading]=useState(false),[fileError,setFileError]=useState('');
 const picker=useRef<HTMLInputElement>(null);
 async function attach(selected:File[]){
  setFileError('');
  if(selected.length+files.length>4){setFileError(zh?'每条消息最多 4 个附件。':'Up to four attachments per message.');return;}
  setReading(true);
  const added:ChatAttachment[]=[],errors:string[]=[];
  for(const file of selected){try{added.push(await readAttachment(file,zh));}catch(e){errors.push(file.name+' · '+String(e));}}
  setFiles(previous=>[...previous,...added]);setFileError(errors.join(' · '));setReading(false);
 }
 useEffect(()=>{window.dispatchEvent(new CustomEvent('shallowgroove-transcript',{detail:entries.map(({role,text,context})=>({role,text,context}))}));},[entries]);
 const latest=useRef({getContext,execute,context});latest.current={getContext,execute,context};
 const session=useRef(thread.id),abort=useRef<AbortController|null>(null),log=useRef<HTMLDivElement>(null);
 const append=(entry:Omit<Entry,'id'>)=>{const id=crypto.randomUUID();setEntries(s=>[...s,{...entry,id}]);return id;};
 async function check(){try{const response=await fetch('/api/assistant/status');if(!response.ok)throw Error('Local assistant service unavailable');setStatus(await response.json());}catch(e){setStatus({configured:false,message:String(e)});}}
 useEffect(()=>{const refresh=()=>void check();refresh();window.addEventListener('shallowgroove-key-changed',refresh);return()=>{window.removeEventListener('shallowgroove-key-changed',refresh);abort.current?.abort();};},[]);
 useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight});},[entries,working]);
 async function send(override?:string){
  if((!(override??input).trim()&&!files.length)||loading||reading||working||!status.configured)return;
  onUserGesture(); // Resume during the actual click/Enter, before a network round-trip loses user activation.
  let selected=structuredClone(context.selection);let snapshot:AssistantContext;
  try{snapshot=refreshContext?await refreshContext(selected):latest.current.getContext(selected);}catch(e){append({role:'error',text:String(e)});return;}
  const text=(override??input).trim()||(zh?'请概述附件内容。':'Summarize the attached material.'),generation=snapshot.generation;
  append({role:'user',text:[text,...files.map(f=>'📎 '+f.name)].join('\n'),context:`${snapshot.label} · ${zh?'协作':'Collaborate'}`});setInput('');onMessage(text);onWorking(true);setWorking(true);setContinuations(0);setCanResume(false);window.dispatchEvent(new Event('shallowgroove-turn-start'));
  const controller=new AbortController();abort.current=controller;let final=false,streamId='';
  try{
   const response=await fetch('/api/assistant/turn',{method:'POST',headers:{'Content-Type':'application/json','X-Shallowgroove-Token':status.token??''},body:JSON.stringify({sessionId:session.current,text,attachments:files,context:{...snapshot,conversationProject:thread.scope??snapshot.conversationProject},locale}),signal:controller.signal});
   if(!response.ok)throw Error((await response.json()).error??`HTTP ${response.status}`);
   if(!response.body)throw Error('Missing response stream');const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});const lines=buffer.split('\n');buffer=lines.pop()??'';
    for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);
     if(event.type==='continuation')setContinuations(event.count);
     if(event.type==='text'){if(!streamId)streamId=append({role:'assistant',text:event.text});else setEntries(s=>s.map(e=>e.id===streamId?{...e,text:e.text+event.text}:e));}
     if(event.type==='reply'){if(hasToolProtocolLeak(event.text??''))throw Error(protocolFailure);if(streamId)setEntries(s=>s.map(e=>e.id===streamId?{...e,text:event.text}:e));else if(event.text)append({role:'assistant',text:event.text});final=true;}
     if(event.type==='error')throw Error(event.message);
     if(event.type==='tool'){
      const id=append({role:'tool',text:`${event.command.action} …`,context:latest.current.getContext(selected).label});let payload:unknown;
      try{
       if(controller.signal.aborted)throw Error('Cancelled');
       if(latest.current.context.generation!==generation)throw Error('Project or audio setup changed; command cancelled.');
       const result=event.command.action==='inspect'?{result:refreshContext?await refreshContext(selected):latest.current.getContext(selected)}:await latest.current.execute(selected,event.command,generation);
       if(result.selection)selected=structuredClone(result.selection);
       payload={result:result.result};const undo=result.undo;
       setEntries(s=>s.map(e=>e.id===id?{...e,context:latest.current.getContext(selected).label,text:`${event.command.action} ✓\n${JSON.stringify(result.result,null,2)}`,undo:undo?async()=>{if(latest.current.context.generation!==generation)throw Error('The project has changed.');await undo();}:undefined}:e));
      }catch(error){payload={error:String(error)};setEntries(s=>s.map(e=>e.id===id?{...e,text:`${event.command.action} ×\n${String(error)}`}:e));}
      if(!controller.signal.aborted){const ack=await fetch('/api/assistant/result',{method:'POST',headers:{'Content-Type':'application/json','X-Shallowgroove-Token':status.token??''},body:JSON.stringify({sessionId:session.current,id:event.id,...payload as object}),signal:controller.signal});if(!ack.ok)throw Error('Tool acknowledgement failed');}
     }
    }if(done)break;
   }
   if(!final)throw Error('Assistant disconnected before completion.');
   setFiles([]);setFileError('');
  }catch(error){setCanResume(true);append({role:controller.signal.aborted?'tool':'error',text:controller.signal.aborted?(zh?'已停止生成。已完成的修改仍保留，可撤销或继续未完成任务。':'Generation stopped. Completed edits remain and can be undone.'):String(error)});}finally{window.dispatchEvent(new Event('shallowgroove-turn-end'));setWorking(false);onWorking(false);abort.current=null;}
 }
 useEffect(()=>{const receive=(event:Event)=>{const detail=(event as CustomEvent<string>).detail;setInput(detail);};window.addEventListener('shallowgroove-effect-request',receive);return()=>window.removeEventListener('shallowgroove-effect-request',receive);},[]);
 function suggest(text:string){setInput(text);}
 return <aside className="assistant expanded" aria-label="AI assistant"><div className="assistant-body">
 {controls}
 <div className={`assistant-connection ${status.configured?'connected':''}`}><i/>{status.configured?status.model:(zh?'尚未连接模型':'Model not connected')}<DeepSeekSettings zh={zh}/><button onClick={()=>void check()} aria-label="Check assistant connection">↻</button></div>
 {!status.configured&&!window.shallowgrooveDesktop&&<details className="assistant-setup"><summary>{zh?'本地模型配置':'Local model setup'}</summary><p>{zh?'在项目 .env.local 中设置 DEEPSEEK_API_KEY，再重启开发服务。密钥不会进入前端。':'Set DEEPSEEK_API_KEY in .env.local and restart the dev server. Keys stay on the server.'}</p>{status.message&&<small>{status.message}</small>}</details>}
 <div className="assistant-log" ref={log} role="log" aria-label="Assistant conversation">{!entries.length&&<div className="assistant-welcome">
 <b>{zh?'从一个声音，聊到一首音乐。':'FROM A SOUND TO A PIECE OF MUSIC.'}</b>
 <p>{zh?'选一条轨道或一个 patch，聊聊它背后的乐器与历史，拆解声音的设计，再结合你想表达的音乐，一步步调整。可以从这些具体问题开始：':'Select a track or patch to explore its instrument and history, unpack how the sound is built, and develop it around the music you want to make. Start with a question:'}</p>
 <button onClick={()=>suggest(zh?'当前音色对应或接近什么具体乐器？请以它为线索，介绍这种乐器的起源、典型演奏方式，以及它在不同年代和音乐风格中的用途。举两三个具体的音乐人或作品例子，说明值得留意的音色与演奏特点。结合已有参考资料，区分有依据的历史、音色上的类比和这个 patch 的近似实现；不确定的出处请说明，不要把它说成原曲实际使用的设备。':'What specific instrument does this sound represent or resemble? Explain its origins, typical playing techniques, and uses across eras and genres. Give two or three concrete artist or recording examples and describe the timbral and performance details to listen for. Use available references, distinguishing documented history, sonic comparisons, and this patch’s approximation. Flag uncertain sources and do not claim this was the equipment used on the original recording.')}>{zh?'乐器与历史 · 这个声音从哪里来，哪些音乐里用过？':'Instrument & history · Where does this sound come from, and who used it?'} ↗</button>
 <button onClick={()=>suggest(zh?'请读取当前 patch 的实际源码和参数，按信号流解释它是怎样发声的：声源或振荡器、泛音、滤波、包络、调制与效果分别起什么作用？只解释实际存在的环节。挑出三个最影响声音性格的参数，说明调高或调低时预期会听到什么，并给出一个可以逐步试听的小实验。先解释，不修改，也不要声称已经听过音频。':'Read the current patch’s actual source and parameters and explain its signal flow: sound sources or oscillators, harmonics, filters, envelopes, modulation, and effects where present. Pick three parameters that most strongly shape its character, describe what increasing or decreasing each is expected to sound like, and suggest a step-by-step listening experiment. Explain without editing or claiming to have heard the audio.')}>{zh?'技术与设计 · 它怎样发声，哪些参数改变声音性格？':'Sound design · How does it work, and which parameters shape its character?'} ↗</button>
 <button onClick={()=>suggest(zh?'我想在保留当前音色辨识度的前提下，把它发展成两个版本：一个适合稀疏、亲近的段落，一个适合密集、有推动力的段落。请根据实际 patch 和效果链，具体说明每个版本应怎样调整起音与释放、频谱、调制和空间；不适用的环节不必硬套。解释每一步的音乐目的、代价与试听重点，区分现有参数能做到的调整和需要改 DSP 的设计。先提出方案，不直接修改。':'Develop this sound in two directions while preserving its identity: one for a sparse, intimate passage and another for a dense, driving passage. Based on the actual patch and effect chain, describe relevant changes to attack and release, spectrum, modulation, and space. Explain each change’s musical purpose, tradeoffs, and listening cues, separating existing parameter adjustments from designs that require DSP changes. Propose the approaches without editing yet.')}>{zh?'调整与演变 · 同一个音色，怎样适应两种不同的段落？':'Develop the sound · How could it serve two contrasting passages?'} ↗</button>
 <button onClick={()=>suggest(zh?'结合当前工程里可读取的轨道、音色与设置，讨论这个声音可能承担什么音乐角色：旋律、低音、和声铺底，还是节奏点缀？以其中一个合适的角色为例，具体讲音区、节奏疏密、音符长短、力度与空间处理如何影响它和其他声部的关系，并提出一个对比试听的编曲思路。请说明哪些判断来自工程信息，哪些只是建议；如果缺少音符或音频信息，说明还需要知道什么，不要假装已经听过。先讨论，不修改。':'Using the tracks, sounds, and settings available in this project, discuss the musical role this sound could play: melody, bass, harmonic bed, or rhythmic accent. Choose a suitable role and explain how register, rhythmic density, note lengths, dynamics, and spatial treatment affect its relationship with other parts. Suggest an arrangement comparison to audition. Distinguish project evidence from suggestions; if note or audio information is missing, explain what else is needed rather than claiming to have listened. Discuss without editing.')}>{zh?'音乐与编曲 · 它适合演什么，怎样和其他声部配合？':'Music & arrangement · What should it play, and how can it fit with other parts?'} ↗</button>
 </div>}{entries.map(entry=><article key={entry.id} className={`assistant-message ${entry.role}`}><header>{entry.role==='user'?(zh?'你':'YOU'):entry.role==='tool'?'RACK':entry.role==='error'?'ERROR':'ASSISTANT'}</header>{entry.context&&<small>{entry.context}</small>}{entry.role==='tool'?<details><summary>{entry.text.split('\n')[0]}</summary><pre>{entry.text.split('\n').slice(1).join('\n')}</pre></details>:entry.role==='assistant'?<div className="assistant-prose"><Markdown skipHtml remarkPlugins={[remarkGfm]} components={{table:({children})=><div className="assistant-table-scroll" role="region" aria-label={zh?'表格，可横向滚动':'Table, scroll horizontally'} tabIndex={0}><table>{children}</table></div>,a:({children,href})=><a href={href} onClick={e=>{if(href&&/^https?:\/\//i.test(href)&&window.shallowgrooveDesktop){e.preventDefault();void window.shallowgrooveDesktop.openSource(href).catch(err=>append({role:'error',text:String(err)}));}}} target="_blank" rel="noopener noreferrer">{children}</a>}}>{entry.text}</Markdown></div>:<p>{entry.text}</p>}{entry.undo&&<button disabled={working||entry.undone} onClick={async()=>{try{await entry.undo!();setEntries(s=>s.map(e=>e.id===entry.id?{...e,undone:true}:e));}catch(e){append({role:'error',text:String(e)});}}}>{entry.undone?(zh?'已撤销':'Undone'):(zh?'撤销这次修改':'Undo this edit')}</button>}</article>)}{working&&<div className="assistant-working" role="status">{continuations?(zh?`已到单次输出上限，正在自动继续（第 ${continuations+1} 段）…`:`Output limit reached; continuing automatically (part ${continuations+1})…`):(zh?'助手正在处理…':'Working…')}</div>}</div>
 <form className="assistant-composer" onSubmit={e=>{e.preventDefault();void send();}}><input ref={picker} hidden type="file" multiple accept={acceptedFiles} onChange={e=>{const chosen=Array.from(e.target.files??[]);e.target.value='';void attach(chosen);}}/>
 {files.length>0&&<div className="assistant-attachments">{files.map((f,i)=><button type="button" disabled={working||reading} key={i} aria-label={(zh?'移除 ':'Remove ')+f.name} onClick={()=>setFiles(prev=>prev.filter((_,n)=>n!==i))}>{f.name}{f.truncated?(zh?'（节选）':' (excerpt)'):''} ×</button>)}</div>}
 {fileError&&<small role="alert">{fileError}</small>}<textarea aria-label="Message assistant" value={input} onChange={e=>setInput(e.target.value)} placeholder={zh?'聊聊当前选择的声音…':'Talk about the selected sound…'} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><button type="button" disabled={reading||working||files.length>=4} onClick={()=>picker.current?.click()}>{reading?(zh?'读取中…':'Reading…'):(zh?'＋ 附件':'+ Attach')}</button><small>{zh?'Enter 发送 · Shift+Enter 换行':'Enter sends · Shift+Enter new line'}</small>{!working&&canResume&&<button type="button" disabled={!status.configured} onClick={()=>void send(zh?'继续上一次尚未完成的任务，保持原来的范围；先核对当前状态，保留已完成的修改，不要重复执行。':'Continue the unfinished previous task within its original scope. Inspect current state first; preserve completed edits and do not repeat them.')}>{zh?'继续未完成任务':'Continue unfinished task'}</button>}{working?<button type="button" onClick={()=>abort.current?.abort()}>{zh?'停止生成':'Stop generation'}</button>:<button type="submit" disabled={loading||reading||(!input.trim()&&!files.length)||!status.configured}>{zh?'发送':'Send'} ↑</button>}</div></form>
 </div></aside>;
}
