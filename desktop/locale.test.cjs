const {test}=require('node:test');
const assert=require('node:assert/strict');
const {existsSync}=require('node:fs');
test('locale bridge validates, updates existing windows and constructs initial URL',async()=>{
 assert.ok(existsSync(__dirname+'/connect-locale.cjs'),'missing locale bridge');
 const {createConnectLocale}=require('./connect-locale.cjs');
 const bridge=createConnectLocale();
 assert.equal(bridge.url('http://127.0.0.1:8766'),'http://127.0.0.1:8766/');
 await bridge.set('en');
 assert.equal(bridge.url('http://127.0.0.1:8766'),'http://127.0.0.1:8766/?locale=en');
 let script;
 const window={isDestroyed:()=>false,webContents:{executeJavaScript:async value=>{script=value;}}};
 await bridge.set('zh-CN',window);
 assert.match(script,/setLocale\("zh-CN"\)/);
 script=undefined;
 assert.equal(await bridge.set('en";alert(1)',window),false);
 assert.equal(script,undefined);
 assert.equal(bridge.url('http://127.0.0.1:8766'),'http://127.0.0.1:8766/?locale=zh-CN');
 await bridge.apply(window);assert.match(script,/setLocale\("zh-CN"\)/);
});

const {desktopLanguage,menuTemplates}=require('./menus.cjs');
test('desktop locale restores before renderer startup, including English on a new server port',()=>{
 const {mkdtempSync,rmSync,writeFileSync}=require('node:fs'),{join}=require('node:path');
 const dir=mkdtempSync(join(require('node:os').tmpdir(),'sg-language-'));
 try{
  let language=desktopLanguage(dir);
  assert.equal(language.saved(),null);assert.equal(language.current(),'zh-CN');
  assert.equal(language.set('en'),true);assert.equal(language.set('en'),false);
  language=desktopLanguage(dir);assert.equal(language.current(),'en');
  assert.equal(language.set('bogus'),false);assert.equal(language.current(),'en');
  assert.equal(language.set('zh-CN'),true);assert.equal(desktopLanguage(dir).saved(),'zh-CN');
  writeFileSync(join(dir,'language.json'),'{');assert.equal(desktopLanguage(dir).saved(),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('menus translate File, editing roles, tray and Dock while preserving commands, availability and shortcuts',()=>{
 const calls=[],actions={project:id=>calls.push(id),connect:()=>{},show:()=>{},quit:()=>{},close:()=>{}};
 for(const [locale,file,exportLabel,edit,copy,opening] of [['en','File','Export Audio…','Edit','Copy','Open'],['zh-CN','文件','导出音频…','编辑','复制','打开']]){
  const menus=menuTemplates(locale,actions,true,true),files=menus.application.find(m=>m.label===file).submenu;
  const audio=files.find(m=>m.id==='export-audio');
  assert.equal(audio.label,exportLabel);assert.equal(audio.enabled,true);audio.click();
  assert.equal(files.find(m=>m.id==='project-save').accelerator,'CmdOrCtrl+S');
  assert.equal(menus.application.find(m=>m.label===edit).submenu.find(m=>m.role==='copy').label,copy);
  assert.ok(menus.controls[0].label.startsWith(opening));assert.ok(menus.dock[1].label.startsWith(opening));
 }
 assert.equal(menuTemplates('en',actions,true).application[1].submenu.at(-1).enabled,false);
 assert.deepEqual(calls,['export-audio','export-audio']);
});
