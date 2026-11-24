// Per model response, not a conversation-wide allowance. Provider limits still apply.
export function outputTokenBudget(env={}){
 const raw=env.SHALLOWGROOVE_MAX_TOKENS;if(raw===undefined)return undefined;
 const value=Number(raw);if(!Number.isSafeInteger(value)||value<1)throw Error('SHALLOWGROOVE_MAX_TOKENS must be a positive integer');return value;
}

export function reasoningEffort(env={}){
 const effort=env.SHALLOWGROOVE_REASONING_EFFORT??'high';
 if(!['off','low','high','max'].includes(effort))throw Error('Invalid SHALLOWGROOVE_REASONING_EFFORT');
 return effort;
}
