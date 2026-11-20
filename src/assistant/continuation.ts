export type ModelCompletion={finishReason:string|null;finalResponse?:string|null};
export const continuationStalled='连续三段输出耗尽预算，但没有新的操作进展。已完成的修改保留；可点击“继续未完成任务”重试，或缩小处理范围。 Token continuation made no progress.';
/** Keep the same conversation, not a replay of the original user request. */
export async function continueTokenLimited<T extends ModelCompletion>(run:(prompt:string)=>Promise<T>,prompt:string,options:{progress:()=>number;continuation:(count:number)=>string;onContinue?:(count:number)=>void;cancelled?:()=>boolean}):Promise<T>{
 let message=prompt,count=0,stalled=0,progress=options.progress();
 for(;;){
  if(options.cancelled?.())throw Error('Assistant cancelled');
  const result=await run(message);
  if(options.cancelled?.())throw Error('Assistant cancelled');
  if(!['max-tokens','max_tokens','length'].includes(result.finishReason??''))return result;
  const next=options.progress();stalled=next>progress?0:stalled+1;progress=next;
  if(stalled>=3)throw Error(continuationStalled);
  count++;options.onContinue?.(count);message=options.continuation(count);
 }
}
