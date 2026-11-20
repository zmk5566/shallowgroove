// Real SDK + browser + audio engine. Only the remote model is replaced with deterministic tool requests.
import {createServer} from 'node:http';
import {WebSocket} from 'ws';
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
 for(const r of results)assert.ok(!r.is_error,JSON.stringify(r));
 const steps=[
 ()=>({name:'set_project_tempo',input:{bpm:135.5}}),
 ()=>{assert.equal(last.bpm,135.5);return {name:'set_automation',input:{channel:'master',device:'mixer',address:'bpm',points:[{tick:0,value:100/280},{tick:960,value:220/280}]}};},
 ()=>({name:'inspect_selection',input:{}}),
 ()=>{assert.equal(last.tempo.source,'automation');assert.equal(last.tempo.target.address,'bpm');return {name:'set_project_tempo',input:{bpm:140}};},
 ()=>({name:'inspect_selection',input:{}}),
 ()=>{assert.equal(last.tempo.source,'override');assert.equal(last.tempo.automation.mode,'off');return {name:'set_automation',input:{channel:'master',device:'mixer',address:'bpm',mode:'read'}};},
 ];tool=steps[results.length]?.();finalResults=data;
 res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify({type:event,...data})}\n\n`);
 send('message_start',{message:{id:`notes-${++requestId}`,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}});
 if(tool){send('content_block_start',{index:0,content_block:{type:'tool_use',id:`notes-tool-${requestId}`,name:tool.name,input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}});}else {send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:`TEMPO_CHECK_PASS`}});}
 send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});send('message_stop',{});res.end();
 }catch(e){console.error(e);failure=e;res.writeHead(500);res.end(String(e));}});
let vite,browser,connector;
try{
 await new Promise(r=>api.listen(0,'127.0.0.1',r));
 process.env.SHALLOWGROOVE_DATA_DIR=temp;process.env.DEEPSEEK_API_KEY='local-note-test-key';process.env.DEEPSEEK_BASE_URL=`http://127.0.0.1:${api.address().port}`;
 vite=await createVite({root,server:{host:'127.0.0.1',port:0}});await vite.listen();
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(vite.resolvedUrls.local[0]);await page.getByRole('button',{name:'新建项目',exact:true}).click();await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled({timeout:120000});
 const bpm=page.getByRole('spinbutton',{name:'Project BPM'});await expect(bpm).toHaveAttribute('aria-valuenow','120');
 await bpm.dblclick();await page.getByLabel('Enter BPM').fill('137.5');await page.getByLabel('Enter BPM').press('Enter');await expect(bpm).toHaveAttribute('aria-valuenow','137.5');
 let box=await bpm.boundingBox();await page.mouse.move(box.x+30,box.y+15);await page.mouse.down();await page.mouse.move(box.x+70,box.y+15,{steps:5});await page.mouse.up();await expect(bpm).toHaveAttribute('aria-valuenow','147.5');
 await page.getByLabel('Undo',{exact:true}).click();await expect(bpm).toHaveAttribute('aria-valuenow','137.5',{timeout:120000});
 box=await bpm.boundingBox();await page.mouse.move(box.x+30,box.y+15);await page.mouse.down();await page.mouse.move(box.x+70,box.y+15,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await expect(bpm).toHaveAttribute('aria-valuenow','137.5');
 await bpm.dblclick();await page.getByLabel('Enter BPM').fill('500');await page.getByLabel('Enter BPM').press('Enter');await expect(bpm).toHaveAttribute('aria-valuenow','137.5');
 await page.getByLabel('Restore MIDI tempo').click();await expect(bpm).toHaveAttribute('aria-valuenow','120');
 await bpm.click({button:'right'});await page.getByRole('dialog',{name:'Parameter actions'}).getByRole('button',{name:'Automation',exact:true}).click();await expect(page.getByLabel('Automation parameter')).toHaveValue('['+'"mixer","bpm"'+']');
 await page.getByLabel('Message assistant').fill('Check tempo and tempo automation.');await page.getByRole('button',{name:'发送 ↑',exact:true}).click();await expect(page.getByText('TEMPO_CHECK_PASS',{exact:true})).toBeVisible({timeout:240000});assert.ifError(failure);assert.equal(finalResults.length,6);
 await expect(page.locator('.tempo-control')).toContainText('AUTO');await bpm.press('ArrowUp');await expect(page.getByLabel('Resume tempo automation')).toBeVisible();await page.getByLabel('Resume tempo automation').click();await expect(page.locator('.tempo-control')).toContainText('AUTO');
 connector=new WebSocket(new URL('/hexblocks/ws',vite.resolvedUrls.local[0]).href.replace('http:','ws:'));await new Promise((resolve,reject)=>{connector.once('open',resolve);connector.once('error',reject);});
 const send=value=>connector.send(JSON.stringify(value));send({type:'auth',role:'connector',id:'tempo-fixture'});send({type:'transport',connected:true,kind:'sim'});send({type:'event',event:{type:'hello',uid:'AABBCCDD',id:'Tempo Knob'}});send({type:'event',event:{type:'descriptor',uid:'AABBCCDD',data:{channels:[{id:40,label:'knob',min:0,max:1}]}}});send({type:'event',event:{type:'sensor',uid:'AABBCCDD',channel_id:40,value:.25}});await expect(page.locator('.hardware-sensor')).toHaveCount(1);
 await bpm.click({button:'right'});await page.getByRole('dialog',{name:'Parameter actions'}).getByRole('button',{name:'映射到 Hexblocks',exact:true}).click();
 await expect(page.getByLabel('Hardware target')).toHaveValue(JSON.stringify(['master','mixer','bpm']));await page.getByLabel('Hardware source').selectOption(JSON.stringify(['tempo-fixture','AABBCCDD',40]));await page.getByLabel('Hardware output min').fill('60');await page.getByLabel('Hardware output max').fill('180');await page.getByLabel('Create hardware mapping').click();await expect(bpm).toHaveAttribute('aria-valuenow','90',{timeout:10000});await expect(page.locator('.tempo-control')).toContainText('HEX');send({type:'event',event:{type:'sensor',uid:'AABBCCDD',channel_id:40,value:.75}});await expect(bpm).toHaveAttribute('aria-valuenow','150',{timeout:10000});send({type:'transport',connected:false});await expect(page.locator('.tempo-control')).toContainText('AUTO');await expect(bpm).toHaveAttribute('aria-valuenow','120');

 const result=await page.evaluate(async()=>{
 const {AudioEngine}=await import('/src/audio/engine.ts'),{secondsToTick}=await import('/src/model/automation.ts'),{withTempo}=await import('/src/model/tempo.ts'),{hardwareKey}=await import('/src/model/hardware.ts');
 const e=new AudioEngine(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),project={title:'Tempo test',schema:'test',timing:{ppqn:480,end_tick:9600,default_tempo_us_per_quarter:500000},global_events:[],tracks:[{id:'t',name:'Track',midi_channel:1,gain:1,pan:0,mute:false,solo:false,events:[{tick:0,order:0,kind:'midi',status:144,data:[60,90]},{tick:9600,order:1,kind:'midi',status:128,data:[60,0]}]}],automation:[{id:'bpm',trackId:'master',device:'mixer',address:'bpm',label:'BPM',min:20,max:300,step:.01,scale:'linear',mode:'read',interpolation:'linear',points:[{tick:0,value:100/280},{tick:9600,value:220/280}]}]};
 try{await e.initialize(project);await e.play();await sleep(200);const before=secondsToTick(e.timingProject,e.position);e.setTempoProject(withTempo(e.project,90));const after=secondsToTick(e.timingProject,e.position),stillPlaying=e.playing;await sleep(160);const sounding=e.level(0);
 const mapping={id:'hw',connectorId:'fixture',uid:'AABBCCDD',channel:40,trackId:'master',device:'mixer',address:'bpm',label:'BPM',inputMin:0,inputMax:1,outputMin:60,outputMax:200,curve:'linear',invert:false,smoothingMs:0,enabled:true};e.applyHardware(mapping,180);const hardware=e.bpm,source=e.tempoSource,stored=e.project.timing.bpm;await sleep(100);e.releaseHardware(hardwareKey(mapping));const restored=e.bpm;
 e.setAutomationProject(project);const autoBefore=e.bpm;e.applyHardware(mapping,160);e.releaseHardware(hardwareKey(mapping));const autoRestored=e.bpm,autoSource=e.tempoSource;
 e.pause();const smooth={...mapping,smoothingMs:200};e.applyHardware(smooth,200);const first=e.bpm;for(let i=0;i<12;i++){await sleep(90);e.applyHardware(smooth,200);}const last=e.bpm;e.releaseHardware(hardwareKey(mapping));return {before,after,stillPlaying,sounding,hardware,source,stored,restored,autoBefore,autoRestored,autoSource,first,last};
 }finally{await e.dispose();}
 });assert.ok(Math.abs(result.before-result.after)<5,JSON.stringify(result));assert.equal(result.stillPlaying,true);assert.ok(result.sounding>0,JSON.stringify(result));assert.equal(result.hardware,180);assert.equal(result.source,'hardware');assert.equal(result.stored,90);assert.equal(result.restored,90);assert.equal(result.autoSource,'automation');assert.ok(Math.abs(result.autoBefore-result.autoRestored)<1);assert.ok(result.first<200&&result.last>199,JSON.stringify(result));
 await page.screenshot({path:'/private/tmp/shallow-tempo.png'});assert.deepEqual(errors,[]);console.log('PASS BPM input/drag/cancel/undo, automation and mapping menus, native SDK tempo and automation, live tempo retiming with held notes, hardware priority/release/smoothing',result);
}catch(e){throw failure??e;}finally{connector?.terminate();await browser?.close();await vite?.close();await new Promise(r=>api.close(r));await rm(temp,{recursive:true,force:true});}
