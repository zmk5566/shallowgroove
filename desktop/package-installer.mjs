import {outputDirectory,verifyEdition} from './edition.mjs';
import {build,Platform,Arch} from 'electron-builder';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL??='5';
const root=resolve(import.meta.dirname,'..');
const {version}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const prepackaged=resolve(root,`${outputDirectory}/v${version}/windows/ShallowGroove-win32-x64`);
const packaged=JSON.parse(await readFile(resolve(prepackaged,'resources/app/package.json'),'utf8'));
if(packaged.version!==version)throw Error('Rebuild the Windows application before making the installer');
await verifyEdition(resolve(root,`${outputDirectory}/v${version}/windows/ShallowGroove-win32-x64/resources/app`));
const artifacts=await build({
 projectDir:root,prepackaged,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),publish:'never',
 config:{
  appId:'local.shallowgroove.desktop',productName:'ShallowGroove',
  directories:{output:outputDirectory+'/installer'},
  win:{icon:'desktop/icons/shallowgroove.ico',target:['nsis'],signAndEditExecutable:false},
  nsis:{
   artifactName:`ShallowGroove-Setup-${version}.exe`,
   oneClick:false,perMachine:false,allowElevation:false,
   allowToChangeInstallationDirectory:true,
   createDesktopShortcut:'always',createStartMenuShortcut:true,
   shortcutName:'ShallowGroove',runAfterFinish:true,
   deleteAppDataOnUninstall:false,
   installerIcon:'desktop/icons/shallowgroove.ico',
   uninstallerIcon:'desktop/icons/shallowgroove.ico',
  },
  compression:'normal',
 },
});
for(const artifact of artifacts)console.log(artifact);
