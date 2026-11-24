import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {_electron,expect} from '@playwright/test';

const root=resolve(import.meta.dirname,'..'),example=process.argv[2]??'Korobeiniki';
const profile=await mkdtemp(join(tmpdir(),'sg-native-workstation-'));
const app=await _electron.launch({args:[root,'--vite-dev','--user-data-dir='+profile],cwd:root,timeout:60000});
let page;
try{
 page=await app.firstWindow();
 page.setDefaultTimeout(60000);
 await page.getByLabel('Language / 语言').selectOption('en');
 await page.locator('[data-example="'+example+'"]').click();
 await page.getByRole('button',{name:'Audio / MIDI',exact:true}).click();
 const engine=page.getByLabel('Audio engine',{exact:true});
 await engine.selectOption('native');
 await expect(engine).toHaveValue('native',{timeout:60000});
 await expect(engine).toBeEnabled({timeout:60000});
 await expect(engine).toHaveValue('native');
 await page.getByLabel('Close MIDI settings').click();
 const status=()=>page.evaluate(()=>window.sgNativeAudio.request({op:'status'}));
 const tracks=(await status()).tracks;
 assert.ok(tracks>=2);
 const metro=page.getByRole('button',{name:'Metronome',exact:true});
 if(await metro.getAttribute('aria-pressed')!=='true')await metro.click();
 await page.getByLabel('Count-in',{exact:true}).selectOption('1');
 const play=page.getByRole('button',{name:'Play',exact:true});
 const countLabel=page.getByLabel('Count-in position');
 await play.click();
 await expect(countLabel).toBeVisible();
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await expect(countLabel).toHaveCount(0);
 await expect.poll(async()=>(await status()).playing).toBe(false);
 await play.click();await expect(countLabel).toBeVisible();
 assert.equal((await status()).position,0,'count-in must leave playhead stationary');
 await expect(play).toHaveAttribute('aria-pressed','true',{timeout:12000});
 await expect.poll(async()=>(await status()).position).toBeGreaterThan(0);
 await metro.click();
 await page.locator('.channel-inspect').first().click();
 await page.locator('.inspect-picker .primary').click();
 await expect(page.locator('.inspect-card')).toHaveCount(3);
 await expect.poll(async()=>page.getByRole('meter').evaluateAll(nodes=>nodes.some(n=>Number(n.getAttribute('aria-valuenow'))>0)),{timeout:10000}).toBe(true);
 if(example==='Korobeiniki'){
  await page.getByRole('button',{name:'Session',exact:true}).click();
  const scenes=page.getByRole('button',{name:/^Launch scene /});
  assert.ok(await scenes.count()>1);
  await scenes.nth(1).click();
  const back=page.getByRole('button',{name:'Back to arrangement',exact:true});
  await expect(back).toBeVisible();
  await expect(page.locator('.session-view tbody tr').nth(1).locator('td.sounding[data-clip-id]').first()).toBeVisible({timeout:10000});
  await back.click();
 }
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await expect(play).toHaveAttribute('aria-pressed','false');
 console.log(example,tracks,'native tracks, stationary count-in, playback, inspector and meter OK');
}catch(error){
 if(page)console.error((await page.locator('body').innerText()).slice(0,4200));
 throw error;
}finally{
 await app.evaluate(({app})=>app.exit()).catch(()=>{});
 await app.close().catch(()=>{});
 await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
