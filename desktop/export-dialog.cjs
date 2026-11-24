const {join}=require('node:path');

function createAudioExport({app,dialog,binary,locale,window,available}){
 let current;
 async function run(job,options){
  const {signal}=job.controller;
  const zh=locale()==='zh-CN';
  const name=String(options.name||'ShallowGroove').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim().slice(0,120)||'ShallowGroove';
  const chosen=await dialog.showSaveDialog(window(),{
   title:zh?'导出音频':'Export Audio',defaultPath:join(app.getPath('music'),name+'.wav'),
   filters:[{name:zh?'立体声 WAV 音频':'Stereo WAV audio',extensions:['wav']}],
  });
  if(chosen.canceled||!chosen.filePath||signal.aborted)return null;
  job.rendering=true;
  const {exportAudio}=require('./export-audio.cjs');
  const wasm=options.engine==='web'||!available();
  const createRenderer=wasm?(settings=>import('./export-wasm.mjs').then(m=>m.createRenderer(settings))):undefined;
  let last=-1;
  try{
   const result=await exportAudio({binary,path:chosen.filePath,graph:options.graph,sequence:options.sequence,sampleRate:options.sampleRate??48000,bitDepth:options.bitDepth??24,signal,createRenderer,onProgress:value=>{
    const pct=Math.floor(value*100);
    if(last!==pct&&!signal.aborted&&window()&&!window().isDestroyed()){
     last=pct;window().webContents.send('audio-export:progress',pct);
    }
   }});
   return result.path;
  }catch(error){if(signal.aborted)return null;throw error;}
 }
 function start(options){
  if(current)throw Error(locale()==='zh-CN'?'音频正在导出':'An audio export is already running');
  const controller=new AbortController();
  const job={controller,rendering:false};
  current=job;
  job.promise=run(job,options).finally(()=>{if(current===job)current=undefined;});
  return job.promise;
 }
 async function cancel(){
  const job=current;
  if(!job)return;
  job.controller.abort();
  if(job.rendering)await job.promise.catch(()=>{});
 }
 return {start,cancel};
}
module.exports={createAudioExport};
