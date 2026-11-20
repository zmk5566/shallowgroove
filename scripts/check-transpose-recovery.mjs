import {multitrackFixture} from './multitrack-fixture.mjs';
// Real SDK + browser + audio engine. Only the remote model is replaced with deterministic tool requests.
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as createVite} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {parseFile} from '../src/model/session.ts';
import {unzipDocument} from '../src/model/project-files.ts';
import {notesOf} from '../src/model/project.ts';
const root=new URL('../',import.meta.url).pathname,temp=await mkdtemp(join(tmpdir(),'shallow-notes-'));
let phase='before',finalResults=[],failure,requestId=0,phaseRequest=0,empty=false;
const api=createServer(async(req,res)=>{try{
 let raw='';for await(const p of req)raw+=p;const body=JSON.parse(raw);assert.equal(body.max_tokens,16384);
 const results=(body.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_result');
 const data=results.map(r=>{try{return JSON.parse(r.content[0].text);}catch{return null;}});
 const last=data.at(-1);let tool;
 for(const r of results)assert.ok(!r.is_error,JSON.stringify(r));
 const step=phaseRequest++;empty=false;
 const inspect=()=>({name:'inspect_notes',input:{channel:'midi-channel-8',summaryOnly:true}});
 const transpose=()=>{assert.equal(last.trackTotal,1584);assert.equal(last.notes.length,0);return {name:'transpose_notes',input:{channel:'midi-channel-8',revision:last.revision,semitones:-12}};};
 if(phase==='before'){
  if(step===0)tool=inspect();
  if(step===1)empty=true;
  if(step===2){assert.ok(JSON.stringify(body.messages).includes('Automatic continuation after max-tokens'));tool=transpose();}
  if(step===3){assert.equal(last.updated,1584);assert.deepEqual(last.pitchRange,[60,75]);}
 }else if(phase==='after'){
  if(step===0)tool=inspect();
  if(step===1)tool=transpose();
  if(step===2)empty=true;
  if(step===3){assert.ok(JSON.stringify(body.messages).includes('Automatic continuation after max-tokens'));assert.equal(last.updated,1584);assert.deepEqual(last.pitchRange,[60,75]);}
 }
 if(phase==='bars'){
  if(step===0)tool={name:'inspect_notes',input:{channel:'midi-channel-8',bar:2}};
  if(step===1){assert.equal(last.barRange.bar,2);tool={name:'edit_notes',input:{channel:'midi-channel-8',bar:2,revision:last.revision,update:[{id:last.notes[0].id,velocity:70}]}};}
  if(step===2){assert.equal(last.barRange.bar,2);assert.equal(last.notes[0].velocity,70);tool={name:'inspect_notes',input:{channel:'midi-channel-8',bar:3}};}
  if(step===3)tool={name:'edit_notes',input:{channel:'midi-channel-8',bar:3,revision:last.revision,update:[{id:last.notes[0].id,velocity:71}]}};
  if(step===4){assert.equal(last.barRange.bar,3);assert.equal(last.notes[0].velocity,71);}
 }
 if(phase==='functions'){
  const summary=bar=>({name:'inspect_notes',input:{channel:'midi-channel-8',bar,summaryOnly:true}});
  const transform=(bar,operation,extra={})=>({name:'transform_notes',input:{channel:'midi-channel-8',bar,revision:last.revision,operation,...extra}});
  if(step===0)tool=summary(2);
  if(step===1)tool=transform(2,'quantize',{gridTicks:24});
  if(step===2){assert.ok(last.notes.every(n=>n.tick%24===0));tool=summary(3);}
  if(step===3)tool=transform(3,'scale_velocity',{factor:.5});
  if(step===4){assert.equal(last.notes[0].velocity,36);tool=summary(2);}
  if(step===5)tool=transform(2,'duplicate',{destinationBar:105});
  if(step===6){assert.equal(last.barRange.bar,105);assert.equal(last.added,16);tool=summary(105);}
  if(step===7)tool=transform(105,'delete');
  if(step===8){assert.equal(last.removed,16);assert.equal(last.total,0);}
 }
 if(phase==='multi'){
  if(step<15){const bar=4+Math.floor(step/3);if(step%3===0)tool={name:'inspect_notes',input:{channel:'midi-channel-8',bar,summaryOnly:true}};
   if(step%3===1)tool={name:'transform_notes',input:{channel:'midi-channel-8',bar,revision:last.revision,operation:'set_velocity',velocity:60+bar}};
   if(step%3===2){assert.equal(last.barRange.bar,bar);assert.ok(last.notes.every(n=>n.velocity===60+bar));empty=true;}
  }
 }
 if(phase==='stall')empty=true;
 if(phase==='resume')assert.ok(JSON.stringify(body.messages).includes('Automatic continuation after max-tokens'));
 finalResults=data;
 if(phase==='multi'&&step===15)await new Promise(resolve=>setTimeout(resolve,250));
 res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify({type:event,...data})}\n\n`);
 send('message_start',{message:{id:`notes-${++requestId}`,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}});
 const partial=phase==='multi'&&step===5;
 if(tool){send('content_block_start',{index:0,content_block:{type:'tool_use',id:`notes-tool-${requestId}`,name:tool.name,input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}});}else if(!empty||partial){send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:partial?'Partial text before token limit':`TRANSPOSE_${phase}_PASS`}});}
 if(!empty||partial)send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:empty?'max_tokens':tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{});res.end();
 }catch(e){console.error(e);failure=e;res.writeHead(500);res.end(String(e));}});
let vite,browser;
try{
 await new Promise(r=>api.listen(0,'127.0.0.1',r));
 process.env.SHALLOWGROOVE_MAX_TOKENS='16384';process.env.SHALLOWGROOVE_DATA_DIR=temp;process.env.DEEPSEEK_API_KEY='local-note-test-key';process.env.DEEPSEEK_BASE_URL=`http://127.0.0.1:${api.address().port}`;
 vite=await createVite({plugins:[multitrackFixture()],root,server:{host:'127.0.0.1',port:0}});await vite.listen();
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(vite.resolvedUrls.local[0]);await page.locator('[data-example="DaisyBell"]').click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled({timeout:120000});
 await page.evaluate(()=>{window.continuationStatuses=[];new MutationObserver(()=>{const text=document.querySelector('.assistant-working')?.textContent;if(text?.includes('自动继续'))window.continuationStatuses.push(text);}).observe(document.body,{subtree:true,childList:true,characterData:true});});
 await page.getByRole('button',{name:'Select channel 8',exact:true}).click();
 async function request(){await page.getByLabel('Message assistant').fill('midi的notes的话可以低一个八度么？');await page.getByRole('button',{name:'发送 ↑',exact:true}).click();await expect(page.getByText(`TRANSPOSE_${phase}_PASS`,{exact:true})).toBeVisible({timeout:180000});assert.ifError(failure);assert.equal(phaseRequest,phase==='multi'?16:phase==='functions'?9:phase==='bars'?5:4);}
 await request();await page.getByLabel('Undo',{exact:true}).click();await expect(page.getByLabel('Redo',{exact:true})).toBeEnabled({timeout:120000});
 phase='after';phaseRequest=0;await request();
 phase='bars';phaseRequest=0;await request();
 phase='functions';phaseRequest=0;await request();
 phase='multi';phaseRequest=0;await request();
 const statuses=await page.evaluate(()=>window.continuationStatuses);assert.ok(statuses.some(t=>t.includes('第 6 段')),JSON.stringify([...new Set(statuses)]));
 phase='stall';phaseRequest=0;await page.getByLabel('Message assistant').fill('继续未完成的小节');await page.getByRole('button',{name:'发送 ↑',exact:true}).click();await expect(page.getByRole('button',{name:'继续未完成任务',exact:true})).toBeVisible({timeout:120000});assert.equal(phaseRequest,3);
 phase='resume';phaseRequest=0;await page.getByRole('button',{name:'继续未完成任务',exact:true}).click();await expect(page.getByText('TRANSPOSE_resume_PASS',{exact:true})).toBeVisible({timeout:120000});assert.equal(phaseRequest,1);assert.ifError(failure);
 const download=page.waitForEvent('download');await page.locator('.project-filebar').getByRole('button',{name:'导出 ZIP',exact:true}).click();const file=await download,saved=parseFile(unzipDocument(await readFile(await file.path()))),notes=notesOf(saved.session.project.tracks[7],saved.session.project.timing.end_tick);assert.equal(notes.length,1584);assert.deepEqual([Math.min(...notes.map(n=>n.pitch)),Math.max(...notes.map(n=>n.pitch))],[60,75]);assert.equal(saved.history.entries.filter(e=>e.label.includes('Notes')).length,12);assert.deepEqual(errors,[]);
 console.log('PASS five automatic continuations with partial-text truncation, no duplicate edits, visible progress, stalled continuation and resume button; real SDK max-tokens empty recovery before/after mutation, 1584-note transpose once, undo, compact results, two successive bar edits, quantize/velocity/duplicate/delete tools, configured token budget and saved pitches');
}catch(e){throw failure??e;}finally{await browser?.close();await vite?.close();await new Promise(r=>api.close(r));await rm(temp,{recursive:true,force:true});}
