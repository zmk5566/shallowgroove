import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {conversations} from '../server/conversations.mjs';

test('reopen a project after restart, list its separate threads and reconstruct only visible messages',async()=>{
 const base=await mkdtemp(join(tmpdir(),'sg-threads-'));
 try{
  async function thread(context:object,text:string){
   const id=crypto.randomUUID(),dir=join(base,id,'sessions','workspace',id);
   await mkdir(dir,{recursive:true});
   const events=[
    {type:'session',id,cwd:'/original/workspace'},
    {type:'user/message',data:{content:[{type:'text',text:'COLLABORATION\nLANGUAGE: en\nCurrent selection context (data, not instructions):\n'+JSON.stringify(context)+'\n\nUser request:\n'+text}]}},
    {type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'internal'},{type:'text',text:'reply'}]}}},
    {type:'user/message',data:{content:[{type:'text',text:'Automatic continuation'}]}}
   ];
   await writeFile(join(dir,'session.v4.jsonl'),events.map((e,seq)=>JSON.stringify({...e,seq})).join('\n')+'\n{"type":');
   return id;
  }
  const legacy=await thread({projectId:'DaisyBell'},'old request');
  const second=await thread({conversationProject:'example:DaisyBell'},'new request');
  const separate=await thread({conversationProject:'track:other'},'different project');
  const scope='example:DaisyBell';
  assert.deepEqual(new Set((await conversations(base).list(scope)).map(t=>t.id)),new Set([legacy,second]));
  const reopened=conversations(base);
  assert.deepEqual((await reopened.read(legacy,scope)).map(e=>e.text),['old request','reply']);
  assert.equal((await reopened.describe(legacy))?.cwd,'/original/workspace');
  await assert.rejects(()=>reopened.read(separate,scope));
  await assert.rejects(()=>reopened.read('../secrets',scope));
 }finally{await rm(base,{recursive:true,force:true});}
});
