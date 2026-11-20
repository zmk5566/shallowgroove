const fs=require('node:fs/promises');
const {join}=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const repo=require('./music-git.cjs');

async function exists(file){
 try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function create(folder,fn){
 const target=join(folder,'versions');
 if(await exists(target))throw Error('Version folder already exists');
 const temp=await fs.mkdtemp(join(folder,'.sg-versions-'));
 try{const dir=join(temp,'repo');const value=await fn(dir);await fs.rename(dir,target);return value;}
 finally{await fs.rm(temp,{recursive:true,force:true});}
}
function branchName(name){
 if(typeof name!=='string'||!name||name.length>180||!/^([\p{L}\p{N}_][\p{L}\p{N}._/-]*)$/u.test(name))throw Error('Invalid branch name');
 return name;
}
async function versions(folder,cmd,read,atomic){
 const dir=join(folder,'versions'),file=join(folder,'project.json');
 if(cmd.action==='link'){
  const text=await read(file),source=JSON.parse(text).versionSource;
  if(!source||!repo.oid.test(source.commit))throw Error('ZIP has no Git base');
  branchName(cmd.name);
  await create(folder,async target=>{
   await repo.clone(target,source.url);
   if(!(await repo.git(target,'branch','-r','--contains',source.commit)))throw Error('Remote does not contain ZIP base');
   await repo.readTree(target,source.commit);
   await repo.git(target,'switch','-c',cmd.name,source.commit);
   await repo.checkpoint(target,text,'Import project ZIP');
  });
 }
 if(cmd.action==='init'&&!await exists(join(dir,'.git')))await create(folder,async d=>repo.init(d,await read(file)));
 if(!await exists(join(dir,'.git'))){if(cmd.action==='status')return {source:JSON.parse(await read(file)).versionSource};throw Error('Enable version history first');}
 if(cmd.action==='preview')return {text:repo.join(await repo.readTree(dir,cmd.commit))};
 if(cmd.action==='checkpoint')await repo.checkpoint(dir,await read(file),cmd.name,cmd.chat);
 if(cmd.action==='remote')await repo.connect(dir,cmd.url);
 if(cmd.action==='fetch')await repo.fetchAll(dir);
 if(cmd.action==='push'){
  const state=await repo.status(dir);repo.remoteURL(state.remote);repo.remoteURL(await repo.git(dir,'remote','get-url','--push','origin'));
  await repo.git(dir,'push','origin','refs/heads/'+state.branch+':refs/heads/'+state.branch);
 }
 if(['pull','switch','branch'].includes(cmd.action)){
  const old=await repo.head(dir),branch=await repo.git(dir,'branch','--show-current'),local=await read(file);
  await repo.clean(dir);
  const disk=repo.split(local),committed=await repo.readTree(dir,old);
  committed.delete('music/conversation.json');
  const equal=(k,v,w)=>k.endsWith('.json')?isDeepStrictEqual(JSON.parse(v),JSON.parse(w)):v===w;
  if(disk.size!==committed.size||[...disk].some(([k,v])=>!committed.has(k)||!equal(k,v,committed.get(k))))throw Error('请先保存一个版本 / Create a checkpoint for your edits first');
  let target,remoteBranch=false;
  if(cmd.action==='pull'){
   target=await repo.fetchBranch(dir,branch);
   if(target===old)return {state:await repo.status(dir)};
   try{await repo.git(dir,'merge-base','--is-ancestor',target,old);return {state:await repo.status(dir)};}catch{}
   try{await repo.git(dir,'merge-base','--is-ancestor',old,target);}catch{throw Error('分支已分叉，请在 Git 中合并 / Branches diverged. Merge in Git first');}
  }else{
   branchName(cmd.name);await repo.git(dir,'check-ref-format','--branch',cmd.name);
   if(cmd.action==='branch')target=cmd.commit;
   else{const state=await repo.status(dir);remoteBranch=!state.branches.includes(cmd.name)&&state.remoteBranches.includes(cmd.name);
    target=await repo.git(dir,'rev-parse','--verify',(remoteBranch?'refs/remotes/origin/':'refs/heads/')+cmd.name);}
  }
  const restored=JSON.parse(repo.join(await repo.readTree(dir,target))),localEditor=JSON.parse(local).editor;
  if(localEditor?.conversationProject&&restored.editor)restored.editor.conversationProject=localEditor.conversationProject;
  const text=JSON.stringify(restored);require('../src/model/project-files.ts').readDocument(text);
  if(cmd.action==='pull')await repo.git(dir,'merge','--ff-only',target);
  else if(cmd.action==='branch'||remoteBranch)await repo.git(dir,'switch','-c',cmd.name,target);
  else await repo.git(dir,'switch','--no-guess',cmd.name);
  try{await atomic(file,text);}catch(e){if(cmd.action==='pull')await repo.git(dir,'reset','--keep',old);else await repo.git(dir,'switch',branch);throw e;}
  return {state:await repo.status(dir),text};
 }
 return {state:await repo.status(dir)};
}
module.exports={create,versions};
