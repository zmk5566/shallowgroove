import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {_electron, expect} from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const workspace = await mkdtemp(join(tmpdir(), 'sg-export-'));
const profile = join(workspace, 'profile');
const exportsDir = join(workspace, 'output');
const output = join(exportsDir, 'test mix.wav');
const fixture = resolve(root, 'tests/fixtures/native-preview.json');
let app;

async function fileMenu(label) {
 return app.evaluate(({Menu}, name) => {
  const menu = Menu.getApplicationMenu()?.items.find(item => item.label === name);
  return menu?.submenu.items.map(item => ({label:item.label, enabled:item.enabled})) ?? [];
 }, label);
}

async function clickExport(menuLabel, itemLabel) {
 await expect.poll(async()=> (await fileMenu(menuLabel)).find(item=>item.label===itemLabel)?.enabled,
  {timeout:30000}).toBe(true);
 await app.evaluate(({Menu, BrowserWindow}, [menuLabel, itemLabel]) => {
  const menu = Menu.getApplicationMenu().items.find(item => item.label === menuLabel);
  const item = menu.submenu.items.find(item => item.label === itemLabel);
  if (!item?.enabled) throw Error('Export is disabled');
  item.click(item, BrowserWindow.getFocusedWindow(), {});
 }, [menuLabel, itemLabel]);
}

async function expectItem(menuLabel, label) {
 await expect.poll(async () => (await fileMenu(menuLabel)).map(item=>item.label),{timeout:10000})
  .toContain(label);
}

function readWave(buffer) {
 assert.equal(buffer.toString('ascii',0,4),'RIFF');
 assert.equal(buffer.toString('ascii',8,12),'WAVE');
 assert.equal(buffer.readUInt32LE(4)+8,buffer.length);
 const chunks = new Map();
 for(let p=12;p+8<=buffer.length;){
  const id=buffer.toString('ascii',p,p+4);
  const size=buffer.readUInt32LE(p+4);
  assert.ok(p+8+size<=buffer.length,`Truncated ${id} chunk`);
  chunks.set(id,buffer.subarray(p+8,p+8+size));
  p+=8+size+(size&1);
 }
 const fmt=chunks.get('fmt '),data=chunks.get('data');
 assert.ok(fmt?.length>=16 && data?.length,'WAV must have fmt and audio data');
 const format=fmt.readUInt16LE(0),channels=fmt.readUInt16LE(2),rate=fmt.readUInt32LE(4);
 const align=fmt.readUInt16LE(12),bits=fmt.readUInt16LE(14);
 if(format===0xfffe) {
  assert.ok(fmt.length>=40 && fmt.readUInt16LE(16)>=22);
  assert.equal(fmt.readUInt16LE(18),bits);
  assert.equal(fmt.subarray(24,40).toString('hex'),'0100000000001000800000aa00389b71','Expected the linear PCM subformat');
 } else assert.equal(format,1,'Expected linear PCM');
 assert.equal(channels,2);
 assert.equal(rate,44100);
 assert.equal(bits,16);
 assert.equal(align,bits*channels/8);
 assert.equal(fmt.readUInt32LE(8),rate*align);
 assert.equal(data.length%align,0);
 return {format,channels,rate,bits,frames:data.length/align};
}

try {
 await mkdir(exportsDir);
 app=await _electron.launch({cwd:root,args:[root,'--vite-dev','--user-data-dir='+profile],timeout:60000});
 assert.equal(await realpath(await app.evaluate(({app})=>app.getPath('userData'))),await realpath(profile));
 const page=await app.firstWindow();
 page.setDefaultTimeout(30000);
 const language=page.getByLabel('Language / 语言');
 const english='Export Audio…',chinese='导出音频…';
 await language.selectOption('en');
 await expectItem('File',english);
 assert.equal((await fileMenu('File')).find(item=>item.label===english).enabled,false,'Welcome screen has no arrangement to export');
 await page.locator('input[type=file]').first().setInputFiles(fixture);
 await expect(page.getByRole('button',{name:'Audio / MIDI',exact:true})).toBeVisible();
 await language.selectOption('zh-CN');
 await expectItem('文件',chinese);
 assert.equal((await fileMenu('File')).length,0);
 await app.evaluate(({dialog}, path)=>{
  globalThis.exportPrompts=[];
  dialog.showSaveDialog=async (...args)=>{
   const options=args.at(-1);
   globalThis.exportPrompts.push({filters:options.filters,defaultPath:options.defaultPath});
   return globalThis.exportPrompts.length===1
    ? {canceled:true,filePath:undefined}
    : {canceled:false,filePath:path};
  };
 },output);
 const prompts=()=>app.evaluate(()=>globalThis.exportPrompts);
 await clickExport('文件',chinese);
 await page.getByLabel('采样率',{exact:true}).selectOption('44100');
 await page.getByLabel('位深',{exact:true}).selectOption('16');
 await page.getByRole('button',{name:'选择保存位置…'}).click();
 await expect.poll(async()=>(await prompts()).length).toBe(1);
 await language.selectOption('en');
 await expectItem('File',english);
 assert.deepEqual(await readdir(exportsDir),[]);
 await clickExport('File',english);
 await expect(page.getByLabel('Sample rate',{exact:true})).toHaveValue('44100');
 await expect(page.getByLabel('Bit depth',{exact:true})).toHaveValue('16');
 await page.getByRole('button',{name:'Choose save location…'}).click();
 await expect.poll(async()=>(await prompts()).length).toBe(2);
 await expect.poll(async()=>{
  try {return readWave(await readFile(output)).frames;} catch {return 0;}
 },{timeout:60000}).toBeGreaterThan(0);
 assert.deepEqual(await readdir(exportsDir),[basename(output)]);
 for(const prompt of await prompts())
  assert.ok(prompt.filters.some(filter=>filter.extensions.includes('wav')));
 const wav=await readFile(output),header=readWave(wav);
 const decoded=await page.evaluate(async({base64,rate})=>{
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const ctx=new OfflineAudioContext(2,1,rate);
  const audio=await ctx.decodeAudioData(bytes.buffer);
  const peak=[];
  let onset=-1;
  for(let c=0;c<audio.numberOfChannels;c++){
   let max=0;
   const samples=audio.getChannelData(c);
   for(let i=0;i<samples.length;i++){
    const level=Math.abs(samples[i]);
    max=Math.max(max,level);
    if(c===0 && onset===-1 && level>0.0001) onset=i;
   }
   peak.push(max);
  }
  return {rate:audio.sampleRate,frames:audio.length,duration:audio.duration,onset,peak};
 },{base64:wav.toString('base64'),rate:header.rate});
 assert.equal(decoded.frames,header.frames);
 assert.equal(decoded.rate,header.rate);
 assert.equal(decoded.peak.length,2);
 assert.ok(decoded.duration>=2 && decoded.duration<=32,'Expected the full two-second arrangement and up to 30 seconds of tails');
 assert.ok(decoded.peak.every(n=>Number.isFinite(n)&&n>0.0001),'Expected audible samples in both channels');
 // First note at tick 120 with 480 PPQN and 500 ms per quarter.
 assert.ok(decoded.onset>=0.12*header.rate && decoded.onset<0.16*header.rate,'Expected the first note near 125 ms');
 console.log('Localized File menu, canceled save, WAV save, and Chromium audio decode verified',header,decoded);
} finally {
 if(app){
  await app.evaluate(({app})=>app.exit()).catch(()=>{});
  await app.close().catch(()=>{});
 }
 await rm(workspace,{recursive:true,force:true});
}
