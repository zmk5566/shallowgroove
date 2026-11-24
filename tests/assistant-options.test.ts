import {test} from 'node:test';import assert from 'node:assert/strict';
test('assistant output budget is configurable and rejects invalid configuration',async()=>{const {outputTokenBudget}=await import('../server/assistant-options.mjs');assert.equal(outputTokenBudget({}),undefined);assert.equal(outputTokenBudget({SHALLOWGROOVE_MAX_TOKENS:'16384'}),16384);for(const value of ['0','-1','1.5','NaN',''])assert.throws(()=>outputTokenBudget({SHALLOWGROOVE_MAX_TOKENS:value}));});

test('interactive turns default to high reasoning with an explicit override',async()=>{
 const {reasoningEffort}=await import('../server/assistant-options.mjs');
 assert.equal(reasoningEffort({}),'high');
 assert.equal(reasoningEffort({SHALLOWGROOVE_REASONING_EFFORT:'low'}),'low');
 assert.throws(()=>reasoningEffort({SHALLOWGROOVE_REASONING_EFFORT:'invalid'}));
});
