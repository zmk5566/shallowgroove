// Paths are selected by native dialogs or looked up by opaque registry IDs.
const fs=require('node:fs/promises');const {join,resolve}=require('node:path');const {randomUUID}=require('node:crypto');
const {checkProjectVersion}=require('../src/model/project-version.mjs');
const LIMIT=100*1024*1024;
function validate(text){if(typeof text!=='string'||Buffer.byteLength(text)>LIMIT)throw Error('Project exceeds 100 MB');const value=JSON.parse(text);checkProjectVersion(value);if(!value.session?.project)throw Error('Invalid project file');return value;}
async function atomic(path,text){const temporary=path+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,text,{mode:0o600,flag:'wx'});const handle=await fs.open(temporary,'r+');try{await handle.sync();}finally{await handle.close();}await fs.rename(temporary,path);}finally{await fs.rm(temporary,{force:true});}}
async function readBounded(path){const handle=await fs.open(path,'r');try{if((await handle.stat()).size>LIMIT)throw Error('Project exceeds 100 MB');return await handle.readFile('utf8');}finally{await handle.close();}}
exports.createProjectFiles=(directory,choose)=>{
 const versioning=require('./project-versions.cjs'),repo=require('./music-git.cjs');
 const index=join(directory,'project-library.json'),recovery=join(directory,'project-recovery.json');let queue=Promise.resolve();
 const serial=fn=>{const result=queue.catch(()=>{}).then(fn);queue=result;return result;};
 async function registry(){await fs.mkdir(directory,{recursive:true});try{const rows=JSON.parse(await fs.readFile(index,'utf8'));if(!Array.isArray(rows))throw Error('Invalid project library');return rows;}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 async function remember(path,name){const rows=await registry();const record={id:rows.find(r=>r.path===path)?.id??randomUUID(),name,updated:Date.now(),location:'folder',path};await atomic(index,JSON.stringify([record,...rows.filter(r=>r.id!==record.id)]));return record;}
 return {
  version:(id,cmd)=>serial(async()=>{const row=(await registry()).find(r=>r.id===id);if(!row)throw Error('Save the project first');return versioning.versions(row.path,cmd,readBounded,atomic);}),
  clone:url=>serial(async()=>{
   repo.remoteURL(url);const folder=await choose('save','ShallowGroove');if(!folder)return null;
   await fs.mkdir(folder,{recursive:true});if((await fs.readdir(folder)).length)throw Error('请选择空目录 / Choose an empty folder');
   const text=await versioning.create(folder,async dir=>{
    const value=JSON.parse(await repo.clone(dir,url));
    if(value.editor)value.editor.conversationProject=randomUUID();
    return JSON.stringify(value);
   });
   await atomic(join(folder,'project.json'),text);const value=validate(text);
   return {text,record:await remember(resolve(folder),value.name||value.session.project.title)};
  }),
  list:()=>serial(registry),
  read:id=>serial(async()=>{const entry=(await registry()).find(r=>r.id===id);if(!entry)throw Error('Unknown project; open its folder again');const text=await readBounded(join(entry.path,'project.json'));validate(text);return {record:entry,text};}),
  save:(text,name,id)=>serial(async()=>{
   const value=validate(text);if(typeof name!=='string'||!name.trim()||name.length>200)throw Error('Invalid project name');
   const rows=await registry();let folder;
   if(id){const entry=rows.find(r=>r.id===id);if(!entry)throw Error('Unknown project; use Save as');folder=entry.path;}
   else{const selected=await choose('save',name);if(!selected)return null;folder=resolve(selected);try{await fs.access(join(folder,'project.json'));throw Error('This folder already contains a project; choose a new folder');}catch(e){if(e.code!=='ENOENT')throw e;}}
   await fs.mkdir(folder,{recursive:true});
   let created=false;
   if(!id&&!value.versionSource){
    try{await versioning.create(folder,dir=>repo.init(dir,text));created=true;}
    catch(e){if(!e.message.includes('Install Git'))throw e;}
   }
   try{await atomic(join(folder,'project.json'),text);}catch(e){if(created)await fs.rm(join(folder,'versions'),{recursive:true,force:true});throw e;}
   return remember(folder,name);
  }),
  open:()=>serial(async()=>{const folder=await choose('open');if(!folder)return null;const path=resolve(folder),text=await readBounded(join(path,'project.json'));const value=validate(text);const record=await remember(path,value.name||value.session.project.title||'Untitled');return {record,text};}),
  draft:(value)=>serial(async()=>{await fs.mkdir(directory,{recursive:true});if(value===null){await fs.rm(recovery,{force:true});return null;}if(value!==undefined){validate(value.text);if(typeof value.name!=='string'||!['example','new','saved','import'].includes(value.source)||typeof value.baseline!=='string')throw Error('Invalid recovery draft');await atomic(recovery,JSON.stringify(value));return value;}try{return JSON.parse(await readBounded(recovery));}catch(e){if(e.code==='ENOENT')return null;throw e;}}),
 };
};
