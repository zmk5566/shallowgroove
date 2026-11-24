import {execFileSync} from 'node:child_process';
import {mkdir,cp,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';

export async function prepareConnect(stage,platform){
 if(process.env.SG_CONNECT_SERVICE){
  const service=resolve(stage,'connect-service');
  await cp(process.env.SG_CONNECT_SERVICE,service,{recursive:true,verbatimSymlinks:true});
  return service;
 }
 const project=resolve(import.meta.dirname,'../..'),root=resolve(project,'hexblocks_connect');
 const service=resolve(stage,'connect-service'),shared=resolve(project,'Hexblocks/frontend');
 await mkdir(resolve(service,'shared/frontend/bridge'),{recursive:true});
 await mkdir(resolve(service,'shared/frontend/css'),{recursive:true});
 for(const file of ['transport.py','serial_io.py','wb_protocol.py'])await copyFile(resolve(shared,'bridge',file),resolve(service,'shared/frontend/bridge',file));
 await copyFile(resolve(shared,'channel_catalog.json'),resolve(service,'shared/frontend/channel_catalog.json'));
 await copyFile(resolve(shared,'css/theme.css'),resolve(service,'shared/frontend/css/theme.css'));
 if(platform==='darwin'){
  execFileSync(resolve(root,'.venv/bin/python'),['-m','PyInstaller','--noconfirm','--clean','--onedir','--name','connect-backend','--distpath',resolve(service,'backend'),'--workpath',resolve(stage,'pybuild'),'--specpath',stage,'--paths',root,'--paths',resolve(root,'desktop'),'--paths',resolve(shared,'bridge'),'--hidden-import','transport','--hidden-import','serial_io','--hidden-import','wb_protocol','--exclude-module','serial','--collect-all','bleak','--add-data',`${resolve(root,'web')}:web`,resolve(root,'desktop/launcher.py')],{cwd:root,stdio:'inherit'});
 }else{
  await cp(resolve(root,'release/python-win'),resolve(service,'python'),{recursive:true,dereference:true});
  const {pruneSerialRuntime}=await import('../../hexblocks_connect/desktop/prune-python.mjs');
  await pruneSerialRuntime(resolve(service,'python'));
  await copyFile(resolve(root,'connect.py'),resolve(service,'connect.py'));
  await cp(resolve(root,'web'),resolve(service,'web'),{recursive:true});
  await mkdir(resolve(service,'desktop'),{recursive:true});
  for(const file of ['launcher.py','smoke.py'])await copyFile(resolve(root,'desktop',file),resolve(service,'desktop',file));
 }
 return service;
}
