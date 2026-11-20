// These are leaked model protocol tokens, not executable application commands.
export function hasToolProtocolLeak(text:string){return /<\/?[｜|]{1,2}\s*(?:DSML|tool[▁_ ]calls[▁_ ]begin|tool[▁_ ]call[▁_ ]begin)[\s｜|>]/i.test(text);}
export const protocolFailure='模型返回了无效的工具调用格式，自动重试后仍未恢复。这段文本没有作为工具执行；之前已完成的修改会保留，请检查历史记录。 Model returned invalid tool-call text after recovery.';
export const emptyFailure='模型在自动恢复后仍未返回文字，未能确认请求已全部完成。已完成的工具修改会保留，请检查历史记录。 Model returned an empty reply after recovery.';
export async function guardedReply(run:(prompt:string)=>Promise<string>,prompt:string,recovery:string|((reason:'empty'|'protocol')=>string)){
 const first=await run(prompt),reason=!first.trim()?'empty':hasToolProtocolLeak(first)?'protocol':null;if(!reason)return first;
 const second=await run(typeof recovery==='function'?recovery(reason):recovery);
 if(!second.trim())throw Error(emptyFailure);if(hasToolProtocolLeak(second))throw Error(protocolFailure);
 return second;
}
