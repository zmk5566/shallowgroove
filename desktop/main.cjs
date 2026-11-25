require('./log-pipes.cjs')();
const {app,BrowserWindow,dialog,Menu,Tray,nativeImage,ipcMain}=require('electron');
const {join}=require('node:path');
const {startMusic,startConnect,stopService}=require('./services.cjs');
const connectLocale=require('./connect-locale.cjs').createConnectLocale();
const {desktopLanguage,menuTemplates,isLocale}=require('./menus.cjs');
let language;
function appLocale(){return language?.current()??'zh-CN';}
const tr=(zh,en)=>appLocale()==='en'?en:zh;
let backend,connector,mainWindow,connectWindow,tray,musicPort,connectPort;
let nativeAudio,audioExport,osc;
let quitting=false,shutdownComplete=false,connectStarting;
let projectDirty=false,projectCloseAllowed=false,projectReady=false;
let connectState={phase:'starting',message:''};
const viteDev=!app.isPackaged&&process.argv.includes('--vite-dev');
const fxBackground=process.argv.includes('--sg-fx-background');
const smoke=process.env.SHALLOWGROOVE_SMOKE==='1';
if(viteDev&&process.argv.includes('--native-preview')&&!app.commandLine.hasSwitch('user-data-dir'))
 app.setPath('userData',join(app.getPath('appData'),'ShallowGroove Native Preview'));
const redact=error=>String(error).replace(/[A-Za-z0-9_-]{24,}/g,'[redacted]');
if(smoke)app.setPath('userData',join(app.getPath('temp'),'shallowgroove-smoke-'+process.pid));
function show(window){if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}}
const privateEdition=!viteDev&&require('node:fs').existsSync(join(app.getAppPath(),'desktop/private-config.json'));
function makeWindow(title,origin,main=false){
 const window=new BrowserWindow({title,width:main?1440:1280,height:main?960:820,minWidth:main?1000:960,minHeight:main?700:640,show:main&&!fxBackground,icon:join(app.getAppPath(),'desktop/icons/shallowgroove.png'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,...(main?{preload:join(app.getAppPath(),'desktop/preload.cjs'),additionalArguments:privateEdition?['--sg-builtin-key']:[]}:{})}});
 window.on('close',event=>{if(!quitting){event.preventDefault();if(main)app.quit();else window.hide();}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==origin)event.preventDefault();}catch{event.preventDefault();}});
 return window;
}
async function ensureConnect(){
 if(quitting)throw Error(tr('应用正在退出','ShallowGroove is quitting'));
 if(connectStarting)return connectStarting;
 if(connector&&connector.exitCode===null&&connectState.phase==='running')return;
 connectState={phase:'starting',message:''};
 connectStarting=(async()=>{
  const child=startConnect({devRoot:viteDev&&!process.env.SHALLOWGROOVE_DEV_RESOURCES?app.getAppPath():undefined,resources:(viteDev&&process.env.SHALLOWGROOVE_DEV_RESOURCES)||process.resourcesPath,musicPort,smoke});connector=child;
  child.on('error',error=>{if(!quitting)connectState={phase:'error',message:redact(error)};});
  child.on('exit',code=>{if(!quitting&&connector===child)connectState={phase:'error',exitCode:code};});
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
 if(locale!==undefined)await setAppLocale(locale);
 if(!musicPort)return;
 await ensureConnect();if(quitting)return;
 if(!connectWindow||connectWindow.isDestroyed()){
  const origin=`http://127.0.0.1:${connectPort}`;
  connectWindow=makeWindow('HexConnect',origin);
  await connectWindow.loadURL(connectLocale.url(origin));
 }
 await connectLocale.apply(connectWindow);
 show(connectWindow);
}
function openConnectFromMenu(){void openConnect().catch(error=>dialog.showErrorBox('HexConnect',redact(error)));}
function trusted(event){return event.sender===mainWindow?.webContents&&event.senderFrame===mainWindow.webContents.mainFrame&&event.senderFrame.url.startsWith(`http://127.0.0.1:${musicPort}/`);}
async function setAppLocale(locale){
 if(!isLocale(locale))return false;
 if(language.set(locale))setupMenus();
 return connectLocale.set(locale,connectWindow);
}
let exportAvailable=false;
function setExportAvailable(enabled){
 exportAvailable=enabled===true;
 const item=Menu.getApplicationMenu()?.getMenuItemById('export-audio');if(item)item.enabled=exportAvailable;
}
let installingPlugins=false;
async function installPlugins(){
 if(installingPlugins)return;
 installingPlugins=true;
 try{
  const directory=await require('./install-plugins.cjs').installForApp(app,process.resourcesPath);
  await dialog.showMessageBox(mainWindow,{type:'info',message:tr('VST3 插件已安装。如果宿主已经加载旧版，请保存工程，完全退出宿主后重新打开。首次安装可在宿主中重新扫描。','VST3 plug-ins installed. If your host has loaded an earlier version, save your project, quit the host and relaunch it. For a first installation, rescan plug-ins if needed.'),detail:directory});
 }catch(error){dialog.showErrorBox(tr('插件安装失败','Plug-in installation failed'),String(error.message));}
 finally{installingPlugins=false;}
}
function setupMenus(){
 const templates=menuTemplates(appLocale(),{
  installPlugins,show:()=>show(mainWindow),connect:openConnectFromMenu,quit:()=>app.quit(),
  close:()=>BrowserWindow.getFocusedWindow()?.close(),
  project:action=>{show(mainWindow);mainWindow?.webContents.send('project:action',action);}
 },process.platform==='darwin',exportAvailable);
 Menu.setApplicationMenu(Menu.buildFromTemplate(templates.application));
 if(!tray){
  const icon=nativeImage.createFromPath(join(app.getAppPath(),'desktop/icons/shallowgroove.png')).resize({width:20,height:20});
  tray=new Tray(icon);tray.on('double-click',()=>show(mainWindow));
 }
 tray.setToolTip('ShallowGroove · HexConnect');tray.setContextMenu(Menu.buildFromTemplate(templates.controls));
 if(process.platform==='darwin')app.dock.setMenu(Menu.buildFromTemplate(templates.dock));
}
if(process.argv.includes('--sg-fx-service')){
 app.dock?.hide();
 const file=process.argv.find(arg=>arg.startsWith('--sg-fx-request-file='))?.slice('--sg-fx-request-file='.length);
 app.whenReady().then(()=>require('./fx-service.cjs').runWorker({
  directory:app.getPath('userData'),root:app.getAppPath(),viteDev,storage:require('electron').safeStorage,
 },file)).then(()=>app.exit(0),()=>app.exit(1));
}else if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',(_event,args)=>{if(!args.includes('--sg-fx-background'))show(mainWindow);});
 app.on('activate',()=>show(mainWindow));
 // Closing the main window or explicit Quit stops both services; Connect only hides.
 app.on('window-all-closed',()=>{});
 app.on('before-quit',event=>{
  if(shutdownComplete)return;
  event.preventDefault();if(quitting)return;
  if(projectReady&&!projectCloseAllowed&&mainWindow&&!mainWindow.isDestroyed()){show(mainWindow);mainWindow?.webContents.send('project:action','close');return;}
  quitting=true;
  for(const window of BrowserWindow.getAllWindows())window.hide();
  void Promise.allSettled([osc?.close(),audioExport?.cancel(),nativeAudio?.stop(),stopService(connector),stopService(backend)]).then(()=>{shutdownComplete=true;tray?.destroy();app.quit();});
 });
 app.whenReady().then(async()=>{
  const root=app.getAppPath();
  app.setAboutPanelOptions({applicationName:'ShallowGroove',applicationVersion:app.getVersion(),iconPath:join(root,'desktop/icons/shallowgroove.png')});
  language=desktopLanguage(app.getPath('userData'));await connectLocale.set(appLocale());
  ipcMain.on('app:locale',event=>{event.returnValue=trusted(event)?language.saved():null;});
  setupMenus();
  const projectFiles=require('./projects.cjs').createProjectFiles(app.getPath('userData'),async(mode,name)=>{
   if(mode==='open'){const result=await dialog.showOpenDialog(mainWindow,{title:tr('打开 ShallowGroove 项目文件夹','Open ShallowGroove project folder'),buttonLabel:tr('打开','Open'),properties:['openDirectory']});return result.canceled?null:result.filePaths[0];}
   const result=await dialog.showSaveDialog(mainWindow,{title:tr('创建项目文件夹','Create project folder'),buttonLabel:tr('创建','Create'),defaultPath:join(app.getPath('documents'),name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_'))});return result.canceled?null:result.filePath;
  });
  const patchLibrary=require('./user-library.cjs').createUserLibrary(app.getPath('userData'));
  for(const action of ['list','save'])ipcMain.handle('library:'+action,(event,...args)=>{if(!trusted(event))throw Error('Untrusted window');return patchLibrary[action](...args);});
  for(const action of ['list','read','save','open','draft','version','clone'])ipcMain.handle('project:'+action,(event,...args)=>{if(!trusted(event))throw Error('Untrusted window');return projectFiles[action](...args);});
  ipcMain.on('project:dirty',(event,dirty)=>{if(trusted(event)){projectReady=true;projectDirty=!!dirty;projectCloseAllowed=false;mainWindow.setDocumentEdited(projectDirty);}});
  ipcMain.on('project:allow-close',event=>{if(trusted(event)){projectCloseAllowed=true;app.quit();}});
  osc=require('./osc.cjs').createOscReceiver(app.getPath('userData'),messages=>{
   if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('osc:messages',messages);
  });
  for(const action of ['status','configure'])ipcMain.handle('osc:'+action,(event,...args)=>{
   if(!trusted(event))throw Error('Untrusted window');
   return osc[action](...args);
  });
  const engineName=require('./native-audio.cjs').engineName();
  const binary=join(app.isPackaged?join(process.resourcesPath,'runtime','native'):join(app.getAppPath(),'build-native'),engineName);
  audioExport=require('./export-dialog.cjs').createAudioExport({
   app,dialog,locale:appLocale,window:()=>mainWindow,available:()=>nativeAudio.status().available,
   binary,
  });
  ipcMain.handle('audio-export:start',(event,options)=>{if(!trusted(event))throw Error('Untrusted window');return audioExport.start(options);});
  ipcMain.handle('audio-export:cancel',event=>{if(!trusted(event))throw Error('Untrusted window');return audioExport.cancel();});
  ipcMain.on('audio-export:available',(event,yes)=>{if(trusted(event))setExportAvailable(yes===true);});
  nativeAudio=require('./native-output.cjs').desktopAudio({
   binary,
   directory:app.getPath('userData'),
   onEvent:message=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('native-audio:event',message);},
  });
  for(const action of ['status','request','stop','preferences','savePreferences','outputOptions','applyOutput'])ipcMain.handle('native-audio:'+action,(event,...args)=>{
   if(!trusted(event))throw Error('Untrusted window');
   return nativeAudio[action](...args);
  });
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
  ipcMain.handle('connect:status',event=>{if(!trusted(event))throw Error('Untrusted window');return 'exitCode' in connectState?{phase:'error',message:tr(`HexConnect 后台已退出（${connectState.exitCode}），请重新打开。`,`HexConnect exited (${connectState.exitCode}). Reopen it to retry.`)}:connectState;});
  ipcMain.handle('connect:open',async (event,locale)=>{if(!trusted(event))throw Error('Untrusted window');await openConnect(locale);return true;});
  ipcMain.handle('connect:locale',async (event,locale)=>{if(!trusted(event))throw Error('Untrusted window');return setAppLocale(locale);});
  backend=startMusic({root,resources:process.resourcesPath,dataDirectory:app.getPath('userData'),dev:viteDev});
  backend.on('error',()=>{});
  backend.on('exit',code=>{if(!quitting){if(smoke)console.error(`Music backend exited (${code})`);else dialog.showErrorBox('ShallowGroove',tr(`音乐后台已退出（${code}）`,`Music backend exited (${code})`));app.quit();}});
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
   try{
    const saved=store.read();
    if(saved)await applyKey(saved);
    else if(viteDev){
     const paired=await require('./fx-service.cjs').assistantConfig({directory:app.getPath('userData'),root,viteDev,storage:require('electron').safeStorage});
     if(paired.source==='builtin')await applyKey(paired.key);
    }
   }catch{storageIssue=true;}
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
  mainWindow.webContents.on('render-process-gone',()=>{setExportAvailable(false);void audioExport.cancel();void nativeAudio.stop();});
  mainWindow.webContents.on('did-start-navigation',({isSameDocument,isMainFrame})=>{if(isMainFrame&&!isSameDocument){setExportAvailable(false);void audioExport.cancel();void nativeAudio.stop();}});
  await mainWindow.loadURL(`http://127.0.0.1:${musicPort}`);
  if(quitting)return;
  if(!fxBackground)try{await ensureConnect();}catch(error){if(smoke)throw error;}
  if(smoke){
   await require('./smoke.cjs').check({mainWindow,getConnectWindow:()=>connectWindow,openConnect,backend,connector,musicPort,connectPort,version:app.getVersion()});
   if(process.env.SHALLOWGROOVE_SMOKE_EXIT==='quit')app.quit();else mainWindow.close();
  }
 }).catch(error=>{if(smoke){console.error(error);process.exitCode=1;}else dialog.showErrorBox('ShallowGroove',redact(error));app.quit();});
}
