import {multitrackFixture} from './multitrack-fixture.mjs';
import {createServer} from 'vite';import {chromium,expect} from '@playwright/test';import {mkdtemp,rm} from 'node:fs/promises';import assert from 'node:assert/strict';
const temp=await mkdtemp('/private/tmp/shallow-scroll-');process.env.SHALLOWGROOVE_DATA_DIR=temp;process.env.DEEPSEEK_API_KEY='';const vite=await createServer({plugins:[multitrackFixture()],root:new URL('../',import.meta.url).pathname,server:{host:'127.0.0.1',port:0}});let browser;
try{await vite.listen();browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(vite.resolvedUrls.local[0]);await page.locator('[data-example="DaisyBell"]').click();await expect(page.getByLabel('Play',{exact:true})).toBeEnabled({timeout:120000});
const main=page.locator('.studio-main'),mixer=page.locator('.mixer-tracks'),tracks=page.locator('.track-list');
await mixer.scrollIntoViewIfNeeded();const mx=await mixer.boundingBox(),outer=await main.evaluate(e=>e.scrollTop);await page.mouse.move(mx.x+40,mx.y+15);await page.mouse.wheel(0,400);await expect.poll(()=>mixer.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);assert.equal(await main.evaluate(e=>e.scrollTop),outer);
await tracks.scrollIntoViewIfNeeded();const tr=await tracks.boundingBox(),before=await main.evaluate(e=>e.scrollTop);await page.mouse.move(tr.x+200,tr.y+20);await page.mouse.wheel(0,500);await expect.poll(()=>tracks.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);assert.equal(await main.evaluate(e=>e.scrollTop),before);
const h=await page.locator('.track').first().evaluate(e=>e.getBoundingClientRect().height);await page.getByLabel('Increase track height',{exact:true}).click();await expect.poll(()=>page.locator('.track').first().evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThan(h);await page.getByLabel('Decrease track height',{exact:true}).click();await expect.poll(()=>page.locator('.track').first().evaluate(e=>e.getBoundingClientRect().height)).toBe(h);
const handle=page.getByRole('separator',{name:'Resize arrangement height'});await handle.scrollIntoViewIfNeeded();const size=await page.locator('[aria-label="轨道总览"]').evaluate(e=>e.getBoundingClientRect().height),hb=await handle.boundingBox();await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2+100,{steps:6});await page.mouse.up();await expect.poll(()=>page.locator('[aria-label="轨道总览"]').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThan(size+80);
await handle.focus();const larger=await handle.getAttribute('aria-valuenow');await handle.press('ArrowUp');await expect.poll(async()=>Number(await handle.getAttribute('aria-valuenow'))).toBeLessThan(Number(larger));
for(const viewport of [{width:1440,height:960},{width:1024,height:768},{width:1280,height:720}]){
 await page.setViewportSize(viewport);await page.waitForTimeout(150);
 const geometry=await main.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,panels:[...e.children].map(p=>({top:p.getBoundingClientRect().top,bottom:p.getBoundingClientRect().bottom})),bottom:e.getBoundingClientRect().bottom}));
 assert.ok(geometry.scroll<=geometry.height+1,JSON.stringify(geometry));assert.ok(geometry.panels.every(p=>p.bottom<=geometry.bottom+1));
 assert.ok(await page.locator('.piano-scroll').evaluate(e=>e.clientHeight>10));
}
const toggles=page.locator('.workspace-panel-toggle');
for(let i=0;i<4;i++)await toggles.nth(i).click();
assert.ok(await main.evaluate(e=>e.scrollHeight<=e.clientHeight+1));
for(let i=3;i>=0;i--){await toggles.nth(i).click();await page.waitForTimeout(40);assert.ok(await main.evaluate(e=>e.scrollHeight<=e.clientHeight+1));}
await page.setViewportSize({width:1024,height:768});await mixer.scrollIntoViewIfNeeded();assert.ok(await mixer.evaluate(e=>e.scrollWidth>e.clientWidth));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await tracks.scrollIntoViewIfNeeded();await page.screenshot({path:'/private/tmp/shallow-workspace-scroll.png'});assert.deepEqual(errors,[]);console.log('PASS mixer wheel scroll, independent vertical tracks, track zoom, drag/keyboard panel resize and compact layout');
await page.locator('.view-switch button').filter({has:page.locator('i.session')}).click();
const session=page.locator('.session-scroll');
for(const viewport of [{width:1440,height:960},{width:1024,height:768},{width:610,height:720}]){
 await page.setViewportSize(viewport);
 for(const [scroller,x] of [[session,137],[mixer,1e6],[session,0]]){
  await scroller.evaluate((el,x)=>{el.scrollLeft=x;},x);
  await expect.poll(()=>page.evaluate(()=>{
   const strips=[...document.querySelectorAll('.mixer-tracks>.channel-strip')];
   const columns=[...document.querySelectorAll('.session-scroll thead th')];
   if(!strips.length||columns.length!==strips.length)return Infinity;
   return Math.max(...strips.map((strip,i)=>{
    const a=strip.getBoundingClientRect(),b=columns[i].getBoundingClientRect();
    return Math.max(Math.abs(a.left-b.left),Math.abs(a.right-b.right));
   }));
  })).toBeLessThan(1);
 }
}
console.log('PASS session columns align with mixer strips across widths and scroll positions');
}finally{await browser?.close();await vite.close();await rm(temp,{recursive:true,force:true});}
