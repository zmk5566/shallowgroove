export type NativeOutput={device:string|null;sampleRate:number|null;bufferSize:number|null};
export type OutputOptions={devices:string[];sampleRates:number[];bufferSizes:number[]};
export const systemOutput:NativeOutput={device:null,sampleRate:null,bufferSize:null};
export function sameOutput(a:NativeOutput,b:NativeOutput){
 return a.device===b.device&&a.sampleRate===b.sampleRate&&a.bufferSize===b.bufferSize;
}
export function supportedOutput(output:NativeOutput,options:OutputOptions):NativeOutput{
 return {...output,sampleRate:options.sampleRates.includes(output.sampleRate??-1)?output.sampleRate:null,
  bufferSize:options.bufferSizes.includes(output.bufferSize??-1)?output.bufferSize:null};
}
export function bufferDuration(frames:number,hz:number|undefined){return hz&&hz>0?(frames*1000/hz).toFixed(2):null;}
