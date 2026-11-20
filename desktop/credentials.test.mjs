import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {credentialStore,validateKey} from './credentials.cjs';
import {stageApplication,verifyEdition} from './edition.mjs';

test('verify against the official endpoint and avoid replacing a key after rejected authentication',async()=>{
 const request=async(url,options)=>{
  assert.equal(url,'https://api.deepseek.com/models');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer fixture');return Response.json({data:[{id:'test'}]});
 };
 assert.equal(await validateKey('fixture',request),'ok');
 assert.equal(await validateKey('invalid key',()=>assert.fail()),'invalid');
 assert.equal(await validateKey('fixture',()=>new Response(null,{status:401})),'invalid');
 assert.equal(await validateKey('fixture',()=>new Response(null,{status:503})),'network');
});
test('credential storage delegates to OS encryption and survives restart, replacement and removal',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sg-key-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
 const store=credentialStore(dir,storage);assert.equal(store.read(),'');store.save('fixture');
 assert.equal(credentialStore(dir,storage).read(),'fixture');
 assert.notEqual(await readFile(join(dir,'deepseek-key.enc'),'utf8'),'fixture');
 assert.throws(()=>credentialStore(dir,{isEncryptionAvailable:()=>false}).save('bad'));
 assert.equal(store.read(),'fixture');store.save('replacement');assert.equal(store.read(),'replacement');store.save(null);assert.equal(store.read(),'');
});
test('public and private builds use separate fresh staging directories and include only intended credentials',async t=>{
 const root=await mkdtemp(join(tmpdir(),'sg-edition-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const file of ['package.json','package-lock.json','LICENSE','LICENSE-EXAMPLES','NOTICE.md'])await writeFile(join(root,file),'{}');
 for(const dir of ['desktop','server','src','dist'])await mkdir(join(root,dir));
 const publicStage=()=>stageApplication(root,'mac',false);
 await verifyEdition(join(await publicStage(),'app'),false);
 const file='desktop/private-config.json';
 await writeFile(join(root,file),JSON.stringify({DEEPSEEK_API_KEY:'synthetic',unrelated:'excluded'}));
 const privateApp=join(await stageApplication(root,'mac',true),'app');
 await verifyEdition(privateApp,true);assert.deepEqual(JSON.parse(await readFile(join(privateApp,file))),{DEEPSEEK_API_KEY:'synthetic'});
 const publicApp=join(await publicStage(),'app');await verifyEdition(publicApp,false);
 await assert.rejects(access(join(publicApp,file)));await assert.rejects(verifyEdition(privateApp,false));
});

test('packaged backend switches personal credentials and restores the correct edition without restarting',async t=>{
 const {fork}=await import('node:child_process');
 const {once}=await import('node:events');
 const {symlink,copyFile}=await import('node:fs/promises');
 const project=join(import.meta.dirname,'..');
 const root=await mkdtemp(join(tmpdir(),'sg-key-backend-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const dir of ['server','src','node_modules'])await symlink(join(project,dir),join(root,dir),'dir');
 await mkdir(join(root,'desktop'));await copyFile(join(project,'desktop/server.mjs'),join(root,'desktop/server.mjs'));
 for(const edition of ['none','builtin']){
  if(edition==='builtin')await writeFile(join(root,'desktop/private-config.json'),JSON.stringify({DEEPSEEK_API_KEY:'synthetic-builtin'}));
  const child=fork(join(root,'desktop/server.mjs'),[],{stdio:['ignore','ignore','inherit','ipc'],env:{...process.env,DEEPSEEK_API_KEY:'ignored-inherited-key',SHALLOWGROOVE_DATA_DIR:root}});
  try{
   const [{port}]=await once(child,'message');
   const status=async()=>{const res=await fetch('http://127.0.0.1:'+port+'/api/assistant/status');const json=await res.json();assert.doesNotMatch(JSON.stringify(json),/synthetic-|ignored-inherited-key/);return json;};
   assert.equal((await status()).keySource,edition);
   for(const [key,source] of [['synthetic-personal',edition==='builtin'?'builtin':'user'],['',edition]]){
    const ack=once(child,'message');child.send({type:'credential',id:'test',key});assert.deepEqual((await ack)[0],edition==='builtin'?{ack:'test',ignored:true}:{ack:'test'});
    const state=await status();assert.equal(state.keySource,source);assert.equal(state.configured,source!=='none');
   }
  }finally{const exit=once(child,'exit');child.send({type:'shutdown'});await exit;}
 }
});
