const assert=require('node:assert/strict');
const {writeFileSync}=require('node:fs');
const {WebSocket}=require('ws');
async function until(check,label){
 const end=Date.now()+20000;
 while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}
 throw Error(`Timed out: ${label}`);
}
exports.check=async({mainWindow,getConnectWindow,openConnect,backend,connector,musicPort,connectPort,version})=>{
 const music=`http://127.0.0.1:${musicPort}`,connect=`http://127.0.0.1:${connectPort}`;
 const ws=new WebSocket(`ws://127.0.0.1:${musicPort}/hexblocks/ws`,{origin:music});
 let sensor;
 ws.on('error',()=>{});
 ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='sensor'&&m.connectorId==='hexblocks-integrated-smoke'&&m.uid==='C0FFEE01')sensor=m.value;});
 try{
  assert.equal(getConnectWindow(),undefined,'Connect must not create/show a window at startup');
  assert.equal(mainWindow.isVisible(),true);
  await until(()=>mainWindow.webContents.executeJavaScript(`!!document.querySelector('[data-example="DaisyBell"]:not(:disabled)')`),'welcome examples');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-example="DaisyBell"]').click()`);
  await until(()=>ws.readyState===WebSocket.OPEN,'monitor socket');
  ws.send(JSON.stringify({type:'auth',role:'audio'}));
  await until(async()=>{const state=await fetch(connect+'/api/state').then(r=>r.json());return state.networkConnected&&state.modules.length===2;},'automatic Connect link');
  const state=await fetch(connect+'/api/state').then(r=>r.json());
  assert.equal(state.server,`ws://127.0.0.1:${musicPort}/hexblocks/ws`);
  await until(()=>mainWindow.webContents.executeJavaScript(`!!document.querySelector('[aria-label="Open Hexblocks Connect"]')`),'desktop Connect entry');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[aria-label="Open Hexblocks Connect"]').click()`);
  await until(()=>getConnectWindow()?.isVisible(),'Connect window');
  const window=getConnectWindow(),id=window.id;
  assert.equal(await window.webContents.executeJavaScript('typeof window.shallowgrooveDesktop'),'undefined');
  await mainWindow.webContents.executeJavaScript(`window.shallowgrooveDesktop.setConnectLocale('en')`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('connections').textContent`),'Connect devices');
  const navigation=await window.webContents.executeJavaScript('performance.timeOrigin');
  await mainWindow.webContents.executeJavaScript(`window.shallowgrooveDesktop.setConnectLocale('zh-CN')`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('connections').textContent`),'连接设备');
  assert.equal(await window.webContents.executeJavaScript('performance.timeOrigin'),navigation);
  window.hide();
  await mainWindow.webContents.executeJavaScript(`window.shallowgrooveDesktop.openConnect('en')`);
  assert.equal(getConnectWindow().id,id);
  assert.equal(await window.webContents.executeJavaScript(`document.documentElement.lang`),'en');

  assert.equal(await window.webContents.executeJavaScript(`!!document.getElementById('connect-ble')&&!document.getElementById('serial')&&!document.getElementById('connect-serial')`),true);
  await window.webContents.executeJavaScript(`document.getElementById('connections').click()`);
  writeFileSync(process.env.SHALLOWGROOVE_SMOKE_OUTPUT+'.connect.png',(await window.webContents.capturePage()).toPNG());

  window.close();
  assert.equal(window.isDestroyed(),false);assert.equal(window.isVisible(),false);
  assert.equal(mainWindow.isDestroyed(),false);assert.equal(mainWindow.isVisible(),true);
  assert.equal(backend.exitCode,null);assert.equal(connector.exitCode,null);
  const response=await fetch(connect+'/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Connect-Token':state.csrf},body:JSON.stringify({action:'sim_value',value:0.73})});
  assert.equal(response.status,200);
  await until(()=>sensor===0.73,'sensor forwarding while Connect hidden');
  await openConnect();await openConnect();
  assert.equal(getConnectWindow().id,id);assert.equal(mainWindow.isVisible(),true);assert.equal(window.isVisible(),true);
  const ui=await mainWindow.webContents.executeJavaScript(`({version:document.querySelector('[data-app-version]')?.dataset.appVersion,address:document.querySelector('[aria-label="Connect WebSocket address"]')?.value,port:location.port})`);
  assert.equal(ui.version,version);assert.equal(ui.address,state.server);
  assert.equal((await fetch(music+'/faust/libfaust-wasm.wasm')).status,200);
  assert.equal((await fetch(connect+'/theme.css')).status,200);
  const status=await fetch(music+'/api/assistant/status').then(r=>r.json());assert.equal(status.configured,require('node:fs').existsSync(require('node:path').join(__dirname,'private-config.json')));
  const report={...ui,connectPort,backendPid:backend.pid,connectPid:connector.pid,hiddenSensor:sensor,windowReused:true,connectInitiallyHidden:true,exitAction:process.env.SHALLOWGROOVE_SMOKE_EXIT||'main-close',networkConnected:state.networkConnected};
  writeFileSync(process.env.SHALLOWGROOVE_SMOKE_OUTPUT,JSON.stringify(report));
  writeFileSync(process.env.SHALLOWGROOVE_SMOKE_OUTPUT+'.png',(await mainWindow.webContents.capturePage()).toPNG());
  console.log('PASS: automatic connection, two windows, hide/reopen, background-only startup and live sensor with Connect hidden');
 }finally{ws.close();}
};
