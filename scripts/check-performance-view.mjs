// Drive the real Assistant, browser audio engine and project library using deterministic assistant turns.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';

const temp=await mkdtemp(join(tmpdir(),'sg-performance-'));
process.env.SHALLOWGROOVE_DATA_DIR=temp;
const vite=await createServer({root:new URL('../',import.meta.url).pathname,server:{host:'127.0.0.1',port:0}});
let browser;
try{
 await vite.listen();
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 // Replace only the hardware boundary. Observe the messages posted to real AudioWorklet nodes.
 await page.addInitScript(()=>{
  let oscListener;
  window.sgOsc={status:async()=>({endpoints:[{id:'default',name:'Max',enabled:true,port:9000,host:'127.0.0.1'},{id:'pd',name:'Pd',enabled:true,port:9001,host:'127.0.0.1'}]}),onMessages(fn){oscListener=fn;return ()=>{oscListener=undefined;};}};
  window.testOsc=(args,endpointId='default')=>oscListener(args.map(([address,...values])=>({endpointId,address,args:values,time:Date.now()})));
  const inputs=new Map(['keys','unused'].map(id=>{
   const port=Object.assign(new EventTarget(),{id,name:id==='keys'?'Studio Keys':'Unpatched Keys',type:'input',state:'connected',open:async()=>port});
   return [id,port];
  }));
  const access=Object.assign(new EventTarget(),{inputs});
  Object.defineProperty(navigator,'requestMIDIAccess',{value:async()=>access});
  window.sendTestMidi=(id,data)=>inputs.get(id).dispatchEvent(Object.assign(new Event('midimessage'),{data:Uint8Array.from(data)}));
  window.workletMidi=[];
  const Worklet=window.AudioWorkletNode;
  window.AudioWorkletNode=class extends Worklet{
   constructor(...args){
    super(...args);
    const post=this.port.postMessage.bind(this.port);
    this.port.postMessage=(message,...rest)=>{
     if(message.type==='midi')window.workletMidi.push({data:Array.from(message.data),state:this.context.state});
     return post(message,...rest);
    };
   }
  };
 });
 let command,serial=0,ack,snapshot;
 await page.route('**/api/assistant/**',async route=>{
  const endpoint=new URL(route.request().url()).pathname.split('/').pop();
  if(endpoint==='status')return route.fulfill({json:{configured:true,token:'test'}});
  if(endpoint==='turn'){
   snapshot=route.request().postDataJSON().context;
   const events=[{type:'tool',id:String(serial),command},{type:'reply',text:'Performance check '+serial}];
   return route.fulfill({contentType:'application/x-ndjson',body:events.map(e=>JSON.stringify(e)+'\n').join('')});
  }
  if(endpoint==='result'){ack=route.request().postDataJSON();return route.fulfill({json:{ok:true}});}
  return route.fulfill({json:[]});
 });
 async function run(action,fields={}){
  command={action,...fields};ack=null;serial++;
  await page.getByLabel('Message assistant').fill('Run workspace check '+serial);
  await page.getByRole('button',{name:'发送 ↑',exact:true}).click();
  await expect(page.getByText('Performance check '+serial,{exact:true})).toBeVisible({timeout:60000});
  assert.ok(ack,action);assert.ok(!ack.error,action+' '+ack.error);
  return ack.result;
 }
 const inspect=section=>run('inspect_workspace',{section,limit:64});
 const edit=edit=>run('edit_performance',{edit});
 await page.goto(vite.resolvedUrls.local[0]);
 await page.getByRole('button',{name:'新建项目',exact:true}).click();
 await expect(page.getByLabel('Play',{exact:true})).toBeEnabled({timeout:120000});
 for(const [view,label] of [['session','现场'],['arrangement','编曲'],['performance','演奏']]){
  if(view==='performance'){
   const performanceButton=page.locator('.view-switch').getByRole('button',{name:'演奏'});
   await performanceButton.click();await page.getByRole('button',{name:'取消',exact:true}).click();
   await expect(page.getByLabel('Play',{exact:true})).toBeVisible();
   await page.getByLabel('Play',{exact:true}).click();
   await performanceButton.click();await page.getByRole('button',{name:'取消',exact:true}).click();
   await expect(page.getByLabel('Play',{exact:true})).toHaveAttribute('aria-pressed','true');
   const enter=run('set_workspace_view',{view});
   await page.getByRole('button',{name:'停止并进入',exact:true}).click();await enter;
   const dsp=page.getByRole('button',{name:'DSP',exact:true});
   await expect(dsp).toHaveAttribute('aria-pressed','false');
   await expect(page.getByLabel('Play',{exact:true})).toHaveCount(0);
   assert.equal((await inspect('overview')).performance.dsp,false);
   assert.equal(snapshot.workspace.performance.dsp,false);
   await dsp.click();await expect(dsp).toHaveAttribute('aria-pressed','true');
  }else await run('set_workspace_view',{view});
  await expect(page.locator('.view-switch').getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
  const overview=await inspect('overview');
  assert.equal(overview.view,view);
  assert.equal(overview.performance.dsp,view==='performance'?true:null);
  assert.equal(snapshot.workspace.performance.dsp,overview.performance.dsp);
  if(view==='arrangement'){
   assert.ok(await page.locator('.track-arm').count()>0);
   await expect(page.locator('.track-arm[aria-pressed=true]')).toHaveCount(0);
  }
 }
 await page.getByRole('button',{name:'Learn',exact:true}).click();
 const learn=page.getByRole('dialog',{name:'Learn'});
 await expect(learn.getByRole('status').first()).toContainText('等待');
 await page.evaluate(()=>{window.testOsc([['/learn',.25,.5],['/learn',.75,.5]],'pd');});
 await expect(learn.locator('label')).toHaveCount(2);
 await expect.poll(async()=>{await page.evaluate(()=>window.sendTestMidi('keys',[0xb2,74,99]));return learn.locator('label').count();}).toBe(3);
 await learn.getByRole('button',{name:'停止 Learn'}).click();
 await page.evaluate(()=>window.testOsc([['/after',42]],'pd'));
 await expect(learn.locator('label')).toHaveCount(3);
 await learn.locator('label').filter({hasText:'UDP 9001 · /learn [0]'}).getByRole('checkbox').check();
 await learn.locator('label').filter({hasText:'Ch 3 · CC 74'}).getByRole('checkbox').check();
 await learn.getByRole('button',{name:/添加选中项/}).click();
 const learned=(await inspect('nodes')).items;
 assert.ok(learned.some(n=>n.kind==='osc-input'&&n.endpointId==='pd'&&n.argument===0&&n.address==='/learn'));
 assert.ok(learned.some(n=>n.kind==='midi-control'&&n.channel===3&&n.controller===74&&n.midiDeviceId==='keys'));
 assert.equal(learned.length,2);
 await run('undo');await expect(page.locator('.perf-card')).toHaveCount(0);
 const canvas=page.locator('.perf-viewport');
 await canvas.click({button:'right',position:{x:74,y:53}});
 const picker=page.getByRole('dialog',{name:'添加节点'});
 await picker.getByRole('searchbox').fill('remap');
 await picker.getByRole('searchbox').press('Enter');
 const inserted=(await inspect('nodes')).items.find(n=>n.kind==='remap');
 assert.deepEqual(inserted.position,{x:74,y:53});
 await run('undo');
 await expect(page.locator('.perf-remap')).toHaveCount(0);
 await page.getByRole('button',{name:'添加到画布'}).click();
 await picker.getByRole('button',{name:/^输入/}).click();
 await expect(picker.getByRole('button',{name:/HexBlocks/})).toBeDisabled();
 await page.keyboard.press('Escape');
 await edit({op:'put_node',node:{id:'saved-sensor',kind:'sensor',name:'Knob',uid:'C0FFEE01',channel:0}});
 await page.getByRole('button',{name:'添加到画布'}).click();
 await picker.getByRole('button',{name:/^输入/}).click();
 await picker.getByRole('button',{name:/HexBlocks/}).click();
 await expect(picker.getByRole('button',{name:'未绑定传感器'})).toHaveCount(0);
 await picker.getByRole('button',{name:/C0FFEE01/}).click();
 await picker.getByRole('button',{name:/离线/}).click();
 const binding=page.getByLabel('HexBlocks 输入引用');
 await expect(binding.getByRole('option',{name:'未绑定',exact:true})).toBeDisabled();
 const savedRef=JSON.stringify(['C0FFEE01',0]);
 await expect(binding.locator('option').last()).toContainText('离线');
 await expect(binding).toHaveValue(savedRef);
 const referenced=(await inspect('nodes')).items.filter(n=>n.kind==='sensor');
 assert.equal(referenced.length,2);
 assert.ok(referenced.every(n=>n.uid==='C0FFEE01'&&n.channel===0));
 for(const node of referenced)await edit({op:'remove_node',id:node.id});
 const added=await run('add_effect',{kind:'delay'});
 const control=(await inspect('controls')).items.find(p=>p.device===added.deviceId&&p.label==='Feedback');
 assert.ok(control,JSON.stringify(added));
 const knob={id:'intensity',kind:'knob',name:'Intensity',value:.25};
 const effect={id:'target',kind:'effect',name:'Delay control',trackId:control.trackId,device:control.device};
 await edit({op:'put_node',node:knob});
 await edit({op:'put_node',node:effect});
 await edit({op:'move_node',id:knob.id,x:48,y:45});
 await expect(page.locator('#devices-content')).toHaveCount(0);
 await page.locator('.perf-effect .perf-device-open').click();
 await expect(page.locator('.performance-device-editor[open] .effect-card')).toHaveCount(1);
 await expect(page.locator('.performance-device-editor .device-chain')).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(page.locator('.performance-device-editor')).toHaveCount(0);
 const output=page.locator('.perf-knob .perf-port.output');
 const feedback=page.locator('.perf-effect .perf-parameter-input').filter({hasText:'Feedback'});
 await expect(feedback).toBeVisible();
 const feedbackRow=page.locator('.perf-effect .perf-input-row').filter({hasText:'Feedback'});
 const manualFeedback=feedbackRow.locator('input');
 await manualFeedback.fill(String(control.min));await manualFeedback.press('Enter');
 assert.equal((await inspect('controls')).items.find(p=>p.device===control.device&&p.address===control.address).value,control.min);
 const start=await output.boundingBox(),end=await feedback.boundingBox();
 await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();
 await page.mouse.move(end.x+12,end.y+end.height/2,{steps:8});
 await expect(feedback).toHaveAttribute('data-drop-target','true');
 await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
 await expect(page.locator('[data-drop-target]')).toHaveCount(0);
 await page.mouse.move(end.x+12,end.y+end.height/2);
 await expect(page.locator('.perf-cable-preview')).toBeVisible();await page.mouse.up();
 await expect(page.locator('[data-drop-target]')).toHaveCount(0);
 assert.equal((await inspect('links')).items[0].address,control.address);
 await expect(page.locator('.perf-card')).toHaveCount(2);
 await expect(page.locator('.perf-wires g')).toHaveCount(1);
 await run('undo');await expect(page.locator('.perf-wires g')).toHaveCount(0);
 await run('redo');await expect(page.locator('.perf-wires g')).toHaveCount(1);
 const wire=page.locator('.perf-wire-hit');
 const midpoint=await wire.evaluate(path=>{
  const p=path.getPointAtLength(path.getTotalLength()/2).matrixTransform(path.getScreenCTM());
  return {x:p.x,y:p.y};
 });
 await page.mouse.click(midpoint.x,midpoint.y);
 await expect(page.locator('.perf-wires .is-selected')).toHaveCount(1);
 await page.locator('.perf-editor input').first().press('Delete');
 await expect(wire).toHaveCount(1);
 await page.mouse.click(midpoint.x,midpoint.y);await page.keyboard.press('Delete');
 await expect(wire).toHaveCount(0);
 await run('undo');await expect(wire).toHaveCount(1);
 const handle=page.locator('.perf-knob .perf-handle'),box=await handle.boundingBox();
 const x=Math.floor(box.x+box.width/2),y=Math.floor(box.y+box.height/2);
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+49,y+31,{steps:6});await page.mouse.up();
 const placed=(await inspect('nodes')).items.find(n=>n.id===knob.id);
 assert.deepEqual(placed.position,{x:97,y:76});
 await page.getByRole('slider',{name:'Intensity'}).fill('0.75');
 const actual=(await inspect('links')).items[0].liveValue;
 const expected=control.min+.75*(control.max-control.min);
 assert.ok(Math.abs(actual-expected)<=(control.max-control.min)*.01,JSON.stringify({control,actual,expected}));
 const current=(await inspect('controls')).items.find(p=>p.device===control.device&&p.address===control.address);
 assert.equal(current.value,actual);
 await page.getByRole('button',{name:'刷新 MIDI'}).click();
 const devices=(await inspect('midiInputs')).items;
 assert.deepEqual(devices,[{id:'keys',name:'Studio Keys',enabled:true},{id:'unused',name:'Unpatched Keys',enabled:true}]);
 await page.getByRole('button',{name:'添加到画布'}).click();
 await picker.getByRole('button',{name:/^输入/}).click();
 await picker.getByRole('button',{name:/^OSC/}).click();
 await expect(picker.getByRole('button',{name:'消息输入',exact:true})).toBeVisible();
 const search=picker.getByRole('searchbox');
 await search.fill('OSC 消息');
 await expect(picker.locator('.perf-node-list button')).toHaveCount(1);
 await expect(picker.locator('.perf-node-list button')).toContainText('消息输入');
 await search.fill('CC');
 await expect(picker.locator('.perf-node-list button')).toContainText('控制器输入');
 await search.fill('');
 await picker.locator('.perf-node-back').click();
 await picker.getByRole('button',{name:/^MIDI/}).click();
 await picker.getByRole('button',{name:/^音符输入/}).click();
 const keyboard=(await inspect('nodes')).items.find(n=>n.kind==='midi-input');
 assert.equal(keyboard.midiDeviceId,'keys');
 const instrument=(await inspect('devices')).items.find(d=>d.device==='instrument'&&d.trackId===control.trackId);
 assert.ok(instrument);
 const pulse={id:'pulse',kind:'retrigger',name:'Clock',enabled:false,division:.5};
 const note={id:'note',kind:'note',name:'Tone',pitch:60,velocity:88,lengthMs:50};
 for(const node of [pulse,note,{id:'synth',kind:'effect',name:'Instrument',trackId:instrument.trackId,device:'instrument'}])await edit({op:'put_node',node});
 const route=(id,source,target,input)=>edit({op:'put_route',route:{id,source,target,input}});
 const inputRow=(id,input)=>page.locator('.perf-input-row').filter({has:page.locator('[data-perf-port="'+id+'"][data-input="'+input+'"]')});
 const division=inputRow('pulse','interval').getByRole('slider');
 await division.press('ArrowRight');await division.press('ArrowRight');
 await expect(division).toHaveAttribute('aria-valuetext','1/16');
 assert.equal((await inspect('nodes')).items.find(n=>n.id==='pulse').division,.25);
 await route('generated','note','synth','midi');
 await page.evaluate(()=>{window.workletMidi.length=0;});
 await inputRow('note','trigger').locator('[data-manual]').click();
 await expect.poll(()=>page.evaluate(()=>window.workletMidi.map(m=>[m.data[0]>>4,m.data[1],m.data[2]]))).toEqual([[9,60,88],[8,60,0]]);
 await route('pitch',knob.id,'note','pitch');
 await route('trigger','pulse','note','trigger');
 await page.locator('.perf-midi-input .perf-port.output').click();
 await page.locator('[data-perf-port="synth"][data-input="midi"]').click();
 let routes=(await inspect('routes')).items;
 assert.equal(routes.length,4);
 assert.ok(routes.some(r=>r.source===keyboard.id&&r.target==='synth'&&r.input==='midi'));
 async function checkKeyboard(){
  const messages=await page.evaluate(()=>{
   window.workletMidi.length=0;
   for(const id of ['unused','keys']){
    const pitch=id==='unused'?77:71;
    window.sendTestMidi(id,[0x93,pitch,107]);window.sendTestMidi(id,[0x83,pitch,0]);
   }
   return window.workletMidi;
  });
  assert.deepEqual(messages.map(m=>[m.data[0]>>4,...m.data.slice(1),m.state]),[[9,71,107,'running'],[8,71,0,'running']]);
 }
 await checkKeyboard();
 await page.locator('.perf-retrigger').getByRole('button',{name:'启动'}).click();
 await expect.poll(()=>page.evaluate(()=>window.workletMidi.filter(m=>(m.data[0]>>4)===9&&m.data[1]===95&&m.data[2]===88&&m.state==='running').length)).toBeGreaterThanOrEqual(2);
 await expect.poll(()=>page.evaluate(()=>window.workletMidi.some(m=>(m.data[0]>>4)===8&&m.data[1]===95))).toBe(true);
 await page.locator('.perf-retrigger').getByRole('button',{name:'停止'}).click();
 await expect(page.getByLabel('Play',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Record arrangement')).toHaveCount(0);
 const remap={id:'milliseconds',kind:'remap',name:'Pulse time',inMin:0,inMax:1,outMin:160,outMax:80};
 await edit({op:'put_node',node:remap});
 await edit({op:'put_node',node:{...pulse,timing:'free',intervalMs:4000}});
 const freeTime=inputRow('pulse','interval').getByRole('spinbutton');
 await division.fill('500');await expect(freeTime).toHaveValue('100');
 await freeTime.fill('3500');await freeTime.press('Enter');
 assert.equal((await inspect('nodes')).items.find(n=>n.id==='pulse').intervalMs,3500);
 await route('time-source',knob.id,remap.id,'value');
 await route('time',remap.id,'pulse','interval');
 await expect(division).toBeDisabled();
 await expect(division).toHaveAttribute('aria-valuetext','100 ms');
 await expect(division).toHaveValue('500');
 await expect(page.locator('.perf-remap')).toBeVisible();
 // The inverted range maps 0.75 to 100 ms. A disconnected/manual 4000 ms clock fails this check.
 await page.evaluate(()=>{window.workletMidi.length=0;});
 await page.locator('.perf-retrigger').getByRole('button',{name:'启动'}).click();
 await expect.poll(()=>page.evaluate(()=>window.workletMidi.filter(m=>m.data[0]>>4===9&&m.data[1]===95).length),{timeout:3000}).toBeGreaterThanOrEqual(5);
 await page.locator('.perf-retrigger').getByRole('button',{name:'停止'}).click();
 await edit({op:'remove_route',id:'time'});
 await expect(freeTime).toHaveValue('3500');await expect(division).toBeEnabled();
 await route('time',remap.id,'pulse','interval');
 routes=(await inspect('routes')).items;
 await page.getByRole('button',{name:'堆栈',exact:true}).click();
 const before=await inspect('overview');
 assert.equal(before.visual.mode,'stack');assert.ok(before.visual.viewport.width>0);
 await page.locator('.project-filebar').getByRole('button',{name:'保存',exact:true}).click();
 await page.getByLabel('Project name').fill('Performance smoke');
 await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();
 await expect(page.locator('.project-save-status')).toContainText('已保存到此浏览器');
 await page.reload();await page.getByRole('button',{name:/Performance smoke/}).click();
 await expect(page.getByLabel('DSP',{exact:true})).toHaveAttribute('aria-pressed','false',{timeout:120000});
 await page.getByLabel('DSP',{exact:true}).click();
 await expect(page.getByRole('button',{name:'堆栈',exact:true})).toHaveAttribute('aria-pressed','true');
 assert.equal((await inspect('overview')).view,'performance');
 assert.equal(snapshot.workspace.performance.visual.mode,'stack');
 const restored=(await inspect('nodes')).items.find(n=>n.id===knob.id);
 assert.deepEqual(restored.position,placed.position);assert.equal(restored.value,.75);
 assert.equal((await inspect('links')).items[0].address,control.address);
 assert.deepEqual((await inspect('routes')).items,routes);
 await page.getByRole('button',{name:'刷新 MIDI'}).click();
 await expect(page.locator('.perf-midi-input .perf-device-state')).toHaveText('已启用');
 await checkKeyboard();
 await page.getByRole('button',{name:'输入监视器'}).click();
 await page.evaluate(()=>window.testOsc([['/sg/xy',0.25,0.75]]));
 await expect(page.locator('.perf-signal').filter({hasText:'/sg/xy'})).toContainText('0.75');
 await page.getByRole('button',{name:'输入监视器'}).click();
 await edit({op:'remove_route',id:routes.find(r=>r.source===keyboard.id).id});
 await edit({op:'remove_route',id:'trigger'});
 await edit({op:'remove_route',id:'pitch'});
 for(const node of [
  {id:'pressure',name:'Pressure',kind:'midi-control',message:'cc',channel:1,controller:1,midiDeviceId:'keys'},
  {id:'edge',name:'Edge',kind:'threshold',manualValue:0,low:.4,high:.6},
  {id:'snap',name:'Scale',kind:'scale',manualValue:61,root:0,scale:'minor-pentatonic'},
  {id:'hit',name:'Hit',kind:'osc-input',address:'/sg/hit',argument:0,output:'trigger'},
  {id:'xy',name:'Pitch',kind:'osc-input',address:'/sg/hit',argument:0,output:'value'}
 ])await edit({op:'put_node',node});
 await route('cc-edge','pressure','edge','value');
 await route('gate','edge','note','gate');
 await route('scale-in','xy','snap','value');await route('snapped','snap','note','pitch');
 await page.evaluate(()=>{window.testOsc([['/sg/hit',61]]);window.workletMidi.length=0;});
 await page.waitForFunction(()=>document.querySelector('.perf-scale'));
 await page.evaluate(()=>{for(const v of [110,90,10])window.sendTestMidi('keys',[176,1,v]);});
 await expect.poll(()=>page.evaluate(()=>window.workletMidi.map(m=>[m.data[0]>>4,m.data[1]]))).toEqual([[9,60],[8,60]]);
 await edit({op:'remove_route',id:'gate'});await route('osc-hit','xy','note','trigger');
 await page.evaluate(()=>{window.workletMidi.length=0;window.testOsc([['/sg/hit',48]],'pd');window.testOsc([['/sg/hit',62.8],['/sg/hit',62.8]]);});
 await expect.poll(()=>page.evaluate(()=>window.workletMidi.map(m=>[m.data[0]>>4,m.data[1]]))).toEqual([[9,63],[8,63],[9,63],[8,63]]);
 await edit({op:'put_node',node:{id:'tempo',kind:'set-bpm',name:'Set BPM'}});
 const tempoCard=page.locator('.perf-set-bpm');
 const tempoEntry=tempoCard.locator('input[type=number]');
 await tempoEntry.fill('111');await tempoEntry.press('Enter');
 await expect(tempoEntry).toHaveValue('111');
 await route('live-tempo','xy','tempo','bpm');
 await page.evaluate(()=>window.testOsc([['/sg/hit',145]]));
 await expect(tempoCard.locator('.perf-driven output')).toHaveText('145');
 await edit({op:'remove_route',id:'live-tempo'});
 await expect.poll(async()=>Number(await tempoEntry.inputValue())).toBeCloseTo(111,2);
 assert.deepEqual(errors,[]);
 console.log('PASS assistant navigation in all three views, graph edits with undo/redo, drag readback, live effect value, routed keyboard and knob-pitched retriggers reaching the Faust worklet with transport stopped, saved and reopened routes and stack mode.');
}finally{
 await browser?.close();await vite.close();await rm(temp,{recursive:true,force:true});
}
