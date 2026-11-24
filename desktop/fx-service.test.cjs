const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm,writeFile,readFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {PassThrough,Readable}=require('node:stream');
const {runWorker,handleRequest}=require('./fx-service.cjs');
async function profile(t){
 const directory=await mkdtemp(join(tmpdir(),'sgfx-test-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 return {directory,root:join(__dirname,'..'),viteDev:true};
}
test('save, revise, list and reject stale revisions using desktop library',async t=>{
 const options=await profile(t);
 const save={op:'save',name:'Wet gain',code:'process=_,_;',values:{gain:.2}};
 const {entry}=await handleRequest(save,options);
 const next=await handleRequest({...save,previous:entry},options);
 assert.equal(next.entry.revision,2);
 await assert.rejects(handleRequest({...save,previous:entry},options),/changed/);
 const {entries}=await handleRequest({op:'list'},options);
 assert.deepEqual(entries.filter(e=>!e.id.startsWith('factory:')),[next.entry]);
 assert.match(entries.find(e=>e.kind==='chorus').code,/process=/);
});
test('one-shot transports return readable results',async t=>{
 const options=await profile(t);
 const file=join(options.directory,'request.json');
 await writeFile(file,JSON.stringify({op:'list'}));await runWorker(options,file);
 assert.equal(JSON.parse(await readFile(join(options.directory,'result.json'))).entries.length,8);
 const output=new PassThrough();await runWorker(options,undefined,Readable.from(['invalid\n']),output);
 assert.equal(output.read().toString(),'SGFX:{"ok":false,"error":"Invalid JSON request"}\n');
});
test('plugin turns can only run through the shared Assistant',async t=>{
 const options=await profile(t);
 await assert.rejects(handleRequest({op:'edit'},options),/shared Assistant/);
});
test('a paired preview uses the private edition without exposing its key or changing the library profile',async t=>{
 const opts=await profile(t);
 const {mkdir}=require('node:fs/promises');
 const appRoot=join(opts.directory,'Private App');
 await mkdir(join(appRoot,'desktop'),{recursive:true});
 await writeFile(join(appRoot,'desktop/private-config.json'),JSON.stringify({DEEPSEEK_API_KEY:'test-private',SHALLOWGROOVE_MODEL:'test-model'}));
 await writeFile(join(opts.directory,'fx-private-edition.json'),JSON.stringify({appRoot}));
 assert.deepEqual(await handleRequest({op:'assistant-status'},opts),{configured:true,source:'builtin'});
 assert.deepEqual(await handleRequest({op:'assistant-status'},{...opts,viteDev:false}),{configured:false,source:'none'});
});
