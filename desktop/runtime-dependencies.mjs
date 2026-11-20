import {readFile,readdir,stat,rm} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';

const SDK_VERSION='0.2.2-rc.1';
const roots=['@deepseek-ai/dsh-sdk-client','@deepseek-ai/dsh-sdk-minimal','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-web','@deepseek-ai/dsh-web-search-deepseek','@deepseek-ai/dsh-tool-web','ws'];
const narrowed=new Set(['@deepseek-ai/dsh','@deepseek-ai/dsh-sdk-app']);
const packageName=value=>value.startsWith('@')?value.split('/').slice(0,2).join('/'):value.split('/')[0];

// These two packages aggregate other application profiles in their manifests.
// Retain their actual JS imports, while sdk-minimal supplies the complete YAML
// plugin dependency tree. All other packages keep their declared dependency,
// optional dependency and peer dependency closure (including nested versions).
async function codeDependencies(directory){
 const names=new Set();
 async function visit(path){
  for(const entry of await readdir(path,{withFileTypes:true})){
   const file=join(path,entry.name);
   if(entry.isDirectory())await visit(file);
   else if(/\.[cm]?js$/.test(entry.name)){
    const code=await readFile(file,'utf8');
    for(const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)){
     const name=match[1];
     if(!name.startsWith('.')&&!name.startsWith('/')&&!name.includes(':'))names.add(packageName(name));
    }
   }
  }
 }
 await visit(join(directory,'lib'));
 return [...names];
}

export async function runtimeDependencies(app,{dryRun=false}={}){
 app=resolve(app);
 const assistant=await readFile(join(app,'server/assistant.mjs'),'utf8');
 if(!assistant.includes("profile:'sdk-minimal'"))throw Error('Review dependency closure after changing the assistant profile');
 const keep=new Set();
 async function locate(name,from){
  for(let dir=from;dir===app||dir.startsWith(app+sep);dir=dirname(dir)){
   const path=join(dir,'node_modules',name);
   try{await stat(join(path,'package.json'));return path;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
 }
 async function visit(name,from,optional=false){
  const path=await locate(name,from);
  if(!path){if(optional)return;throw Error(`Missing runtime dependency ${name} from ${from}`);}
  if(keep.has(path))return;
  keep.add(path);
  const pkg=JSON.parse(await readFile(join(path,'package.json'),'utf8'));
  let dependencies=pkg.dependencies??{};
  if(narrowed.has(pkg.name)){
   if(pkg.version!==SDK_VERSION)throw Error(`Review narrowed runtime dependencies for ${pkg.name}@${pkg.version}`);
   dependencies=Object.fromEntries((await codeDependencies(path)).map(name=>[name,'*']));
  }
  for(const dep of Object.keys({...dependencies,...pkg.peerDependencies,...pkg.optionalDependencies})){
   const optional=dep in (pkg.optionalDependencies??{})||pkg.peerDependenciesMeta?.[dep]?.optional===true;
   await visit(dep,path,optional);
  }
 }
 for(const name of roots)await visit(name,app);
 const removed=[];
 async function prune(modules){
  let entries;try{entries=await readdir(modules,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const entry of entries){
   // The SDK is launched by its resolved JS entry, never npm's bin shims.
   // Pruning their target packages would otherwise leave dangling symlinks.
   if(entry.name==='.bin'){
    if(!dryRun)await rm(join(modules,entry.name),{recursive:true,force:true});
    continue;
   }
   if(entry.name.startsWith('.'))continue;
   const path=join(modules,entry.name);
   if(entry.name.startsWith('@')){await prune(path);continue;}
   if(!keep.has(path)){
    removed.push(path.slice(app.length+1));
    if(!dryRun)await rm(path,{recursive:true,force:true});
   }else await prune(join(path,'node_modules'));
  }
 }
 await prune(join(app,'node_modules'));
 return {kept:keep.size,removed};
}
