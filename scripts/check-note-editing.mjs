// Real SDK + browser + audio engine. Only the remote model is replaced with deterministic tool requests.
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as createVite} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {parseFile} from '../src/model/session.ts';
import {notesOf} from '../src/model/project.ts';
const root=new URL('../',import.meta.url).pathname,temp=await mkdtemp(join(tmpdir(),'shallow-notes-'));
let phase='edit',finalResults=[],failure,requestId=0;
const api=createServer(async(req,res)=>{try{
 let raw='';for await(const p of req)raw+=p;const body=JSON.parse(raw);
 const results=(body.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_result');
 const data=results.map(r=>{try{return JSON.parse(r.content[0].text);}catch{return null;}});
 const last=data.at(-1);let tool;
 if(phase==='edit'){
  for(const r of results)assert.ok(!r.is_error,JSON.stringify(r));
  const steps=[
   ()=>({name:'add_track',input:{name:'Note editing check'}}),
   ()=>({name:'inspect_notes',input:{}}),
   ()=>{assert.equal(last.trackTotal,0);return {name:'edit_notes',input:{revision:last.revision,add:[{tick:0,end:480,pitch:60,velocity:90},{tick:480,end:960,pitch:64,velocity:80},{tick:960,end:1440,pitch:67,velocity:70}]}};},
   ()=>({name:'inspect_notes',input:{}}),
   ()=>{assert.deepEqual(last.notes.map(n=>n.pitch),[60,64,67]);return {name:'edit_notes',input:{revision:last.revision,update:[{id:last.notes[0].id,pitch:72,end:720,velocity:100}],remove:[last.notes[1].id]}};},
   ()=>({name:'undo_project',input:{}}),
   ()=>({name:'inspect_notes',input:{}}),
   ()=>{assert.deepEqual(last.notes.map(n=>n.pitch),[60,64,67]);return {name:'redo_project',input:{}};},
   ()=>({name:'inspect_notes',input:{}}),
   ()=>{assert.deepEqual(last.notes.map(n=>[n.pitch,n.end,n.velocity]),[[72,720,100],[67,1440,70]]);return {name:'seek_transport',input:{seconds:0}};},
   ()=>({name:'play_project',input:{}}),
   ()=>({name:'inspect_notes',input:{}}),
   ()=>({name:'edit_notes',input:{revision:last.revision,update:[{id:last.notes[0].id,pitch:74}]}}),
   ()=>({name:'inspect_selection',input:{}}),
   ()=>{assert.equal(last.playing,true);return {name:'pause_playback',input:{}};},
   ()=>({name:'export_project',input:{includeHistory:true}}),
  ];tool=steps[results.length]?.();finalResults=data;
 }else{
  if(results.length===0)tool={name:'inspect_notes',input:{}};
  if(results.length===1){assert.equal(last.notes[0].pitch,74);tool={name:'edit_notes',input:{revision:last.revision,update:[{id:last.notes[0].id,pitch:75}]}};}
  if(results.length===2){assert.ok(!results[1].is_error,JSON.stringify(results[1]));tool={name:'inspect_notes',input:{}};}
  if(results.length===3){assert.equal(last.trackTotal,2);assert.equal(last.notes[0].pitch,75);}
 }
 res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify({type:event,...data})}\n\n`);
 send('message_start',{message:{id:`notes-${++requestId}`,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}});
 if(tool){send('content_block_start',{index:0,content_block:{type:'tool_use',id:`notes-tool-${requestId}`,name:tool.name,input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}});}else {send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:`NOTE_CHECK_${phase}_PASS`}});}
 send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{});res.end();
 }catch(e){console.error(e);failure=e;res.writeHead(500);res.end(String(e));}});
let vite,browser;
try{
 await new Promise(r=>api.listen(0,'127.0.0.1',r));
 process.env.SHALLOWGROOVE_DATA_DIR=temp;process.env.DEEPSEEK_API_KEY='local-note-test-key';process.env.DEEPSEEK_BASE_URL=`http://127.0.0.1:${api.address().port}`;
 vite=await createVite({root,server:{host:'127.0.0.1',port:0}});await vite.listen();
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(vite.resolvedUrls.local[0]);await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled({timeout:120000});
 await expect(page.getByRole('button',{name:/^(协作 · 可编辑|仅讨论 · 不修改)$/})).toHaveCount(0);
 const downloads=[];page.on('download',d=>downloads.push(d));
 await page.getByLabel('Message assistant').fill('Add a track, write a phrase, edit its notes, undo and redo, audition, and export.');
 await page.getByRole('button',{name:'发送 ↑',exact:true}).click();
 await expect(page.getByText('NOTE_CHECK_edit_PASS',{exact:true})).toBeVisible({timeout:240000});
 assert.equal(downloads.length,1);const file=downloads[0];const saved=parseFile(await readFile(await file.path(),'utf8'));const track=saved.session.project.tracks.at(-1);
 assert.equal(track.name,'Note editing check');assert.deepEqual(notesOf(track,saved.session.project.timing.end_tick).map(n=>[n.pitch,n.end,n.velocity]),[[74,720,100],[67,1440,70]]);
 assert.ok(saved.history.entries.some(e=>e.label.includes('Notes')));assert.equal(finalResults.length,16);
 // Reload and import the exported file through the actual UI.
 await page.reload();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled({timeout:120000});
 await page.getByRole('button',{name:'历史 / 保存',exact:true}).click();
 const input=page.locator('input[type=file]');await input.setInputFiles(await file.path());
 await expect(page.getByRole('button',{name:'Select channel '+saved.session.project.tracks.length,exact:true})).toBeVisible({timeout:120000});
 await page.getByRole('button',{name:'Select channel '+saved.session.project.tracks.length,exact:true}).click();
 await page.getByRole('button',{name:'历史 / 保存',exact:true}).click();
 phase='reimport';await page.getByLabel('Message assistant').fill('Inspect the imported notes and raise the first note by one semitone.');await page.getByRole('button',{name:'发送 ↑',exact:true}).click();
 await expect(page.getByText('NOTE_CHECK_reimport_PASS',{exact:true})).toBeVisible({timeout:120000});
 assert.ifError(failure);assert.deepEqual(errors,[]);console.log('PASS: real SDK note add/update/remove, undo/redo, playback after edit, export/import, and unified collaboration without mode switches');
}catch(e){throw failure??e;}finally{await browser?.close();await vite?.close();await new Promise(r=>api.close(r));await rm(temp,{recursive:true,force:true});}
