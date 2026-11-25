const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('shallowgrooveDesktop',Object.freeze({
 ...(process.argv.includes('--sg-builtin-key')?{}:{
  testAssistantKey:()=>ipcRenderer.invoke('assistant:test-key'),
  setAssistantKey:key=>ipcRenderer.invoke('assistant:key',key),
  assistantStorageIssue:()=>ipcRenderer.invoke('assistant:key-storage'),
 }),
 exportAudio:options=>ipcRenderer.invoke('audio-export:start',options),
 cancelAudioExport:()=>ipcRenderer.invoke('audio-export:cancel'),
 setAudioExportAvailable:yes=>ipcRenderer.send('audio-export:available',yes),
 onAudioExportProgress:callback=>{
  const listener=(_event,pct)=>callback(pct);
  ipcRenderer.on('audio-export:progress',listener);
  return ()=>ipcRenderer.removeListener('audio-export:progress',listener);
 },
 libraryList:()=>ipcRenderer.invoke('library:list'),
 librarySave:(name,patch,previous)=>ipcRenderer.invoke('library:save',name,patch,previous),
 projectList:()=>ipcRenderer.invoke('project:list'),
 projectRead:id=>ipcRenderer.invoke('project:read',id),
 projectSave:(text,name,id)=>ipcRenderer.invoke('project:save',text,name,id),
 projectClone:url=>ipcRenderer.invoke('project:clone',url),
 projectVersion:(id,cmd)=>ipcRenderer.invoke('project:version',id,cmd),
 projectOpen:()=>ipcRenderer.invoke('project:open'),
 projectDraft:value=>ipcRenderer.invoke('project:draft',value),
 projectDirty:dirty=>ipcRenderer.send('project:dirty',dirty),
 projectAllowClose:()=>ipcRenderer.send('project:allow-close'),
 onProjectAction:callback=>{const listener=(_event,action)=>callback(action);ipcRenderer.on('project:action',listener);return()=>ipcRenderer.removeListener('project:action',listener);},
 openInspector:id=>ipcRenderer.invoke('inspect:open',id),
 closeInspector:id=>ipcRenderer.send('inspect:close',id),
 onInspectorClosed:callback=>{const listener=(_event,id)=>callback(id);ipcRenderer.on('inspect:closed',listener);return()=>ipcRenderer.removeListener('inspect:closed',listener);},
 openSource:href=>ipcRenderer.invoke('assistant:source',href),
 initialLocale:ipcRenderer.sendSync('app:locale'),
 openConnect:locale=>ipcRenderer.invoke('connect:open',locale),
 setConnectLocale:locale=>ipcRenderer.invoke('connect:locale',locale),
 connectStatus:()=>ipcRenderer.invoke('connect:status'),
}));

contextBridge.exposeInMainWorld('sgNativeAudio',Object.freeze({
 outputOptions:device=>ipcRenderer.invoke('native-audio:outputOptions',device),
 applyOutput:value=>ipcRenderer.invoke('native-audio:applyOutput',value),
 preferences:()=>ipcRenderer.invoke('native-audio:preferences'),
 savePreferences:preferences=>ipcRenderer.invoke('native-audio:savePreferences',preferences),
 status:()=>ipcRenderer.invoke('native-audio:status'),
 request:command=>ipcRenderer.invoke('native-audio:request',command),
 stop:()=>ipcRenderer.invoke('native-audio:stop'),
 onEvent:callback=>{
  const listener=(_event,message)=>callback(message);
  ipcRenderer.on('native-audio:event',listener);
  return ()=>ipcRenderer.removeListener('native-audio:event',listener);
 },
}));

contextBridge.exposeInMainWorld('sgOsc',Object.freeze({
 status:()=>ipcRenderer.invoke('osc:status'),
 configure:value=>ipcRenderer.invoke('osc:configure',value),
 onMessages:callback=>{
  const listener=(_event,messages)=>callback(messages);
  ipcRenderer.on('osc:messages',listener);
  return ()=>ipcRenderer.removeListener('osc:messages',listener);
 },
}));
