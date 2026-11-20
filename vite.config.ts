// Faust generates AudioWorklet source from class/function bodies at runtime.
// Preserve their identifiers in the production bundle.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig,loadEnv} from 'vite';
import {assistantPlugin} from './server/assistant.mjs';
import {hexblocksPlugin} from './server/hexblocks.mjs';
import react from '@vitejs/plugin-react';

function assistantEnvironment(env:Record<string,string>,localPreview:boolean){
 if(!localPreview||env.DEEPSEEK_API_KEY)return env;
 try{
  const desktop=JSON.parse(readFileSync(resolve('desktop/private-config.json'),'utf8'));
  return {...env,DEEPSEEK_API_KEY:desktop.DEEPSEEK_API_KEY,DEEPSEEK_BASE_URL:env.DEEPSEEK_BASE_URL??desktop.DEEPSEEK_BASE_URL,SHALLOWGROOVE_MODEL:env.SHALLOWGROOVE_MODEL??desktop.SHALLOWGROOVE_MODEL};
 }catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return env;
  throw Error('Could not read desktop/private-config.json');
 }
}

export default defineConfig(({mode,command})=>{
 const env={...loadEnv(mode,process.cwd(),''),...process.env} as Record<string,string>;
 const network=env.SHALLOWGROOVE_NETWORK==='1';
 return {
  cacheDir:'node_modules/.vite-shallowgroove',
  plugins:[react(),hexblocksPlugin(env),assistantPlugin(assistantEnvironment(env,command==='serve'&&!network))],
  server:{host:network?'0.0.0.0':'127.0.0.1',fs:{deny:['.env','.env.*','*.{crt,pem,key,p12,pfx,cer,der}','.npmrc','.yarnrc.yml','**/.git/**','**/desktop/private-config.json']}},
  build:{minify:false},worker:{format:'es'}
 };
});
