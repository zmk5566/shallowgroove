const {createInterface}=require('node:readline');
const {readFile,writeFile}=require('node:fs/promises');
const {join,dirname,isAbsolute}=require('node:path');
const {createUserLibrary}=require('./user-library.cjs');
const {credentialStore}=require('./credentials.cjs');

async function assistantConfig({directory,root,viteDev,storage}){
 let privateRoot=viteDev?null:root;
 if(viteDev){
  // An installed older private edition may predate the plugin worker. Pair this
  // preview with its existing configuration without copying a credential.
  try{
   const pair=JSON.parse(await readFile(join(directory,'fx-private-edition.json'),'utf8'));
   if(!isAbsolute(pair.appRoot))throw Error();
   privateRoot=pair.appRoot;
  }catch(error){if(error.code!=='ENOENT')throw Error('Cannot read the linked ShallowGroove edition');}
 }
 let config={};
 if(privateRoot){
  try{config=JSON.parse(await readFile(join(privateRoot,'desktop/private-config.json'),'utf8'));}
  catch(error){if(viteDev||error.code!=='ENOENT')throw Error('Cannot read the linked ShallowGroove configuration');}
 }
 if(config.DEEPSEEK_API_KEY)return {key:config.DEEPSEEK_API_KEY,source:'builtin',
  base:config.DEEPSEEK_BASE_URL||'https://api.deepseek.com',model:config.SHALLOWGROOVE_MODEL||process.env.SHALLOWGROOVE_MODEL||'deepseek-v4-flash'};
 let key;
 try{key=credentialStore(directory,storage).read();}catch{throw Error('Cannot unlock the saved DeepSeek key');}
 return {key,source:key?'user':'none',base:'https://api.deepseek.com',model:process.env.SHALLOWGROOVE_MODEL||'deepseek-v4-flash'};
}

async function panelEndpoint(options){
 const file=join(options.directory,'assistant-panel.json');
 async function current(){
  try{
   const {port,identity}=JSON.parse(await readFile(file,'utf8'));
   if(!Number.isInteger(port)||port<1||port>65535)return;
   const origin='http://127.0.0.1:'+port;
   const status=await fetch(origin+'/api/assistant/status',{signal:AbortSignal.timeout(1000),redirect:'error'}).then(r=>r.json());
   if(identity&&status.panelIdentity===identity)return origin;
  }catch{/* App is still starting or the previous port has closed. */}
 }
 let origin=await current();
 if(!origin){
  const args=process.argv.slice(1).filter(a=>a!=='--sg-fx-service'&&!a.startsWith('--sg-fx-request-file='));
  const child=require('node:child_process').spawn(process.execPath,[...args,'--sg-fx-background'],{detached:true,stdio:'ignore'});
  child.on('error',()=>{});child.unref();
  for(let i=0;i<80&&!origin;i++){await new Promise(r=>setTimeout(r,250));origin=await current();}
 }
 if(!origin)throw Error('Restart ShallowGroove to connect its Assistant.');
 return {origin,locale:require('./menus.cjs').desktopLanguage(options.directory).current()};
}

async function factoryEffects(root){
 const kinds=['chorus','compressor','delay','eq','filter','reverb','saturator','utility'];
 return Promise.all(kinds.map(async kind=>{
  const code=await readFile(join(root,'patches','effects',kind+'.dsp'),'utf8');
  const title=code.match(/declare\s+name\s+"([^"]+)"/)?.[1]??kind;
  return {id:'factory:'+kind,revision:1,name:title,kind,code,values:{}};
 }));
}
async function handleRequest(input,options){
 if(!input||typeof input!=='object')throw Error('Invalid effect request');
 if(input.op==='assistant-status'){const {source}=await assistantConfig(options);return {configured:source!=='none',source};}
 if(input.op==='panel')return panelEndpoint(options);
 const library=createUserLibrary(options.directory);
 if(input.op==='list'){
  const user=(await library.list()).filter(entry=>entry.kind!=='instrument');
  return {entries:[...user,...await factoryEffects(options.root)]};
 }
 const {name,code,values={},kind='custom',previous,prompt}=input;
 if(kind==='instrument')throw Error('Select an audio effect');
 if(input.op==='save'){
  if(input.checkName===true&&input.confirmedName!==name){
   const {hasPresetName}=require('../src/model/library-entry.mjs');
   if(hasPresetName(await library.list(),name,previous?.id))return {duplicate:true};
  }
  return {entry:await library.save(name,{kind,code,values},previous??undefined)};
 }
 throw Error(input.op==='edit'?'This host is running an older ShallowGroove FX. Save your project, fully quit the host application, then relaunch it to load the shared Assistant.':'Unknown effect operation');
}

async function runWorker(options,file,input=process.stdin,output=process.stdout){
 if(file!==undefined&&!isAbsolute(file))throw Error('Expected absolute request file');
 let result;
 try{
  let value;
  if(file)value=await readFile(file,'utf8');
  else{
   const lines=createInterface({input,crlfDelay:Infinity});
   try{value=(await lines[Symbol.asyncIterator]().next()).value;}finally{lines.close();}
  }
  let message;
  try{message=JSON.parse(value);}catch{throw Error('Invalid JSON request');}
  result={ok:true,...await handleRequest(message,options)};
 }catch(error){result={ok:false,error:error.message};}
 const json=JSON.stringify(result)+'\n';
 if(file)await writeFile(join(dirname(file),'result.json'),json,{flag:'wx',mode:0o600});
 else await new Promise((resolve,reject)=>output.write('SGFX:'+json,error=>error?reject(error):resolve()));
}
module.exports={handleRequest,runWorker,assistantConfig};
