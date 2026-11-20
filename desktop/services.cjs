const {fork,spawn}=require('node:child_process');
const {join,delimiter}=require('node:path');

function track(child){
 child.exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);});
 return child;
}
function waitReady(child,listen,timeoutMs=30000){
 return new Promise((resolve,reject)=>{
  let errors='';
  child.stderr?.on('data',data=>{errors=(errors+data).slice(-3000);});
  const timer=setTimeout(()=>finish(new Error('后台启动超时')),timeoutMs);
  const onError=error=>finish(error);
  const onExit=code=>finish(new Error(`后台退出 (${code}) ${errors}`));
  function finish(error,value){
   clearTimeout(timer);child.removeListener('error',onError);child.removeListener('exit',onExit);
   if(error){void stopService(child);reject(error);}else resolve(value);
  }
  child.once('error',onError);child.once('exit',onExit);
  listen(value=>{
   if(!Number.isInteger(value?.port)||value.port<1||value.port>65535)return finish(new Error('后台返回了无效端口'));
   finish(null,value.port);
  });
 });
}
function startMusic({root,resources,dataDirectory,dev=false}){
 const runtime=join(resources,'runtime');
 const child=track(fork(join(root,'desktop/server.mjs'),dev?['--vite-dev']:[],{
  execPath:dev?join(root,'node_modules/node/bin',process.platform==='win32'?'node.exe':'node'):join(runtime,process.platform==='win32'?'node.exe':'node'),cwd:root,windowsHide:true,
  env:{...process.env,SHALLOWGROOVE_DATA_DIR:dataDirectory,PATH:runtime+delimiter+(process.env.PATH||'')},
  stdio:['ignore','ignore','pipe','ipc'],
 }));
 child.kind='music';
 child.ready=waitReady(child,accept=>child.once('message',accept));
 return child;
}
function startConnect({resources,musicPort,smoke=false}){
 const service=join(resources,'connect-service'),windows=process.platform==='win32';
 const executable=windows?join(service,'python/python.exe'):join(service,'backend/connect-backend/connect-backend');
 const args=[...(windows?[join(service,'desktop/launcher.py')]:[]),'--hexblocks-source',join(service,'shared/frontend/bridge'),'--server',`ws://127.0.0.1:${musicPort}/hexblocks/ws`];
 if(smoke)args.push('--sim','--id','hexblocks-integrated-smoke');
 const child=track(spawn(executable,args,{cwd:service,windowsHide:true,env:{...process.env,PYTHONUNBUFFERED:'1',PYTHONUTF8:'1'},stdio:['pipe','pipe','pipe']}));
 child.kind='connect';
 child.ready=waitReady(child,accept=>{
  let output='',ready=false;
  child.stdout.on('data',data=>{
   output+=data.toString();let index;
   while((index=output.indexOf('\n'))>=0){
    const line=output.slice(0,index).trim();output=output.slice(index+1);
    if(ready||!line.startsWith('HEXBLOCKS_READY '))continue;
    ready=true;
    try{accept(JSON.parse(line.slice('HEXBLOCKS_READY '.length)));}catch{accept(null);}
   }
   if(output.length>8192)output=output.slice(-8192);
  });
 });
 return child;
}
async function stopService(child){
 if(!child)return;
 if(child.stopping)return child.stopping;
 child.stopping=(async()=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  if(child.kind==='music'&&child.connected)child.send({type:'shutdown'},()=>{});
  else if(child.stdin&&!child.stdin.destroyed){child.stdin.on('error',()=>{});child.stdin.end();}
  const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}},5000);
  await child.exited;clearTimeout(timer);
 })();
 return child.stopping;
}
module.exports={startMusic,startConnect,stopService};
