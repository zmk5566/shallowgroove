import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {assistantPlugin} from '../server/assistant.mjs';
import {hexblocksPlugin} from '../server/hexblocks.mjs';
const root=resolve(import.meta.dirname,'..');
const dev=process.argv.includes('--vite-dev');
let config={};
try{if(!dev)config=JSON.parse(await readFile(resolve(root,'desktop/private-config.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const env={...process.env,...config,DEEPSEEK_API_KEY:config.DEEPSEEK_API_KEY||'',DEEPSEEK_BASE_URL:config.DEEPSEEK_BASE_URL||'',SG_KEY_SOURCE:config.DEEPSEEK_API_KEY?'builtin':'none',SG_KEY_REVISION:0};
const middleware=[];
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer((req,res)=>{
 let i=0;
 const next=()=>{if(middleware[i])return middleware[i++](req,res,next);void serve(req,res);};next();
});
async function serve(req,res){
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const base=resolve(root,'dist');const file=resolve(base,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(base+sep)){res.writeHead(403);res.end();return;}
  const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}
}
const plugins=[hexblocksPlugin(env),assistantPlugin(env)];
for(const p of plugins){p.configResolved?.({root});p.configureServer({httpServer:server,middlewares:{use(fn){middleware.push(fn);}}});}
let vite;
if(dev){
 const {createServer:createVite}=await import('vite');
 const react=(await import('@vitejs/plugin-react')).default;
 vite=await createVite({root,configFile:false,cacheDir:'node_modules/.vite-electron',plugins:[react()],server:{middlewareMode:true,hmr:{server},fs:{deny:['.env','.env.*','*.{crt,pem,key,p12,pfx,cer,der}','.npmrc','.yarnrc.yml','**/.git/**','**/desktop/private-config.json']}}});
 middleware.push(vite.middlewares);
}
let fallback=false;
server.on('error',error=>{
 if(error.code==='EADDRINUSE'&&!fallback){fallback=true;server.listen(0,'127.0.0.1');}
 else{console.error(error);process.exit(1);}
});
server.once('listening',()=>process.send?.({port:server.address().port}));
server.listen(dev?0:5198,'127.0.0.1');
let closing=false;
async function shutdown(){if(closing)return;closing=true;await vite?.close();await Promise.allSettled(plugins.map(p=>p.closeBundle?.()));server.close();setTimeout(()=>process.exit(),500).unref();}
process.on('SIGTERM',shutdown);process.on('disconnect',shutdown);
process.on('message',message=>{if(message?.type==='shutdown')void shutdown();
 if(message?.type==='credential'&&typeof message.key==='string'){
  if(config.DEEPSEEK_API_KEY){process.send?.({ack:message.id,ignored:true});return;}
  env.DEEPSEEK_API_KEY=message.key;
  env.DEEPSEEK_BASE_URL=message.key?'https://api.deepseek.com':'';
  env.SG_KEY_SOURCE=message.key?'user':'none';
  env.SG_KEY_REVISION++;
  process.send?.({ack:message.id});
 }});
