import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {readDocument,unzipDocument} from '../src/model/project-files.ts';
const temp=await mkdtemp('/private/tmp/shallow-korobeiniki-');process.env.SHALLOWGROOVE_DATA_DIR=temp;process.env.DEEPSEEK_API_KEY='';
const vite=await createServer({root:new URL('../',import.meta.url).pathname,server:{host:'127.0.0.1',port:0}});let browser;
try{
 await vite.listen();browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(vite.resolvedUrls.local[0]);await page.locator('[data-example="Korobeiniki"]').click();await expect(page.getByLabel('Play',{exact:true})).toBeEnabled({timeout:120000});
 await expect(page.getByLabel('Sound set',{exact:true})).toHaveValue('period');assert.match(await page.getByLabel('Sound set',{exact:true}).textContent(),/2018/);
 const manifest=JSON.parse(await readFile(new URL('../patches/korobeiniki/manifest.json',import.meta.url),'utf8'));
 async function exportAndCheck(){const download=page.waitForEvent('download');await page.locator('.project-filebar').getByRole('button',{name:'导出 ZIP',exact:true}).click();const path=await (await download).path();const doc=readDocument(unzipDocument(await readFile(path)));assert.equal(doc.editor.exampleId,'Korobeiniki');assert.equal(doc.session.voices.length,4);
  for(let i=0;i<4;i++){const patch=manifest.patches.find(p=>p.track_id===doc.session.project.tracks[i].id);assert.ok(patch);assert.equal(doc.session.voices[i].code,await readFile(new URL('../patches/korobeiniki/'+patch.file,import.meta.url),'utf8'));}
 }
 await exportAndCheck();await page.getByLabel('Play',{exact:true}).click();await page.waitForTimeout(4500);await page.getByLabel('Stop',{exact:true}).click();
 await page.locator('.project-filebar').getByRole('button',{name:'保存',exact:true}).click();await page.getByLabel('Project name').fill('Korobeiniki test');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('.project-filebar strong')).toHaveText('Korobeiniki test');
 await page.reload();await page.getByRole('button',{name:/Korobeiniki test/}).click();await expect(page.getByLabel('Play',{exact:true})).toBeEnabled({timeout:120000});await exportAndCheck();
 await page.screenshot({path:'/private/tmp/korobeiniki-example.png'});assert.deepEqual(errors,[]);console.log('PASS: example opens with 4 assigned 2018 patches, playback, ZIP export, browser save/reload and patch preservation');
}finally{await browser?.close();await vite.close();await rm(temp,{recursive:true,force:true});}
