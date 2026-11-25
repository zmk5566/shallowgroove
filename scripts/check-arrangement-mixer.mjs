import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {multitrackFixture} from './multitrack-fixture.mjs';

const directory=await mkdtemp(join(tmpdir(),'sg-arrangement-mixer-'));
process.env.SHALLOWGROOVE_DATA_DIR=directory;
process.env.DEEPSEEK_API_KEY='';
const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),plugins:[multitrackFixture()],server:{host:'127.0.0.1',port:0}});
let browser;
try{
 await vite.listen();
 browser=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(vite.resolvedUrls.local[0]);
 await page.locator('[data-example="DaisyBell"]').click();
 await expect(page.getByLabel('Play',{exact:true})).toBeEnabled({timeout:120000});
 const main=page.locator('.studio-main');
 const switchView=mode=>page.locator('.view-switch button').filter({has:page.locator('i.'+mode)}).click();
 const track=index=>page.locator('.track[data-track="'+index+'"]');
 const trackSlider=(index,address)=>page.locator('.arrangement-track-mix[data-track-mix="'+index+'"]').locator('input[data-address="'+address+'"]');
 const bus=id=>page.locator('.arrangement-buses [data-channel="'+id+'"]');
 const busSlider=id=>bus(id).locator('input[data-address="gain"]');
 // Compare the actual panel edges. A removed mixer must not leave an empty grid row.
 async function layout(count){
  await expect(main.locator(':scope > .workspace-panel')).toHaveCount(count);
  await expect.poll(()=>main.evaluate((el,count)=>{
   const panels=[...el.querySelectorAll(':scope > .workspace-panel')].map(p=>p.getBoundingClientRect());
   const css=getComputedStyle(el),box=el.getBoundingClientRect();
   const bottomGap=box.bottom-panels.at(-1).bottom-parseFloat(css.paddingBottom)-parseFloat(css.borderBottomWidth);
   return Math.max(Math.abs(css.gridTemplateRows.split(' ').length-count)*100,el.scrollHeight-el.clientHeight,Math.abs(bottomGap));
  },count)).toBeLessThan(3);
 }
 await expect(page.locator('#mixer-content')).toHaveCount(0);
 await layout(3);
 for(const i of [0,1]){
  const toggle=track(i).locator('.track-fold');
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
 }
 await expect(trackSlider(0,'gain')).toBeVisible();
 await expect(trackSlider(1,'gain')).toBeVisible();
 async function checkMixSpacing(){
  const bounds=await track(0).evaluate(el=>{
   const rect=selector=>el.querySelector(selector).getBoundingClientRect();
   for(const dial of el.querySelectorAll('.arr-dial')){
    if(getComputedStyle(dial).borderTopLeftRadius!=='50%'||dial.offsetWidth!==dial.offsetHeight)throw Error('Send dial must render as a circle');
   }
   return {gap:rect('.arr-track-fader').top-rect('.track-controls').bottom,
    automationGap:rect('.automation-controls').top-rect('.arrangement-track-mix').bottom,
    curveHeight:rect('.automation-canvas').height,trackHeight:el.getBoundingClientRect().height};
  });
  assert.ok(bounds.gap>=0&&bounds.gap<=2&&bounds.automationGap===0,JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.curveHeight-bounds.trackHeight)<=2,JSON.stringify(bounds));
 }
 await checkMixSpacing();
 const picker=page.locator('.inspect-picker');
 async function inspect(button,title){
  await button.click();await expect(picker).toBeVisible();
  const text=await picker.locator('p').innerText();
  assert.ok([title+' · 通道输出',title+' · Channel output'].includes(text),text);
  await page.keyboard.press('Escape');await expect(picker).toHaveCount(0);
 }
 await inspect(page.locator('[data-track-mix="0"] .channel-inspect'),'CH 1 · '+await track(0).locator('.track-label').innerText());
 await inspect(bus('master').locator('.channel-inspect'),'Master');
 await bus('reverb').getByLabel('Mute reverb channel').click();
 await expect(bus('reverb').getByLabel('Mute reverb channel')).toHaveAttribute('aria-pressed','true');
 const changed={gain:'0.72',pan:'-0.31','send.delay':'0.23','send.reverb':'0.61'};
 for(const [address,value] of Object.entries(changed)){
  await trackSlider(0,address).fill(value);await expect(trackSlider(0,address)).toHaveValue(value);
 }
 await busSlider('master').fill('0.83');
 await trackSlider(1,'send.reverb').click({button:'right'});
 await expect(track(1).getByLabel('Automation parameter')).toHaveValue(JSON.stringify(['mixer','send.reverb']));
 await busSlider('delay').click({button:'right'});
 await expect(page.locator('.arrangement-buses').getByLabel('Automation parameter')).toHaveValue(JSON.stringify(['mixer','gain']));
 await switchView('session');
 const mixer=page.locator('#mixer-content');
 await expect(mixer).toBeVisible();await layout(4);
 const sessionNames={gain:'volume',pan:'pan','send.delay':'delay send','send.reverb':'reverb send'};
 for(const [address,value] of Object.entries(changed))
  await expect(mixer.getByLabel('Channel 1 '+sessionNames[address],{exact:true})).toHaveValue(value);
 await expect(mixer.getByLabel('master channel volume')).toHaveValue('0.83');
 await expect(mixer.getByLabel('Mute reverb channel')).toHaveAttribute('aria-pressed','true');
 await mixer.getByLabel('Channel 1 pan',{exact:true}).fill('0.42');
 await mixer.getByLabel('master channel volume').fill('0.55');
 await switchView('arrangement');
 await expect(trackSlider(0,'pan')).toHaveValue('0.42');await expect(busSlider('master')).toHaveValue('0.55');
 await expect(trackSlider(1,'gain')).toBeVisible();
 await page.setViewportSize({width:1024,height:768});await layout(3);await checkMixSpacing();
 await switchView('performance');await page.locator('dialog[open] button[value=enter]').click();
 await expect(page.locator('#mixer-content')).toHaveCount(0);await layout(1);
 await switchView('session');await expect(mixer).toBeVisible();await layout(4);
 assert.deepEqual(errors,[]);
 console.log('PASS inline track and bus mix, two independent track folds, contextual automation, bidirectional Session values and three workspace layouts');
}finally{
 await browser?.close();await vite.close();await rm(directory,{recursive:true,force:true});
}
