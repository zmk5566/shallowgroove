import {FaustCompiler,LibFaust} from '@grame/faustwasm';
let compiler:Promise<FaustCompiler>;
async function loadCompiler(){
 // The package's file helper detects window and treats Workers as Node.
 // Load the browser binaries explicitly in this Worker instead.
 const [js,data,wasm]=await Promise.all(['js','data','wasm'].map(async ext=>{
  const response=await fetch(`/faust/libfaust-wasm.${ext}`);if(!response.ok)throw new Error(`Faust asset ${ext}: ${response.status}`);
  return ext==='js'?response.text():response.arrayBuffer();
 }));
 const name=(js as string).match(/var (\w+)\s*=\s*\(/)?.[1];if(!name)throw new Error('Faust module wrapper not recognized');
 const url=URL.createObjectURL(new Blob([`${js}\nexport default ${name};`],{type:'text/javascript'}));
 try {const factory=(await import(/* @vite-ignore */ url)).default;
 const module=await factory({wasmBinary:wasm,getPreloadedPackage:()=>data});
 return new FaustCompiler(new LibFaust(module));
 } finally {URL.revokeObjectURL(url);}
}
self.onmessage=async(event:MessageEvent<{id:number;code:string;kind?:string}>)=>{
 const {id,code,kind}=event.data;
 try{
  compiler??=loadCompiler();
  const instance=await compiler;
  const voiceFactory=kind==='effect'?await instance.createMonoDSPFactory('ShallowEffect',code,'-ftz 2'):await instance.createPolyDSPFactory('ShallowSynth',code,'-ftz 2');
  if(!voiceFactory)throw new Error('Faust compilation failed');
  const meta=JSON.parse(voiceFactory.json);
  if(meta.inputs!==(kind==='effect'?2:0)||meta.outputs!==2)throw new Error(kind==='effect'?'Effect requires 2 inputs and 2 outputs':'Instrument requires 0 inputs and 2 outputs');
  const {mixerModule}=await instance.getAsyncInternalMixerModule(false);
  self.postMessage({id,voiceFactory,mixerModule,effectFactory:null});
 }catch(error){self.postMessage({id,error:String(error)});}
};
