import {execFileSync} from 'node:child_process';
import {access, chmod, copyFile, cp, readFile} from 'node:fs/promises';
import {basename, delimiter, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import bridge from './native-audio.cjs';

import {plugins,stagePlugins} from './stage-plugins.mjs';

const root=resolve(import.meta.dirname,'..');
const run=(program,args,options={})=>execFileSync(program,args,{stdio:'inherit',...options});

// Ship each non-system dylib next to the helper, including dependencies of libfaust.
async function relocateMac(binary){
 const directory=resolve(binary,'..'), copied=new Map();
 async function fix(file,isLibrary){
  const dependencies=execFileSync('otool',['-L',file],{encoding:'utf8'}).trimEnd().split('\n').slice(isLibrary?2:1);
  for(const line of dependencies){
   const source=line.trim().split(' (compatibility version')[0];
   if(source.startsWith('/System/')||source.startsWith('/usr/lib/'))continue;
   if(!source.startsWith('/'))throw Error('Unresolved native library: '+source);
   const name=basename(source),target=join(directory,name);
   if(copied.has(name)&&copied.get(name)!==source)throw Error('Conflicting native libraries: '+name);
   if(!copied.has(name)){
    copied.set(name,source);
    await copyFile(source,target);
    await chmod(target,0o755);
    await fix(target,true);
   }
   run('install_name_tool',['-change',source,'@loader_path/'+name,file]);
  }
  if(isLibrary)run('install_name_tool',['-id','@loader_path/'+basename(file),file]);
  run('codesign',['--force','--sign','-',file]);
 }
 await fix(binary,false);
}

async function verifyWindows(binary){
 const image=await readFile(binary),offset=image.readUInt32LE(60);
 if(image.toString('ascii',0,2)!=='MZ'||image.readUInt32LE(offset)!==0x4550||image.readUInt16LE(offset+4)!==0x8664)
  throw Error('Expected a Windows x64 ShallowGrooveEngine.exe');
}

export async function prepareNative(destination,platform){
 const binary=join(destination,bridge.engineName(platform));
 if(platform==='win32'&&process.platform!=='win32'){
  const source=process.env.SG_WINDOWS_NATIVE_RUNTIME;
  if(!source)throw Error('Set SG_WINDOWS_NATIVE_RUNTIME to the unpacked windows-x64-native runtime built on Windows.');
  await cp(source,destination,{recursive:true,dereference:true});
 }else{
  const build=join(root,'build-native');
  run('cmake',['-S',join(root,'native'),'-B',build,'-DCMAKE_BUILD_TYPE=Release']);
  const env={...process.env};
  if(platform==='win32')env.PATH=[build,...(env.FAUST_ROOT?[join(env.FAUST_ROOT,'lib')]:[]),env.PATH].join(delimiter);
  run('cmake',['--build',build,'--config','Release','--target','ShallowGrooveEngine','ShallowGrooveFX_VST3','ShallowGrooveRack_VST3','--parallel','3'],{env});
  run('cmake',['--install',build,'--config','Release','--component','Engine','--prefix',destination]);
  if(platform==='darwin')await relocateMac(binary);
  await stagePlugins(build,destination,platform);
 }
 for(const [,name] of plugins)await access(join(destination,'plug-ins',name+'.vst3','Contents','Resources','faust','stdfaust.lib'));
 await access(join(destination,'faust','stdfaust.lib'));
 if(platform==='win32'){
  await verifyWindows(binary);
  for(const name of ['faust.dll','msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll'])
   await access(join(destination,name));
 }
 if(platform===process.platform){
  run(process.execPath,[join(root,'native','cli-test.mjs'),binary],{
   env:{...process.env,SG_FAUST_LIBRARY_DIR:join(destination,'faust')},timeout:60000
  });
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
 if(!process.argv[2])throw Error('Pass a native runtime output directory');
 await prepareNative(resolve(process.argv[2]),process.platform);
}
