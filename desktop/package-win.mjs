import {stageApplication,outputDirectory,privateBuild,verifyEdition} from './edition.mjs';
import {packager} from '@electron/packager';
import {execFileSync} from 'node:child_process';
import {mkdir,cp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {trimRuntime} from './trim-runtime.mjs';
import {prepareNative} from './prepare-native.mjs';
import {prepareConnect} from './prepare-connect.mjs';
const root=resolve(import.meta.dirname,'..');
const stage=await stageApplication(root,'win');
const app=resolve(stage,'app'),runtime=resolve(stage,'runtime');
const {version:appVersion}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
await mkdir(app,{recursive:true});await mkdir(runtime,{recursive:true});
// Run npm through Node on Windows (CreateProcess cannot launch npm.cmd directly).
const npm=(args,options)=>process.env.npm_execpath
 ? execFileSync(process.execPath,[process.env.npm_execpath,...args],options)
 : execFileSync('npm',args,{...options,shell:process.platform==='win32'});
npm(['ci','--omit=dev','--os=win32','--cpu=x64','--ignore-scripts','--no-audit','--no-fund'],{cwd:app,stdio:'inherit'});
await prepareNative(resolve(runtime,'native'),'win32');
await trimRuntime(app);
const version=JSON.parse(await readFile(resolve(root,'node_modules/node/package.json'),'utf8')).version;
const packed=JSON.parse(npm(['pack',`node-win-x64@${version}`,'--json','--pack-destination',stage],{cwd:stage,encoding:'utf8'}));
execFileSync('tar',['-xzf',resolve(stage,packed[0].filename),'-C',stage]);
await copyFile(resolve(stage,'package/bin/node.exe'),resolve(runtime,'node.exe'));
const electronVersion=JSON.parse(await readFile(resolve(root,'node_modules/electron/package.json'),'utf8')).version;
const service=await prepareConnect(stage,'win32');
const paths=await packager({dir:app,tmpdir:resolve(stage,'electron-temp'),out:resolve(root,`${outputDirectory}/v${appVersion}/windows`),name:'ShallowGroove',buildVersion:appVersion,icon:resolve(root,'desktop/icons/shallowgroove.ico'),platform:'win32',arch:'x64',electronVersion,asar:false,overwrite:true,prune:false,extraResource:[runtime,service]});
await rm(stage,{recursive:true,force:true});
await verifyEdition(resolve(paths[0],'resources/app'));
await writeFile(resolve(paths[0],'使用说明.txt'),'解压整个文件夹后双击 ShallowGroove.exe。无需安装 Node。\r\n'+(privateBuild?'此版本内置私人 API key，请勿公开分享。':'可在欢迎页或 AI 设置中配置个人 DeepSeek API Key。')+'\r\n');
console.log(paths[0]);
