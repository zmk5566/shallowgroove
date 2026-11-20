const {execFile}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const {split,join}=require('./music-tree.cjs');
const limit=100*1024*1024;
const oid=/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const {sourcePath:safeFile}=require('../src/model/music-sources.mjs');
function remoteURL(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Use an HTTPS Git URL without credentials');
 return u.href;
}
function git(cwd,args,input){
 return new Promise((resolve,reject)=>{
  const child=execFile('git',['-c','core.hooksPath='+require('node:os').devNull,'-c','protocol.allow=never','-c','protocol.https.allow=always','-c','core.autocrlf=false','-c','core.fsmonitor=false','-c','commit.gpgSign=false','-c','user.name=ShallowGroove','-c','user.email=studio@localhost',...args],{cwd,maxBuffer:limit,timeout:120000,encoding:'buffer',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}},(e,out,err)=>e?reject(Error(e.code==='ENOENT'?'Install Git to use project version control':err.toString().trim()||e.message)):resolve(out));
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
const run=async(dir,...args)=>(await git(dir,args)).toString().trim();
async function readTree(dir,commit){
 if(!oid.test(commit))throw Error('Invalid commit');
 const entries=(await run(dir,'ls-tree','-rlz',commit)).split('\0').filter(Boolean).map(row=>{
  const match=/^100644 blob ([a-f0-9]+) +(\d+)\t(.+)$/.exec(row);
  if(!match||!safeFile.test(match[3]))throw Error('Unsupported files in music repository');
  return {id:match[1],size:Number(match[2]),path:match[3]};
 });
 if(!entries.length||entries.length>30000||entries.reduce((n,e)=>n+e.size,0)>limit)throw Error('Invalid repository size');
 const data=await git(dir,['cat-file','--batch'],entries.map(e=>e.id).join('\n')+'\n'),files=new Map();let offset=0;
 for(const e of entries){const start=data.indexOf(10,offset)+1;files.set(e.path,data.toString('utf8',start,start+e.size));offset=start+e.size+1;}
 return files;
}
async function head(dir){return run(dir,'rev-parse','--verify','HEAD');}
async function clean(dir){if(await run(dir,'status','--porcelain'))throw Error('版本目录有外部修改，请先用 Git 保存 / Commit external repository changes first');}
async function writeTree(dir,files,persist){
 const temp=await fs.mkdtemp(path.join(path.dirname(dir),'.music-tree-'));
 try{
  for(const [file,data] of files){const dest=path.join(temp,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,data);}
  const music=path.join(dir,'music'),backup=path.join(temp,'previous');let moved=false;
  try{await fs.rename(music,backup);moved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.rename(path.join(temp,'music'),music).catch(async e=>{if(moved)await fs.rename(backup,music);throw e;});
  try{await persist();}catch(e){
   await fs.rm(music,{recursive:true,force:true});if(moved)await fs.rename(backup,music);
   if(moved)await run(dir,'reset','--quiet','HEAD','--','music');throw e;
  }
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}
async function checkpoint(dir,text,message,chat){
 const files=split(text);
 if(chat?.length){const entries=chat.filter(m=>['user','assistant'].includes(m?.role)&&typeof m.text==='string').map(({role,text})=>({role,text}));if(entries.length)files.set('music/conversation.json',JSON.stringify(entries,null,2)+'\n');}
 await clean(dir);await writeTree(dir,files,async()=>{
 await run(dir,'add','-A','--','music');
 if(await run(dir,'diff','--cached','--name-only')){
  const summary=await run(dir,'diff','--cached','--stat','--','music');
  await run(dir,'commit','-m',message?.trim()||summary.split('\n').at(-1));
 }
 });
 return head(dir);
}
async function init(dir,text){
 await fs.mkdir(dir);await run(dir,'init','-b','main');await checkpoint(dir,text,'Initial project');
}
async function status(dir){
 const branch=await run(dir,'branch','--show-current'),remote=await run(dir,'remote');
 const log=await run(dir,'log','--graph','--all','-n','250','--format=%x1e%H%x09%P%x09%D%x09%s');
 return {branch,head:await head(dir),remote:remote.split('\n').includes('origin')?remoteURL(await run(dir,'remote','get-url','origin')):'',
  branches:(await run(dir,'for-each-ref','--format=%(refname:short)','refs/heads')).split('\n'),
  remoteBranches:(await run(dir,'for-each-ref','--format=%(refname:lstrip=3)','refs/remotes/origin')).split('\n').filter(x=>x&&x!=='HEAD'),
  commits:log.split('\n').filter(line=>line.includes('\x1e')).map(line=>{const [graph,row]=line.split('\x1e');const [id,parents,refs,...title]=row.split('\t');return {graph,id,parents,refs,title:title.join(' ')};})};
}
async function connect(dir,url){
 const target=remoteURL(url),names=(await run(dir,'remote')).split('\n');
 await run(dir,'remote',names.includes('origin')?'set-url':'add','origin',target);
}
async function fetchBranch(dir,branch){
 await run(dir,'check-ref-format','--branch',branch);
 remoteURL(await run(dir,'remote','get-url','origin'));
 await run(dir,'fetch','--no-tags','origin','+refs/heads/'+branch+':refs/remotes/origin/'+branch);
 return run(dir,'rev-parse','FETCH_HEAD');
}
async function fetchAll(dir){remoteURL(await run(dir,'remote','get-url','origin'));await run(dir,'fetch','--prune','--no-tags','origin','+refs/heads/*:refs/remotes/origin/*');}
async function clone(dir,url){
 const target=remoteURL(url);await fs.mkdir(dir);await run(dir,'init','-b','main');await connect(dir,target);
 const refs=await run(dir,'ls-remote','--symref','origin','HEAD'),branch=/^ref: refs\/heads\/(.+)\tHEAD/m.exec(refs)?.[1];
 if(!branch)throw Error('Remote has no default branch');
 await fetchAll(dir);const id=await run(dir,'rev-parse','refs/remotes/origin/'+branch),text=join(await readTree(dir,id));
 require('../src/model/project-files.ts').readDocument(text);
 await run(dir,'checkout','-B',branch,id);return text;
}
module.exports={git:run,head,clean,init,checkpoint,status,remoteURL,connect,clone,fetchAll,fetchBranch,readTree,split,join,oid};
