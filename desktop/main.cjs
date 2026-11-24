const {app,BrowserWindow,dialog,Menu,Tray,nativeImage,ipcMain}=require('electron');
const {join}=require('node:path');
const {startMusic,startConnect,stopService}=require('./services.cjs');
const connectLocale=require('./connect-locale.cjs').createConnectLocale();
let backend,connector,mainWindow,connectWindow,tray,musicPort,connectPort;
let quitting=false,shutdownComplete=false,connectStarting;
let projectDirty=false,projectCloseAllowed=false,projectReady=false;
let connectState={phase:'starting',message:''};
const viteDev=!app.isPackaged&&process.argv.includes('--vite-dev');
const smoke=process.env.SHALLOWGROOVE_SMOKE==='1';
const redact=error=>String(error).replace(/[A-Za-z0-9_-]{24,}/g,'[redacted]');
if(smoke)app.setPath('userData',join(app.getPath('temp'),'shallowgroove-smoke-'+process.pid));
function show(window){if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}}
const privateEdition=!viteDev&&require('node:fs').existsSync(join(app.getAppPath(),'desktop/private-config.json'));
function makeWindow(title,origin,main=false){
 const window=new BrowserWindow({title,width:main?1440:1280,height:main?960:820,minWidth:main?1000:960,minHeight:main?700:640,show:main,icon:join(app.getAppPath(),'desktop/icons/shallowgroove.png'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,...(main?{preload:join(app.getAppPath(),'desktop/preload.cjs'),additionalArguments:privateEdition?['--sg-builtin-key']:[]}:{})}});
 window.on('close',event=>{if(!quitting){event.preventDefault();if(main)app.quit();else window.hide();}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==origin)event.preventDefault();}catch{event.preventDefault();}});
 return window;
}
async function ensureConnect(){
 if(quitting)throw Error('应用正在退出');
 if(connectStarting)return connectStarting;
 if(connector&&connector.exitCode===null&&connectState.phase==='running')return;
 connectState={phase:'starting',message:''};
 connectStarting=(async()=>{
  const child=startConnect({resources:(viteDev&&process.env.SHALLOWGROOVE_DEV_RESOURCES)||process.resourcesPath,musicPort,smoke});connector=child;
  child.on('error',error=>{if(!quitting)connectState={phase:'error',message:redact(error)};});
  child.on('exit',code=>{if(!quitting&&connector===child)connectState={phase:'error',message:`Connect 后台已退出 (${code})，点击入口重试`};});
  try{
   connectPort=await child.ready;
   if(quitting)return;
   connectState={phase:'running',message:''};
   // Recreate a failed service's window so its navigation guard follows the new port.
   if(connectWindow&&!connectWindow.isDestroyed()){connectWindow.destroy();connectWindow=null;}
  }catch(error){connectState={phase:'error',message:redact(error)};throw error;}
 })();
 try{await connectStarting;}finally{connectStarting=null;}
}
async function openConnect(locale){
 if(locale!==undefined)await connectLocale.set(locale);
 if(!musicPort)return;
 await ensureConnect();if(quitting)return;
 if(!connectWindow||connectWindow.isDestroyed()){
  const origin=`http://127.0.0.1:${connectPort}`;
  connectWindow=makeWindow('Hexblocks Connect',origin);
  await connectWindow.loadURL(connectLocale.url(origin));
 }
 await connectLocale.apply(connectWindow);
 show(connectWindow);
}
function openConnectFromMenu(){void openConnect().catch(error=>dialog.showErrorBox('Hexblocks Connect',redact(error)));}
function trusted(event){return event.sender===mainWindow?.webContents&&event.senderFrame===mainWindow.webContents.mainFrame&&event.senderFrame.url.startsWith(`http://127.0.0.1:${musicPort}/`);}
function setupMenus(){
 const controls=[{label:'打开 ShallowGroove',click:()=>show(mainWindow)},{label:'打开 Hexblocks Connect',click:openConnectFromMenu},{type:'separator'},{label:'退出 ShallowGroove',accelerator:'CmdOrCtrl+Q',click:()=>app.quit()}];
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'ShallowGroove',submenu:[{role:'about'},...controls]},
  {label:'文件 / File',submenu:[{label:'欢迎页 / Home',click:()=>mainWindow?.webContents.send('project:action','home')},{label:'保存 / Save',accelerator:'CmdOrCtrl+S',click:()=>mainWindow?.webContents.send('project:action','save')},{label:'另存为 / Save as',accelerator:'CmdOrCtrl+Shift+S',click:()=>mainWindow?.webContents.send('project:action','save-as')}]},
  {role:'editMenu'},
  {label:'窗口',submenu:[{role:'minimize'},{label:'关闭当前窗口',accelerator:'CmdOrCtrl+W',click:()=>BrowserWindow.getFocusedWindow()?.close()},...controls.slice(0,2)]},
 ]));
 const icon=nativeImage.createFromPath(join(app.getAppPath(),'desktop/icons/shallowgroove.png')).resize({width:20,height:20});
 tray=new Tray(icon);tray.setToolTip('ShallowGroove · Hexblocks Connect');tray.setContextMenu(Menu.buildFromTemplate(controls));tray.on('double-click',()=>show(mainWindow));
 if(process.platform==='darwin')app.dock.setMenu(Menu.buildFromTemplate(controls.slice(0,2)));
}
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>show(mainWindow));
 app.on('activate',()=>show(mainWindow));
 // Closing the main window or explicit Quit stops both services; Connect only hides.
 app.on('window-all-closed',()=>{});
 app.on('before-quit',event=>{
  if(shutdownComplete)return;
  event.preventDefault();if(quitting)return;
  if(projectReady&&!projectCloseAllowed&&mainWindow&&!mainWindow.isDestroyed()){show(mainWindow);mainWindow?.webContents.send('project:action','close');return;}
  quitting=true;
  for(const window of BrowserWindow.getAllWindows())window.hide();
  void Promise.allSettled([stopService(connector),stopService(backend)]).then(()=>{shutdownComplete=true;tray?.destroy();app.quit();});
 });
 app.whenReady().then(async()=>{
  const root=app.getAppPath();
  app.setAboutPanelOptions({applicationName:'ShallowGroove',applicationVersion:app.getVersion(),iconPath:join(root,'desktop/icons/shallowgroove.png')});
  setupMenus();
  const projectFiles=require('./projects.cjs').createProjectFiles(app.getPath('userData'),async(mode,name)=>{
   if(mode==='open'){const result=await dialog.showOpenDialog(mainWindow,{title:'打开 ShallowGroove 项目文件夹',properties:['openDirectory']});return result.canceled?null:result.filePaths[0];}
   const result=await dialog.showSaveDialog(mainWindow,{title:'创建项目文件夹 / Create project folder',defaultPath:join(app.getPath('documents'),name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_'))});return result.canceled?null:result.filePath;
  });
  const patchLibrary=require('./user-library.cjs').createUserLibrary(app.getPath('userData'));
  for(const action of ['list','save'])ipcMain.handle('library:'+action,(event,...args)=>{if(!trusted(event))throw Error('Untrusted window');return patchLibrary[action](...args);});
  for(const action of ['list','read','save','open','draft','version','clone'])ipcMain.handle('project:'+action,(event,...args)=>{if(!trusted(event))throw Error('Untrusted window');return projectFiles[action](...args);});
  ipcMain.on('project:dirty',(event,dirty)=>{if(trusted(event)){projectReady=true;projectDirty=!!dirty;projectCloseAllowed=false;mainWindow.setDocumentEdited(projectDirty);}});
  ipcMain.on('project:allow-close',event=>{if(trusted(event)){projectCloseAllowed=true;app.quit();}});
  const inspectors=new Map();
  ipcMain.handle('inspect:open',async(event,id)=>{
   if(!trusted(event)||typeof id!=='string'||!/^sg-[a-f0-9-]{36}$/.test(id)||inspectors.has(id))throw Error('Invalid inspection window');
   const child=new BrowserWindow({width:600,height:500,show:false,autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   inspectors.set(id,child);
   child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   child.webContents.on('will-navigate',e=>e.preventDefault());
   child.once('closed',()=>{
    inspectors.delete(id);
    if(!mainWindow.isDestroyed())mainWindow.webContents.send('inspect:closed',id);
   });
   try{
    await child.loadURL(`http://127.0.0.1:${musicPort}/inspect.html#${id}`);
    if(!child.isDestroyed())child.show();
   }catch(error){if(!child.isDestroyed())child.destroy();throw error;}
  });
  ipcMain.on('inspect:close',(event,id)=>{if(trusted(event))inspectors.get(id)?.close();});
  ipcMain.handle('assistant:source',(event,href)=>{
   if(!trusted(event)||typeof href!=='string')throw Error('Invalid source link');
   const url=new URL(href);
   if(!['https:','http:'].includes(url.protocol))throw Error('Invalid source URL');
   return require('electron').shell.openExternal(url.href);
  });
  ipcMain.handle('connect:status',event=>{if(!trusted(event))throw Error('Untrusted window');return connectState;});
  ipcMain.handle('connect:open',async (event,locale)=>{if(!trusted(event))throw Error('Untrusted window');await openConnect(locale);return true;});
  ipcMain.handle('connect:locale',async (event,locale)=>{if(!trusted(event))throw Error('Untrusted window');return connectLocale.set(locale,connectWindow);});
  backend=startMusic({root,resources:process.resourcesPath,dataDirectory:app.getPath('userData'),dev:viteDev});
  backend.on('error',()=>{});
  backend.on('exit',code=>{if(!quitting){if(smoke)console.error(`Music backend exited (${code})`);else dialog.showErrorBox('ShallowGroove',`音乐后台退出 (${code})`);app.quit();}});
  musicPort=await backend.ready;
  if(!privateEdition){
   const {credentialStore,validateKey}=require('./credentials.cjs');
   const store=credentialStore(app.getPath('userData'),require('electron').safeStorage);
   function applyKey(key){
    const id=require('node:crypto').randomUUID();
    return new Promise((resolve,reject)=>{
     const finish=error=>{clearTimeout(timer);backend.off('message',receive);error?reject(error):resolve();};
     const receive=message=>{if(message.ack===id)finish();};
     const timer=setTimeout(()=>finish(Error('Assistant unavailable')),5000);
     backend.on('message',receive);backend.send({type:'credential',id,key},error=>{if(error)finish(error);});
    });
   }
   let storageIssue=false;
   try{const saved=store.read();if(saved)await applyKey(saved);}catch{storageIssue=true;}
   let updating=false;
   ipcMain.handle('assistant:test-key',async event=>{
    if(!trusted(event))throw Error('Untrusted window');
    try{return await validateKey(store.read());}catch{return 'storage';}
   });
   ipcMain.handle('assistant:key-storage',event=>{if(!trusted(event))throw Error('Untrusted window');return storageIssue;});
   ipcMain.handle('assistant:key',async(event,key)=>{
    if(!trusted(event))throw Error('Untrusted window');
    if(updating)return 'busy';
    updating=true;
    try{
     if(key!==null){const status=await validateKey(key);if(status!=='ok')return status;}
     store.save(key);await applyKey(key??'');storageIssue=false;return 'ok';
    }catch{return 'storage';}finally{updating=false;}
   });
  }
  if(quitting)return;
  mainWindow=makeWindow('ShallowGroove',`http://127.0.0.1:${musicPort}`,true);
  await mainWindow.loadURL(`http://127.0.0.1:${musicPort}`);
  if(quitting)return;
  try{await ensureConnect();}catch(error){if(smoke)throw error;}
  if(smoke){
   await require('./smoke.cjs').check({mainWindow,getConnectWindow:()=>connectWindow,openConnect,backend,connector,musicPort,connectPort,version:app.getVersion()});
   if(process.env.SHALLOWGROOVE_SMOKE_EXIT==='quit')app.quit();else mainWindow.close();
  }
 }).catch(error=>{if(smoke){console.error(error);process.exitCode=1;}else dialog.showErrorBox('ShallowGroove',redact(error));app.quit();});
}
