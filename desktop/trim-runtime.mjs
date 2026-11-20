import {readdir,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimeDependencies} from './runtime-dependencies.mjs';

// Keep the sdk-minimal dependency closure, including peers and native assets.
export async function trimRuntime(app) {
 const assistant=await readFile(resolve(app,'server/assistant.mjs'),'utf8');
 if(!assistant.includes("profile:'sdk-minimal'"))throw Error('Review runtime trimming before changing the assistant profile');
 const scope=resolve(app,'node_modules/@deepseek-ai');
 const profile=await readFile(resolve(scope,'dsh-sdk-minimal/cordis.patch.yml'),'utf8');
 if(/libreoffice|skill-office|office-to-pdf/.test(profile))throw Error('SDK minimal now requires Office; review runtime trimming');
 const removed=[];
 for(const name of await readdir(scope)){
  if(name==='libreoffice-kit'||name.startsWith('libreoffice-kit-')||['dsh-skill-office','dsh-office-to-pdf'].includes(name)){
   await rm(resolve(scope,name),{recursive:true,force:true});removed.push(name);
  }
 }
 console.log('Removed unused Office runtime:',removed.join(', '));
 const dependencies=await runtimeDependencies(app);
 console.log(`Music runtime: ${dependencies.kept} packages retained, ${dependencies.removed.length} unused package directories removed`);
 let buildOnlyFiles=0;
 async function stripBuildMetadata(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const path=resolve(directory,entry.name);
   if(entry.isDirectory())await stripBuildMetadata(path);
   else if(entry.isFile()&&(/\.d\.[cm]?ts$/.test(entry.name)||entry.name.endsWith('.map'))){
    await rm(path);buildOnlyFiles++;
   }
  }
 }
 await stripBuildMetadata(resolve(app,'node_modules'));
 console.log(`Removed ${buildOnlyFiles} development-only declaration/source-map files`);
 return removed;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await trimRuntime(resolve(process.argv[2]));
