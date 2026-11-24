import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import nativeAudio from '../../desktop/native-audio.cjs';

// Use the same Faust interpreter and stereo rack loader as the FX processor,
// in a separate process with no audio device or access to the playing rack.
export async function validateFxDraft(code, signal){
 if(typeof code!=='string'||!code.trim()||Buffer.byteLength(code)>60000)throw Error('Expected a complete Faust effect of at most 60000 bytes.');
 signal?.throwIfAborted();
 const root=resolve(import.meta.dirname,'../..'),name=nativeAudio.engineName();
 const packaged=resolve(root,'../runtime/native',name);
 const binary=existsSync(packaged)?packaged:resolve(root,'build-native',name);
 const engine=nativeAudio.createNativeAudio({binary,args:['--headless']});
 const stop=()=>{void engine.stop();};
 signal?.addEventListener('abort',stop,{once:true});
 try{
  await engine.request({op:'load',preset:{instrument:'process=button("gate") <: _,_;',effects:[{id:'effect',code}]}});
  signal?.throwIfAborted();
 }finally{
  signal?.removeEventListener('abort',stop);
  await engine.stop();
 }
}
