import {stageApplication,outputDirectory,verifyEdition} from './edition.mjs';
import {execFileSync} from 'node:child_process';
import {packager} from '@electron/packager';
import {mkdir,copyFile,chmod,readFile,cp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {trimRuntime} from './trim-runtime.mjs';
import {prepareNative} from './prepare-native.mjs';
import {prepareConnect} from './prepare-connect.mjs';
const root=resolve(import.meta.dirname,'..');
const {version:appVersion}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const stage=await stageApplication(root,'mac');
const app=resolve(stage,'app'),runtime=resolve(stage,'runtime');
await mkdir(app,{recursive:true});await mkdir(runtime,{recursive:true});
// npm includes required peer dependencies; Packager's dependency pruning omitted them.
if(process.argv.includes('--local-deps')){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Local packaging requires an arm64 Mac');
 await cp(resolve(root,'node_modules'),resolve(app,'node_modules'),{recursive:true,verbatimSymlinks:true});
}else execFileSync('npm',['ci','--omit=dev','--os=darwin','--cpu=arm64','--ignore-scripts','--no-audit','--no-fund'],{cwd:app,stdio:'inherit'});
await prepareNative(resolve(runtime,'native'),'darwin');
await trimRuntime(app);
await copyFile(resolve(root,'node_modules/node/bin/node'),resolve(runtime,'node'));
await chmod(resolve(runtime,'node'),0o755);
const electronVersion=JSON.parse(await readFile(resolve(root,'node_modules/electron/package.json'),'utf8')).version;
const service=await prepareConnect(stage,'darwin');
const paths=await packager({electronZipDir:process.env.SHALLOWGROOVE_ELECTRON_ZIP_DIR,dir:app,tmpdir:resolve(stage,'electron-temp'),out:resolve(root,`${outputDirectory}/v${appVersion}/mac`),name:'ShallowGroove',appVersion,buildVersion:appVersion.replace(/-pre\.(\d+)$/,'.$1'),icon:resolve(root,'desktop/icons/shallowgroove.icns'),platform:'darwin',arch:'arm64',electronVersion,appBundleId:'local.shallowgroove.desktop',appCategoryType:'public.app-category.music',asar:false,overwrite:true,prune:false,extraResource:[runtime,service],extendInfo:{NSBluetoothAlwaysUsageDescription:'ShallowGroove connects to Hexblocks hardware over Bluetooth.',NSBluetoothPeripheralUsageDescription:'ShallowGroove connects to Hexblocks hardware over Bluetooth.'}});
for(const path of paths){
 const bundle=resolve(path,'ShallowGroove.app');
 await verifyEdition(resolve(bundle,'Contents/Resources/app'));
 // Preserve PyInstaller framework symlinks inside the bundle.
 const bundledService=resolve(bundle,'Contents/Resources/connect-service');
 await rm(bundledService,{recursive:true,force:true});
 await cp(service,bundledService,{recursive:true,verbatimSymlinks:true});
 await rm(stage,{recursive:true,force:true});
 execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',bundle]);
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
 console.log(bundle);
 if(process.argv.includes('--no-zip'))continue;
 const archive=resolve(root,`${outputDirectory}/ShallowGroove-v${appVersion}-macOS-arm64.zip`);
 execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',bundle,archive]);
 console.log(archive);
}
