import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
import {transformWithOxc} from 'vite';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import type {LibraryState} from '../src/model/project-manager.ts';
test('welcome exposes all three entry points and labels recovery separately from saved projects',async()=>{
 const root=resolve(import.meta.dirname,'..');await mkdir(join(root,'build'),{recursive:true});const temporary=await mkdtemp(join(root,'build/welcome-test-'));
 try{
  const source=await readFile(join(root,'src/components/ProjectWelcome.tsx'),'utf8');
  const code=(await transformWithOxc(source,join(root,'src/components/ProjectWelcome.tsx'),{jsx:{runtime:'automatic'}})).code;
  const file=join(temporary,'welcome.mjs');await writeFile(file,code);const {ProjectWelcome}=await import(pathToFileURL(file).href);
  const state:LibraryState={home:true,busy:false,initialized:true,dirty:false,id:null,name:'Untitled',source:'new',recent:[{id:'1',name:'Saved song',location:'browser',updated:1}],draft:{text:'{}',id:null,name:'Unsaved song',source:'example',baseline:'',updated:1},error:'',status:''};
  const noop=()=>{};const html=renderToStaticMarkup(createElement(ProjectWelcome,{state,locale:'en',onLocale:noop,onExample:noop,onNew:noop,onRecent:noop,onFolder:noop,onImport:noop,onRecover:noop,onDiscardDraft:noop,desktop:false,version:'test'}));
  for(const label of ['Continue a project','Open an example','New project','Saved song','Unsaved song','Not a formal save','Recover draft','data-example="DaisyBell"','data-example="Korobeiniki"'])assert.ok(html.includes(label),label);
  assert.equal((html.match(/data-example=/g)??[]).length,2);
  assert.ok(!html.includes('Open project folder'));
 }finally{await rm(temporary,{recursive:true,force:true});}
});
