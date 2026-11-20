// Browser plugin not available: use Playwright against the real welcome component and stylesheet.
import {chromium} from '@playwright/test';
import {transformWithOxc} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');await mkdir(join(root,'build'),{recursive:true});const temp=await mkdtemp(join(root,'build/welcome-layout-'));let browser;
try{
 const path=join(root,'src/components/ProjectWelcome.tsx');const {code}=await transformWithOxc(await readFile(path,'utf8'),path,{jsx:{runtime:'automatic'}});const file=join(temp,'welcome.mjs');await writeFile(file,code);const {ProjectWelcome}=await import(pathToFileURL(file).href);
 const css=await readFile(join(root,'src/styles.css'),'utf8');browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});const noop=()=>{};
 for(const locale of ['zh-CN','en'])for(const populated of [false,true])for(const size of [{width:1440,height:960},{width:1280,height:720},{width:1000,height:700}]){
  const state={home:true,busy:false,initialized:true,dirty:false,id:null,name:'Untitled',source:'new',recent:populated?Array.from({length:30},(_,i)=>({id:String(i),name:`Saved project ${i+1}`,location:'browser',updated:1})):[],draft:populated?{text:'{}',id:null,name:'Unsaved project',source:'example',baseline:'',updated:1}:null,error:populated?'A recoverable project error. Please choose a project.':'',status:''};
  const html=renderToStaticMarkup(createElement(ProjectWelcome,{state,locale,onLocale:noop,onExample:noop,onNew:noop,onRecent:noop,onFolder:noop,onImport:noop,onRecover:noop,onDiscardDraft:noop,desktop:true,version:'test'}));
  await page.setViewportSize(size);await page.setContent(`<style>${css}</style><div id="root">${html}</div>`);await page.waitForTimeout(50);
  const geometry=await page.evaluate(()=>{const main=document.querySelector('.project-welcome'),list=document.querySelector('.welcome-example-list');return {outer:main.scrollHeight-main.clientHeight,body:document.documentElement.scrollHeight-innerHeight,width:document.documentElement.scrollWidth-innerWidth,list:list.scrollHeight-list.clientHeight,buttons:[...document.querySelectorAll('[data-example],.welcome-create,.welcome-file-actions button,.welcome-footer')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom};})};});
  assert.ok(geometry.outer<=1&&geometry.body<=1&&geometry.width<=1,JSON.stringify({locale,populated,size,geometry}));assert.ok(geometry.list<=1,'All four examples should fit');assert.ok(geometry.buttons.every(r=>r.top>=0&&r.bottom<=size.height),JSON.stringify(geometry));
  if(populated){const recent=page.locator('.welcome-project-list');assert.ok(await recent.evaluate(e=>e.scrollHeight>e.clientHeight));await recent.evaluate(e=>{e.scrollTop=e.scrollHeight;});assert.ok(await recent.evaluate(e=>e.scrollTop>0));}
  if(locale==='zh-CN'&&size.width===1000)await page.screenshot({path:`/private/tmp/shallow-welcome-${populated?'populated':'empty'}.png`});
 }
 console.log('PASS: fixed welcome height, all four examples visible, compact desktop sizes, both languages, recovery/errors and recent-project scrolling');
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
