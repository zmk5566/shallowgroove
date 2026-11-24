import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {_electron, expect} from '@playwright/test';
import nativeAudio from '../desktop/native-audio.cjs';

const root = resolve(import.meta.dirname, '..');
const binary = resolve(root, 'build-native/ShallowGrooveEngine');
const [, , secondDevice, rateArg, sizeArg] = process.argv;
const secondOutput = secondDevice ? {device:secondDevice,sampleRate:Number(rateArg),bufferSize:Number(sizeArg)} : undefined;
if (secondOutput) assert.ok(secondOutput.sampleRate>0 && secondOutput.bufferSize>0,'Pass the second output name and its original sample rate and buffer size');
const profile = await mkdtemp(join(tmpdir(), 'sg-native-ui-'));
const fixture = join(profile, 'native-preview.json');
const project = JSON.parse(await readFile(resolve(root, 'tests/fixtures/native-preview.json')));
project.session.project.timing.end_tick = 480 * 128;
await writeFile(fixture, JSON.stringify(project));
const automatic = {device:null, sampleRate:null, bufferSize:null};
let app, page, starting, attemptedSecond = false;
const field = name => page.getByLabel(name, {exact:true});
const button = name => page.getByRole('button', {name, exact:true});
const preferences = () => page.evaluate(() => window.sgNativeAudio.preferences());
const status = () => page.evaluate(() => window.sgNativeAudio.request({op:'status'}));
const values = s => ({device:s.audioDevice, sampleRate:s.sampleRate, bufferSize:s.bufferSize});

async function launch(engine) {
 app = await _electron.launch({args:[root,'--vite-dev','--user-data-dir='+profile],cwd:root,timeout:60000});
 assert.equal(await realpath(await app.evaluate(({app})=>app.getPath('userData'))),await realpath(profile));
 page = await app.firstWindow();
 page.setDefaultTimeout(30000);
 await page.getByLabel('Language / 语言').selectOption('en');
 await page.locator('input[type=file]').first().setInputFiles(fixture);
 await button('Audio / MIDI').click();
 await expect(field('Audio engine')).toHaveValue(engine,{timeout:45000});
 await expect.poll(async()=>(await preferences()).engine).toBe(engine);
 assert.equal((await page.evaluate(()=>window.sgNativeAudio.status())).running,engine==='native');
}
async function quit() {
 if (!app) return;
 await app.evaluate(({app})=>app.exit()).catch(()=>{});
 await app.close().catch(()=>{});
 app = undefined;
 page = undefined;
}
async function apply(output) {
 for (const [name,key] of [['Output device','device'],['Sample rate','sampleRate'],['Buffer size','bufferSize']])
  await field(name).selectOption(output[key]===null?'':String(output[key]));
 await field('Apply audio output').click();
 await expect(field('Audio engine')).toBeEnabled({timeout:45000});
 const issue=await page.locator('.native-output-settings [role=alert]').allTextContents();
 assert.deepEqual(issue,[],'Could not apply output: '+issue.join(' '));
 await expect.poll(async()=>(await preferences()).output,{timeout:10000}).toEqual(output);
 const actual = values(await status());
 for(const key of Object.keys(output)) if(output[key]!==null) assert.equal(actual[key],output[key]);
 return actual;
}
try {
 await launch('native');
 starting = values(await status());
 assert.ok(starting.device && starting.sampleRate>0 && starting.bufferSize>0);
 assert.deepEqual((await preferences()).output,automatic);
 if(secondOutput) {
  assert.notEqual(secondOutput.device,starting.device);
  attemptedSecond = true;
  await apply(secondOutput);
  console.log('Switched to second output',values(await status()));
 }
 const options=await page.evaluate(device=>window.sgNativeAudio.outputOptions(device),starting.device);
 assert.ok(options.devices.includes(starting.device));
 // Pin the current device by name. Avoid altering the clocks of unrelated outputs.
 const rate = [44100,48000,...options.sampleRates].find(r=>r!==starting.sampleRate && options.sampleRates.includes(r));
 const size = [256,512,128,...options.bufferSizes].find(b=>b!==starting.bufferSize && options.bufferSizes.includes(b));
 const changed = {...starting,sampleRate:rate??starting.sampleRate,bufferSize:size??starting.bufferSize};
 console.log('Initial output',starting,'named output selection',changed,'available outputs',options.devices);
 await apply(changed);
 await assert.rejects(page.evaluate(()=>window.sgNativeAudio.applyOutput({output:{device:'ShallowGroove absent test device',sampleRate:null,bufferSize:null},monitor:{enabled:false,track:0},midiInputs:[]})),/output device unavailable/i);
 assert.deepEqual((await preferences()).output,changed);
 assert.deepEqual(values(await status()),changed);
 await field('Close MIDI settings').click();
 await button('Play').click();
 await expect(button('Play')).toHaveAttribute('aria-pressed','true');
 await expect.poll(async()=>(await status()).position).toBeGreaterThan(0);
 await button('Audio / MIDI').click();
 for(const label of ['Audio engine','Output device','Sample rate','Buffer size','Apply audio output'])
  await expect(field(label)).toBeDisabled();
 await field('Close MIDI settings').click();
 await button('Stop').click();
 await quit();
 await launch('native');
 assert.deepEqual((await preferences()).output,changed);
 assert.deepEqual(values(await status()),changed);
 const actualReadout=page.locator('.native-output-settings output');
 await expect(actualReadout).toContainText(changed.device);
 await expect(actualReadout).toContainText(changed.sampleRate+' Hz');
 await expect(actualReadout).toContainText(changed.bufferSize+' frames');
 await apply(automatic);
 await field('Audio engine').selectOption('web');
 await expect.poll(async()=>(await preferences()).engine).toBe('web');
 await quit();
 await launch('web');
 await field('Audio engine').selectOption('native');
 await expect(field('Audio engine')).toHaveValue('native',{timeout:45000});
 await expect(field('Audio engine')).toBeEnabled();
 await field('Close MIDI settings').click();
 // Terminate only the native helper belonging to this temporary Electron process.
 const child=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n')
  .map(row=>row.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
  .find(m=>m&&Number(m[2])===app.process().pid&&m[3]===binary);
 assert.ok(child,'native child of test app');
 process.kill(Number(child[1]),'SIGKILL');
 await button('Audio / MIDI').click();
 await expect(field('Audio engine')).toHaveValue('web');
 await field('Close MIDI settings').click();
 await button('Play').click();
 await expect(button('Play')).toHaveAttribute('aria-pressed','true');
 await button('Stop').click();
 console.log('Verified first-launch Native, named output, device readback, failure rollback, playback interlock, persisted Native output and Web selection, and helper-loss playback recovery.');
} catch(error) {
 if(page) console.error('Audio settings alerts:',await page.locator('[role=alert]').allTextContents());
 throw error;
} finally {
 await quit();
 try {
  if (starting) {
   const restore=nativeAudio.createNativeAudio({binary,onEvent:()=>{}});
   try {
    async function restoreOutput(output) {
     const actual=await restore.request({op:'configureOutput',output});
     assert.deepEqual(values(actual),output);
     console.log('Restored CoreAudio device settings',values(actual));
    }
    try {if(attemptedSecond) await restoreOutput(secondOutput);}
    finally {await restoreOutput(starting);}
   } finally {await restore.stop();}
  }
 } finally {await rm(profile,{recursive:true,force:true});}
}
