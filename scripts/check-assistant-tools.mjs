import {createServer as createHTTP} from 'node:http';
import {createServer as createVite} from 'vite';
import {firefox,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname;let calls=0,toolNames=[];const requests=[];
const api=createHTTP(async(req,res)=>{let raw='';for await(const p of req)raw+=p;const body=JSON.parse(raw||'{}');requests.push({url:req.url,body});calls++;toolNames=(body.tools??[]).map(t=>t.name);
 const results=body.messages?.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_result')??[];
 const steps=[
 {name:'inspect_selection',input:{}},
 {name:'set_channel_mix',input:{channel:'5',gain:.7,pan:-.2,mute:false,solo:false}},
 {name:'set_automation',input:{channel:'5',device:'mixer',address:'send.reverb',points:[{tick:0,value:1},{tick:960,value:0}]}},
 {name:'set_automation',input:{channel:'9',device:'mixer',address:'send.reverb',points:[{tick:0,value:0},{tick:960,value:1}]}},
 {name:'seek_transport',input:{seconds:1}},
 {name:'set_transport_loop',input:{enabled:true}},
 {name:'add_audio_effect',input:{kind:'compressor'}},
 {name:'add_audio_effect',input:{kind:'delay'}},
 {name:'move_audio_effect',input:{position:1}},
 {name:'bypass_audio_effect',input:{bypassed:true}},
 {name:'remove_audio_effect',input:{}},
 {name:'undo_project',input:{}},
 {name:'redo_project',input:{}},
 {name:'export_project',input:{includeHistory:true}},
 {name:'export_history',input:{}},
 {name:'import_project',input:{}},
 {name:'inspect_selection',input:{}}
 ];
 const tool=calls===1?null:steps[results.length]??null;
 for(const r of results)assert.ok(!r.is_error,JSON.stringify(r));

 res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify({type:event,...data})}\n\n`);
 send('message_start',{message:{id:`fixture-${calls}`,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}});
 if(tool){send('content_block_start',{index:0,content_block:{type:'tool_use',id:`tool-${calls}`,name:tool.name,input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}});}else{send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:calls===1?'<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="select_target">broken</｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>':'TEST FIXTURE: dsh tool round-trip complete.'}});}
 send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:30}});send('message_stop',{});res.end();
});await new Promise(r=>api.listen(0,'127.0.0.1',r));
process.env.SHALLOWGROOVE_DATA_DIR='/tmp/shallow-tools-fixture';process.env.DEEPSEEK_API_KEY='local-protocol-test-key';process.env.DEEPSEEK_BASE_URL=`http://127.0.0.1:${api.address().port}`;
const vite=await createVite({root,server:{host:'127.0.0.1',port:5201,strictPort:true}});await vite.listen();const browser=await firefox.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('console',m=>{if(m.type()==='error')console.log('BROWSER_ERROR',m.text());});await page.goto('http://127.0.0.1:5201');await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled({timeout:120000});await page.getByRole('button',{name:'Select channel 8',exact:true}).click();await page.getByLabel('Message assistant').fill('Send this track to delay at 20 percent.');await page.getByRole('button',{name:'发送 ↑',exact:true}).click();await expect(page.getByText('TEST FIXTURE: dsh tool round-trip complete.',{exact:true})).toBeVisible({timeout:180000});await expect(page.getByRole('slider',{name:'Channel 5 volume',exact:true})).toHaveValue('0.7');assert.ok(toolNames.includes('web_search'));assert.ok(!toolNames.includes('web_fetch'));assert.ok(toolNames.includes('undo_project'));assert.equal(calls,19);
 const finalRequest=requests.at(-1).body;const toolResults=finalRequest.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_result');const finalContext=JSON.parse(toolResults.at(-1).content[0].text);assert.equal(finalContext.automation.length,2);assert.equal(finalContext.chain.length,1);assert.equal(finalContext.chain[0].kind,'compressor');assert.equal(finalContext.loop,true);assert.equal(finalContext.transportPositionSeconds,1);assert.equal(finalContext.history.undoCount,1);const last=JSON.stringify(toolResults.at(-1));assert.ok(last.includes('send.reverb'));assert.ok(last.includes('mixerParameters'));assert.ok(last.includes('awaiting_user_file_selection')===false);
 await expect(page.locator('.assistant-log')).not.toContainText('DSML');console.log('FULL_DSH_BROWSER_ROUNDTRIP_OK');
 const status=await (await fetch('http://127.0.0.1:5201/api/assistant/status')).json();assert.ok(!JSON.stringify(status).includes('local-protocol-test-key'));const forbidden=await fetch('http://127.0.0.1:5201/api/assistant/turn',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'});assert.equal(forbidden.status,403);console.log('ORIGIN_AND_CREDENTIAL_ISOLATION_OK');
}catch(e){console.error(String(e));process.exitCode=1;}finally{await browser.close();await vite.close();await new Promise(r=>api.close(r));}
