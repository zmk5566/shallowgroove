import {chromium} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
try{
 const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://shallowgroove.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/api/'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({configured:false})});
  const file=resolve(root,'dist','.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(resolve(root,'dist')+'/'))return route.abort();
  try{const body=await readFile(file);const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};await route.fulfill({body,contentType:types[extname(file)]??'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Not found'});}
 });
 await page.goto('https://shallowgroove.test/');
 await page.getByRole('heading',{name:'音乐工作台'}).waitFor();
 await mkdir(resolve(root,'build'),{recursive:true});
 await page.screenshot({path:resolve(root,'build/project-welcome.png'),fullPage:true});
 await page.getByRole('button',{name:'新建项目',exact:true}).click();
 await page.locator('.project-filebar').waitFor({timeout:60000});
 await page.locator('.project-filebar').getByRole('button',{name:'保存',exact:true}).click();
 await page.getByLabel('Project name').fill('Welcome smoke');
 await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();
 await page.locator('.project-save-status').filter({hasText:'已保存到此浏览器'}).waitFor();
 await page.reload();
 await page.getByRole('heading',{name:'继续已有项目',exact:true}).waitFor();
 await page.getByRole('button',{name:/Welcome smoke/}).click();
 await page.locator('.project-filebar').waitFor({timeout:60000});
 const download=page.waitForEvent('download');await page.locator('.project-filebar').getByRole('button',{name:'导出 ZIP'}).click();assert.ok((await download).suggestedFilename().endsWith('.zip'));
 assert.deepEqual(errors,[]);
 console.log('PASS welcome, new project, browser save, reload, recent project and ZIP export');
}finally{await browser.close();}
