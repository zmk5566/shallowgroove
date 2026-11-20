import {outputDirectory,verifyEdition} from './edition.mjs';
import {build,Platform,Arch} from 'electron-builder';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL??='5';
const root=resolve(import.meta.dirname,'..');
const {version}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
// electron-builder 26.18 uses $PLUGINSDIR only for true (its false documentation disagrees with the implementation).
await verifyEdition(resolve(root,`${outputDirectory}/v${version}/windows/ShallowGroove-win32-x64/resources/app`));
const artifacts=await build({projectDir:root,prepackaged:resolve(root,`${outputDirectory}/v${version}/windows/ShallowGroove-win32-x64`),targets:Platform.WINDOWS.createTarget(['portable'],Arch.x64),publish:'never',config:{appId:'local.shallowgroove.desktop',productName:'ShallowGroove',directories:{output:outputDirectory+'/portable'},win:{icon:'desktop/icons/shallowgroove.ico',target:['portable'],signAndEditExecutable:false},portable:{artifactName:`ShallowGroove-v${version}-Portable.exe`,requestExecutionLevel:'user',unpackDirName:true},compression:'normal'}});
for(const artifact of artifacts)console.log(artifact);
