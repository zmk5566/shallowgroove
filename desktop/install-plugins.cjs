const fs=require('node:fs/promises');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');

const plugins=[['ShallowGrooveFX','ShallowGroove FX'],['ShallowGrooveRack','ShallowGroove Rack']];
function userPluginDirectory(platform,home,localAppData){
 if(platform==='darwin')return join(home,'Library','Audio','Plug-Ins','VST3');
 if(platform==='win32'&&localAppData)return join(localAppData,'Programs','Common','VST3');
 throw Error('VST3 installation requires macOS or Windows x64.');
}
async function installPlugins({source,destination,registration,executable,args}){
 await fs.mkdir(destination,{recursive:true});
 const stage=await fs.mkdtemp(join(destination,'.shallowgroove-'));
 const changes=[];
 const config=join(registration,'Plugin Host.json'),temporary=config+'.'+randomUUID();
 try{
  for(const [target,name] of plugins){
   const file=name+'.vst3',original=source(target,file);
   await fs.access(join(original,'Contents'));
   await fs.cp(original,join(stage,file),{recursive:true,verbatimSymlinks:true});
  }
  await fs.mkdir(registration,{recursive:true});
  await fs.writeFile(temporary,JSON.stringify({executable,args}),{flag:'wx',mode:0o600});
  for(const [,name] of plugins){
   const file=name+'.vst3',installed=join(destination,file),backup=join(stage,file+'.previous');
   let existed=true;
   try{await fs.rename(installed,backup);}catch(error){if(error.code!=='ENOENT')throw error;existed=false;}
   const change={installed,backup,existed,replaced:false};changes.push(change);
   await fs.rename(join(stage,file),installed);change.replaced=true;
  }
  await fs.rename(temporary,config);
 }catch(error){
  for(const change of changes.reverse()){
   if(change.replaced)await fs.rm(change.installed,{recursive:true,force:true});
   if(change.existed)await fs.rename(change.backup,change.installed);
  }
  throw error;
 }finally{
  await fs.rm(temporary,{force:true});await fs.rm(stage,{recursive:true,force:true});
 }
 return destination;
}
function installForApp(app,resources){
 const root=app.getAppPath(),preview=process.argv.includes('--native-preview');
 return installPlugins({
  source:(target,file)=>app.isPackaged?join(resources,'runtime','native','plug-ins',file):join(root,'build-native',target+'_artefacts','Release','VST3',file),
  destination:userPluginDirectory(process.platform,app.getPath('home'),process.env.LOCALAPPDATA),
  registration:join(app.getPath('appData'),'ShallowGroove'),
  executable:process.execPath,
  args:[...(app.isPackaged?[]:[root,'--vite-dev',...(preview?['--native-preview']:[])]),'--user-data-dir='+app.getPath('userData')]
 });
}
module.exports={installPlugins,installForApp,userPluginDirectory};
