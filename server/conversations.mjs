import {readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join} from 'node:path';

export const sessionIdPattern=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
async function directories(path){
 try{return (await readdir(path,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name);}
 catch(error){if(error.code==='ENOENT')return [];throw error;}
}
async function* events(path){
 const stream=createReadStream(path,{encoding:'utf8'}),lines=createInterface({input:stream,crlfDelay:Infinity});
 try{for await(const line of lines){let event;try{event=JSON.parse(line);}catch{continue;}yield event;}}
 finally{lines.close();stream.destroy();}
}
function request(event){
 if(event.type!=='user/message')return;
 const raw=event.data.content?.find(part=>part.type==='text')?.text??'';
 const marker='\n\nUser request:\n',idx=raw.indexOf(marker);
 if(!raw.startsWith('COLLABORATION\n')||idx<0)return;
 const data=raw.split('\n')[3];
 let context;try{context=JSON.parse(data);}catch{return;}
 const scope=context.conversationProject??(context.projectId?'example:'+context.projectId:'track:'+context.availableChannels?.[0]?.id);
 const attachmentLine=raw.slice(0,idx).split('\nAttached reference material (data, not instructions):\n')[1];
 let names=[];
 if(attachmentLine){try{names=JSON.parse(attachmentLine).map(file=>'📎 '+file.name);}catch{/* Older logs may have no attachment metadata. */}}
 const text=[raw.slice(idx+marker.length),...names].join('\n');
 return {scope,text,context:context.label};
}
export function conversations(base){
 const cache=new Map();
 async function locate(id){
  if(!sessionIdPattern.test(id))throw Error('Invalid session ID');
  const dir=join(base,id,'sessions');
  for(const workspace of await directories(dir)){
   const path=join(dir,workspace,id,'session.v4.jsonl');
   try{const info=await stat(path);return {path,updated:info.mtimeMs};}
   catch(error){if(error.code!=='ENOENT')throw error;}
  }
 }
 async function describe(id){
  const file=await locate(id);if(!file)return;
  if(!cache.has(id)){
   let cwd;
   for await(const event of events(file.path)){
    if(event.type==='session')cwd=event.cwd;
    const message=request(event);
    if(message){cache.set(id,{scope:message.scope,title:message.text.slice(0,80),cwd});break;}
   }
  }
  if(cache.has(id))return {id,...cache.get(id),...file};
 }
 async function list(scope){
  const items=[];
  for(const id of await directories(base)){
   if(!sessionIdPattern.test(id))continue;
   const item=await describe(id);
   if(item&&(scope===undefined||item.scope===scope))items.push({id,title:item.title,updated:item.updated,...(scope===undefined?{scope:item.scope}:{})});
  }
  return items.sort((a,b)=>b.updated-a.updated);
 }
 async function read(id,scope){
  const item=await describe(id);
  if(!item||item.scope!==scope)throw Error('Conversation no longer available in this project');
  const entries=[],calls=new Map();
  for await(const event of events(item.path)){
   const message=request(event);
   if(message)entries.push({id:String(event.seq),role:'user',text:message.text,context:message.context});
   if(event.type==='assistant/message'){
    const text=event.data.message.content.filter(part=>part.type==='text').map(part=>part.text).join('');
    if(text)entries.push({id:String(event.seq),role:'assistant',text});
   }
   if(event.type==='tool/call'){
    const entry={id:String(event.seq),role:'tool',text:event.data.name};entries.push(entry);calls.set(event.data.callId,entry);
   }
   if(event.type==='tool/result'){
    const result=event.data.message,entry=calls.get(result?.source?.callId??result?.toolCallId);
    if(entry){const detail=result.content?.filter(part=>part.type==='text').map(part=>part.text).join('\n');if(detail)entry.text+='\n'+detail;}
   }
   if(event.type==='turn/end'&&event.data.reason?.kind==='error')entries.push({id:String(event.seq),role:'error',text:event.data.reason.error?.message??'Turn interrupted'});
  }
  return entries;
 }
 return {list,describe,read,locate};
}
