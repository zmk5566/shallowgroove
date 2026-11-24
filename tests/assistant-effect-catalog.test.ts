import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchEffects,resolveEffect} from '../src/assistant/effect-catalog.ts';
import type {LibraryEntry} from '../src/model/user-library.ts';

test('agent discovers personal and factory effects and loads the selected revision',()=>{
 const personal:LibraryEntry={id:'user-id',revision:2,name:'Tape echo',kind:'delay',code:'process=_,_;',values:{Feedback:0.4}};
 const factory={...personal,id:'factory:effect:delay',name:'Delay'};
 const entries:LibraryEntry[]=[personal,factory,{...personal,id:'synth',kind:'instrument'}];
 const result=searchEffects(entries,{query:'delay'});
 assert.deepEqual(result.entries.map(e=>e.source),['user','factory']);
 assert.equal('code' in result.entries[0],false);
 assert.deepEqual(searchEffects(entries,{source:'user',query:'tape echo'}).entries,[result.entries[0]]);
 assert.equal(resolveEffect(entries,result.entries[0].id,2),personal);
 assert.throws(()=>resolveEffect(entries,personal.id,1));
 assert.throws(()=>resolveEffect(entries,'synth',2));
});
