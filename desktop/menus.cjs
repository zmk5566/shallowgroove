const {readFileSync,writeFileSync,renameSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const isLocale=value=>value==='en'||value==='zh-CN';

function desktopLanguage(directory){
 const file=join(directory,'language.json');
 let value=null;
 try{const data=JSON.parse(readFileSync(file,'utf8'));if(isLocale(data.locale))value=data.locale;}catch{}
 return {
  saved:()=>value,
  current:()=>value??'zh-CN',
  set(locale){
   if(!isLocale(locale)||value===locale)return false;
   mkdirSync(directory,{recursive:true});
   writeFileSync(file+'.tmp',JSON.stringify({locale}),{mode:0o600});
   renameSync(file+'.tmp',file);value=locale;return true;
  }
 };
}

function menuTemplates(locale,actions,mac,exportAvailable=false){
 const t=(zh,en)=>locale==='en'?en:zh;
 const role=(name,zh,en)=>({role:name,label:t(zh,en)});
 const sep={type:'separator'};
 const open=[{label:t('打开 ShallowGroove','Open ShallowGroove'),click:actions.show},
  {label:t('打开 HexConnect','Open HexConnect'),click:actions.connect}];
 const controls=[...open,sep,{label:t('退出 ShallowGroove','Quit ShallowGroove'),accelerator:'CmdOrCtrl+Q',click:actions.quit}];
 const project=(id,zh,en,accelerator)=>({id:'project-'+id,label:t(zh,en),...(accelerator?{accelerator}:{}),click:()=>actions.project(id)});
 const edit=[role('undo','撤销','Undo'),role('redo','重做','Redo'),sep,role('cut','剪切','Cut'),role('copy','复制','Copy'),role('paste','粘贴','Paste')];
 if(mac)edit.push(role('pasteAndMatchStyle','粘贴并匹配样式','Paste and Match Style'));
 edit.push(role('delete','删除','Delete'),role('selectAll','全选','Select All'));
 if(mac)edit.push(sep,{label:t('语音','Speech'),submenu:[role('startSpeaking','开始朗读','Start Speaking'),role('stopSpeaking','停止朗读','Stop Speaking')]});
 return {controls,dock:open,application:[
  {label:'ShallowGroove',submenu:[role('about','关于 ShallowGroove','About ShallowGroove'),...controls]},
  {label:t('文件','File'),submenu:[project('home','欢迎页','Home'),project('save','保存','Save','CmdOrCtrl+S'),
   project('save-as','另存为…','Save As…','CmdOrCtrl+Shift+S'),sep,{label:t('安装 VST3 插件…','Install VST3 plug-ins…'),click:actions.installPlugins},{...project('export-audio','导出音频…','Export Audio…'),id:'export-audio',enabled:exportAvailable}]},
  {role:'editMenu',label:t('编辑','Edit'),submenu:edit},
  {label:t('窗口','Window'),submenu:[role('minimize','最小化','Minimize'),{label:t('关闭当前窗口','Close Window'),accelerator:'CmdOrCtrl+W',click:actions.close},...open]}
 ]};
}

module.exports={desktopLanguage,menuTemplates,isLocale};
