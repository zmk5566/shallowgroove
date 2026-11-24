import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeDependencies} from './runtime-dependencies.mjs';

async function fixture(t){
 const app=await mkdtemp(join(tmpdir(),'shallowgroove-dependency-test-'));
 t.after(()=>rm(app,{recursive:true,force:true}));
 await mkdir(join(app,'server'));
 await writeFile(join(app,'server/assistant.mjs'),"const options={profile:'sdk-minimal'};");
 async function pkg(name,extra={},code,base=app){
  const dir=join(base,'node_modules',name);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'package.json'),JSON.stringify({name,version:'0.2.2-rc.1',...extra}));
  if(code){await mkdir(join(dir,'lib'));await writeFile(join(dir,'lib/index.js'),code);}
  return dir;
 }
 await pkg('@grame/faustwasm');
 await pkg('@deepseek-ai/dsh-sdk-client',{dependencies:{'@deepseek-ai/dsh':'*'}});
 await pkg('@deepseek-ai/dsh-sdk-minimal',{dependencies:{'@deepseek-ai/dsh-sdk-app':'*',service:'*'}});
 for(const name of ['dsh-web','dsh-web-search-deepseek','dsh-tool-web','dsh-tools'])await pkg('@deepseek-ai/'+name);await pkg('ws');
 await pkg('@deepseek-ai/dsh',{dependencies:{unused:'*',boot:'*'}},"import 'boot';");
 await pkg('@deepseek-ai/dsh-sdk-app',{dependencies:{office:'*'}},"export const name='sdk';");
 await pkg('boot');await pkg('unused');await pkg('office');
 const service=await pkg('service',{dependencies:{nested:'*'},peerDependencies:{peer:'*',optionalPeer:'*'},peerDependenciesMeta:{optionalPeer:{optional:true}}});
 await pkg('nested',{},undefined,service);await pkg('peer');
 await mkdir(join(app,'node_modules/.bin'));
 return {app,pkg};
}

test('keeps required peers and nested packages while removing unrelated profiles',async t=>{
 const {app}=await fixture(t);
 const preview=await runtimeDependencies(app,{dryRun:true});
 assert.ok(preview.removed.includes('node_modules/office'));
 await access(join(app,'node_modules/office/package.json'));
 const result=await runtimeDependencies(app);
 assert.equal(result.kept,14);
 for(const file of ['@grame/faustwasm/package.json','peer/package.json','service/node_modules/nested/package.json','boot/package.json'])await access(join(app,'node_modules',file));
 for(const file of ['office','unused','.bin'])await assert.rejects(access(join(app,'node_modules',file)),{code:'ENOENT'});
});

test('missing required peers abort pruning before removing anything',async t=>{
 const {app}=await fixture(t);
 await rm(join(app,'node_modules/peer'),{recursive:true});
 await assert.rejects(runtimeDependencies(app),/Missing runtime dependency peer/);
 await access(join(app,'node_modules/office/package.json'));
});

test('an SDK upgrade requires explicit review before pruning',async t=>{
 const {app}=await fixture(t);
 const path=join(app,'node_modules/@deepseek-ai/dsh/package.json');
 const pkg=JSON.parse(await readFile(path,'utf8'));pkg.version='0.3.0';await writeFile(path,JSON.stringify(pkg));
 await assert.rejects(runtimeDependencies(app),/Review narrowed runtime dependencies/);
 await access(join(app,'node_modules/office/package.json'));
});
