import test from 'node:test';
import assert from 'node:assert/strict';
import {retainEngine} from '../src/audio/engine-lifetime.ts';
import {canCapture} from '../src/model/session.ts';
import type {AudioEngine} from '../src/audio/engine.ts';
import type {Project} from '../src/model/project.ts';

test('refresh keeps the active engine and actual unmount disposes it once',async()=>{
 let disposed=0;
 const ref={current:{dispose:async()=>{disposed++;}}};
 retainEngine(ref)();
 const release=retainEngine(ref);
 await Promise.resolve();assert.equal(disposed,0);
 release();await Promise.resolve();assert.equal(disposed,1);
});

test('snapshot polling skips a disposed or partially initialized rack',()=>{
 const project={tracks:[]} as unknown as Project;
 const engine={project,effects:null,voices:[]} as unknown as AudioEngine;
 assert.equal(canCapture(engine,project),false);
 engine.effects={master:{},returns:{},tracks:[]} as unknown as AudioEngine['effects'];
 assert.equal(canCapture(engine,project),false);
 Object.assign(engine.effects!.returns,{delay:{},reverb:{}});
 assert.equal(canCapture(engine,project),true);
 assert.equal(canCapture(engine,{...project}),false);
});
