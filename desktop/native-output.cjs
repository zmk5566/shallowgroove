const {createNativeAudio, audioPreferences, validateOutput}=require('./native-audio.cjs');

function desktopAudio({binary,directory,onEvent,create=createNativeAudio}) {
 let active, candidate, applying, generation=0, configured=false, disturbed=false;
 const probes=new Set();
 function helper() {
  const h=create({binary,onEvent:message=>{
   if(h!==active)return;
   // Changing a shared CoreAudio clock can briefly stop the previous device.
   if(applying && ['deviceLost','outputDefaultChanged','disconnected'].includes(message.event)){
    disturbed=true;return;
   }
   if(message.event==='disconnected')configured=false;
   onEvent(message);
  }});
  return h;
 }
 active=helper();
 const prefs=audioPreferences(directory,active.status().available?'native':'web');
 const send=(h,op,fields={})=>h.request({...fields,op});
 async function request(command) {
  const version=generation;
  if(command?.op==='configureOutput'||command?.op==='releaseOutput')throw Error('Use audio output settings to change the device');
  if(applying){
   if(command?.op==='play')throw Error('Audio output is changing');
   if(!['status','meters','inspectClose','inspectRead'].includes(command?.op))await applying.catch(()=>{});
   if(version!==generation)throw Error('Audio engine was stopped');
  }
  const h=active;
  if(command?.op==='load' && !configured){
   await send(h,'configureOutput',{output:prefs.preferences().output});
   if(version!==generation||h!==active)throw Error('Audio engine was stopped');
   configured=true;
  }
  return h.request(command);
 }
 async function outputOptions(device){
  validateOutput({device,sampleRate:null,bufferSize:null});
  if(active.status().running)return send(active,'outputOptions',{device});
  const h=helper();probes.add(h);
  try{return await send(h,'outputOptions',{device});}
  finally{probes.delete(h);await h.stop();}
 }
 async function apply(value){
  const output=validateOutput(value?.output);
  const previous=active,version=generation;
  const wasNative=configured&&previous.status().running;
  const check=()=>{if(version!==generation)throw Error('Audio engine was stopped');};
  const before=wasNative?await send(previous,'status'):null;
  check();
  if(before?.playing)throw Error('Stop playback before changing audio output');
  const position=value.position??before?.position??0;
  if(!Number.isFinite(position)||position<0)throw Error('Invalid playback position');
  const prior=prefs.preferences().output;
  const next=candidate=helper();
  disturbed=false;
  let released=false;
  async function install(h,settings){
   const devices=await send(h,'configureOutput',{output:settings});check();
   await send(h,'load',value.graph);check();
   const present=new Set(devices.midiInputs.map(input=>input.id));
   await send(h,'setMidiInputs',{ids:value.midiInputs.filter(id=>present.has(id))});check();
   await send(h,'seek',{position});check();
  }
  try {
   // Validate on an unopened helper, then give the device clock to a single JUCE client.
   const options=await send(next,'outputOptions',{device:output.device});check();
   if(output.sampleRate!==null&&!options.sampleRates.includes(output.sampleRate))throw Error('Sample rate unavailable on this output');
   if(output.bufferSize!==null&&!options.bufferSizes.includes(output.bufferSize))throw Error('Buffer size unavailable on this output');
   if(wasNative){
    await send(previous,'setMonitor',{enabled:false});check();
    released=true;
    await send(previous,'releaseOutput');check();
   }
   await install(next,output);
   await send(next,'setMonitor',value.monitor);check();
   const result=await send(next,'status');check();
   if(result.audioError)throw Error(result.audioError);
   prefs.savePreferences({engine:'native',output});
   configured=true;active=next;candidate=undefined;
   await previous.stop();
   return result;
  }catch(error){
   await next.stop();
   if(wasNative&&version===generation){
    try{
     const current=!released&&!disturbed&&previous.status().running?await send(previous,'status'):null;check();
     if(!current || current.audioError || current.audioDevice!==before.audioDevice ||
        current.sampleRate!==before.sampleRate || current.bufferSize!==before.bufferSize ||
        (current.outputLost===true)){
      await install(previous,{...prior,sampleRate:before.sampleRate,bufferSize:before.bufferSize});
     }
     await send(previous,'setMonitor',value.monitor);check();
    }catch(recoveryError){
     if(version===generation){
      configured=false;
      onEvent({event:'disconnected',error:'Could not restore the audio output: '+recoveryError.message});
     }
    }
   }
   throw error;
  }finally{if(candidate===next)candidate=undefined;}
 }
 async function applyOutput(value){
  if(applying)throw Error('Audio output is already changing');
  applying=apply(value);
  try{return await applying;}finally{applying=undefined;}
 }
 async function stop(){
  generation++;configured=false;
  const old=active;active=helper();
  await Promise.all([old,candidate,...probes].filter(Boolean).map(h=>h.stop()));
 }
 return {...prefs,status:()=>active.status(),request,outputOptions,applyOutput,stop};
}
module.exports={desktopAudio};
