import {cp,copyFile,mkdir,readdir,access} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {execFileSync} from 'node:child_process';

export const plugins=[['ShallowGrooveFX','ShallowGroove FX'],['ShallowGrooveRack','ShallowGroove Rack']];
export async function stagePlugins(build,destination,platform){
 const libraries=(await readdir(destination)).filter(file=>platform==='win32'?/\.dll$/i.test(file):file.endsWith('.dylib'));
 for(const [target,name] of plugins){
  const file=name+'.vst3',bundle=join(destination,'plug-ins',file);
  await cp(join(build,target+'_artefacts','Release','VST3',file),bundle,{recursive:true,verbatimSymlinks:true});
  const contents=join(bundle,'Contents'),mac=platform==='darwin';
  const libdir=join(contents,mac?'Frameworks':'x86_64-win');
  await mkdir(libdir,{recursive:true});
  for(const library of libraries)await copyFile(join(destination,library),join(libdir,library));
  await cp(join(destination,'faust'),join(contents,'Resources','faust'),{recursive:true});
  if(mac){
   const binary=join(contents,'MacOS',name);
   const deps=execFileSync('otool',['-L',binary],{encoding:'utf8'}).trimEnd().split('\n').slice(1);
   for(const line of deps){
    const source=line.trim().split(' (compatibility version')[0];
    if(source.startsWith('/System/')||source.startsWith('/usr/lib/'))continue;
    await access(join(libdir,basename(source)));
    execFileSync('install_name_tool',['-change',source,'@loader_path/../Frameworks/'+basename(source),binary]);
   }
   execFileSync('codesign',['--force','--deep','--sign','-',bundle]);
   execFileSync('codesign',['--verify','--deep','--strict',bundle]);
  }
 }
}
