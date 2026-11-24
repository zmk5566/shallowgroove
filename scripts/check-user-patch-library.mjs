import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{"configured":false}');return;}
 const file=resolve(root,'dist','.'+(path==='/'?'/index.html':path));
 if(!file.startsWith(resolve(root,'dist')+'/')){res.writeHead(403).end();return;}
 try{
  const body=await readFile(file);
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
  res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');res.end(body);
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
try{
 const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 context.setDefaultTimeout(15000);
 await page.goto(base);
 await page.getByLabel('Language / 语言').selectOption('en');
 await page.locator('[data-example="DaisyBell"]').click();
 const open=p=>p.getByRole('button',{name:'Open device library'}).click();
 const dialog=p=>p.locator('.effect-picker[open]');
 const fx=p=>p.locator('.effect-card').last();
 const feedback=p=>fx(p).getByLabel('Feedback',{exact:true});
 async function setFeedback(value){
  await feedback(page).evaluate((input,value)=>{
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
   input.dispatchEvent(new Event('input',{bubbles:true}));
  },value);
 }
 async function load(p){
  await open(p);
  await dialog(p).getByRole('button',{name:'User',exact:true}).click();
  await dialog(p).locator('.patch-library-results button').filter({hasText:'Tape echo'}).click();
  await expect(dialog(p)).toHaveCount(0);
 }
 await open(page);
 await dialog(page).getByRole('searchbox').fill('slapback');
 await dialog(page).getByRole('button',{name:/slapback/i}).click();
 await setFeedback('0.25');
 await open(page);
 await dialog(page).getByRole('button',{name:'Save to User Library'}).click();
 await dialog(page).getByLabel('Preset name').fill('Tape echo');
 await dialog(page).getByRole('button',{name:'Save',exact:true}).click();
 await expect(dialog(page).locator('.patch-library-current-row')).toContainText('v1');
 await page.keyboard.press('Escape');
 const firstId=await fx(page).getAttribute('data-effect-id');
 await page.getByLabel('Select channel 2',{exact:true}).click();
 await load(page);
 assert.notEqual(await fx(page).getAttribute('data-effect-id'),firstId);
 await expect(feedback(page)).toHaveValue('0.25');
 await setFeedback('0.5');
 await open(page);
 await dialog(page).getByRole('button',{name:'Save new revision'}).click();
 await expect(dialog(page).locator('.patch-library-current-row')).toContainText('v2');
 await page.keyboard.press('Escape');
 await page.getByLabel('Select channel 1',{exact:true}).click();
 await expect(feedback(page)).toHaveValue('0.25');
 const download=page.waitForEvent('download');
 await page.locator('.project-filebar').getByRole('button',{name:'Export ZIP'}).click();
 const bytes=await readFile(await (await download).path());
 const doc=JSON.parse(strFromU8(unzipSync(bytes)['project.json']));
 assert.equal(doc.session.chains[0].at(-1).libraryRef.revision,1);
 assert.equal(doc.session.chains[1].at(-1).libraryRef.revision,2);
 await fx(page).locator('.device-select').click();
 await open(page);
 await dialog(page).getByRole('button',{name:'Update to v2'}).click();
 await expect(feedback(page)).toHaveValue('0.5');
 assert.equal(await fx(page).getAttribute('data-effect-id'),firstId);
 const second=await context.newPage();
 await second.goto(base);
 await second.getByLabel('Language / 语言').selectOption('en');
 const hasDraft=await second.locator('.welcome-recovery').isVisible();
 await second.locator('.welcome-create').click();
 if(hasDraft)await second.getByRole('button',{name:'Don’t save',exact:true}).click();
 await load(second);
 await expect(feedback(second)).toHaveValue('0.5');
 const fresh=await browser.newContext({viewport:{width:1200,height:850}});
 const other=await fresh.newPage();
 other.on('pageerror',e=>errors.push(e.message));
 await other.goto(base);
 await other.getByLabel('Language / 语言').selectOption('en');
 await other.locator('input[type=file]').setInputFiles({name:'Snapshot.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
 await expect(feedback(other)).toHaveValue('0.25',{timeout:30000});
 await open(other);
 await dialog(other).getByRole('button',{name:'User',exact:true}).click();
 await expect(dialog(other)).toContainText('No saved devices yet.');
 assert.deepEqual(errors,[]);
 console.log('PASS independent instances, explicit revision update, ZIP snapshot and cross-project reuse');
}finally{await browser.close();server.close();}
