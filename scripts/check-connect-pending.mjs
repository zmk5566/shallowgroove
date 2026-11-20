import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const web=new URL('../../hexblocks_connect/web/',import.meta.url);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();let pending,requests=0;
 await page.route('http://connect.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/state')return route.fulfill({json:{csrf:'test',server:'ws://127.0.0.1:5198/hexblocks/ws',networkConnected:false,transport:{kind:'ble',connected:false},devices:[{address:'test-hub',name:'Test Hub',rssi:-50}],modules:[],log:[]}});
  if(path==='/api/action'){requests++;await new Promise(resolve=>{pending=async(status,body)=>{await route.fulfill({status,json:body});resolve();};});return;}
  if(path==='/visuals.js')return route.fulfill({contentType:'text/javascript',body:'export function updateVisuals(){}'});
  if(path==='/theme.css')return route.fulfill({body:''});
  const file=path==='/'?'index.html':path.slice(1);
  return route.fulfill({body:await readFile(new URL(file,web)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 await page.goto('http://connect.test/?locale=zh-CN');await expect(page.locator('#ble')).toHaveValue('test-hub');await page.locator('#connections').click();
 const button=page.locator('#connect-ble');await button.click();await expect(button).toHaveText('连接中…');await expect(button).toBeDisabled();await expect(button).toHaveAttribute('aria-busy','true');
 await button.evaluate(el=>{el.click();el.onclick();el.onclick();});assert.equal(requests,1);
 await page.locator('#language').evaluate(el=>{el.value='en';el.dispatchEvent(new Event('change'));});await expect(button).toHaveText('Connecting…');await expect(button).toBeDisabled();
 await pending(500,{error:'Test connection failure'});await expect(button).toBeEnabled();await expect(button).toHaveText('Connect');await expect(page.locator('#connection-error')).toContainText('Test connection failure');
 await button.click();await expect(button).toBeDisabled();await expect.poll(()=>requests).toBe(2);await pending(200,{ok:true});await expect(page.locator('#connection-dialog')).not.toBeVisible();await expect(button).toBeEnabled();await expect(button).toHaveAttribute('aria-busy','false');
 console.log('PASS: immediate pending label, duplicate-click guard, locale switch, failure retry and success recovery');
}finally{await browser.close();}
