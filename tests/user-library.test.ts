import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createUserLibrary} from '../desktop/user-library.cjs';
import {makeLibraryEntry,validLibraryRef} from '../src/model/library-entry.mjs';

test('library publishes immutable revisions and rejects stale simultaneous edits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sg-library-'));
 try {
  const store=createUserLibrary(root), second=createUserLibrary(root);
  const patch={kind:'delay',code:'process=_,_;',values:{feedback:0.2}};
  assert.deepEqual(await store.list(),[]);
  const first=await store.save(' Echo ',patch);
  patch.values.feedback=0.5;
  assert.equal(first.name,'Echo');
  assert.equal(first.values.feedback,0.2);
  const attempts=await Promise.allSettled([store.save('Echo',patch,first),second.save('Long echo',patch,first)]);
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
  const [latest]=await createUserLibrary(root).list();
  assert.equal(latest.revision,2);
  assert.equal(latest.id,first.id);
  assert.deepEqual(JSON.parse(await readFile(join(root,'User Library',first.id,'1.json'),'utf8')),first);
  await assert.rejects(store.save('Echo',patch,first),/changed/);
  const variation=await store.save('Echo variation',patch);
  assert.notEqual(variation.id,first.id);
  assert.equal((await second.list()).length,2);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('library rejects invalid data and references before constructing revision paths',()=>{
 assert.equal(validLibraryRef({id:'../x',revision:1,name:'test'}),false);
 assert.throws(()=>makeLibraryEntry('Example',{kind:'custom',code:'process=_,_;',values:{gain:NaN}}),/parameter/);
 assert.throws(()=>makeLibraryEntry('',{kind:'instrument',code:'process=0;',values:{}}),/name/);
});
