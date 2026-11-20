const {readFileSync,writeFileSync,renameSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');

function credentialStore(directory,storage){
 const file=join(directory,'deepseek-key.enc');
 function available(){
  if(!storage.isEncryptionAvailable()||(process.platform==='linux'&&storage.getSelectedStorageBackend?.()==='basic_text'))throw Error('storage');
 }
 return {
  read(){
   let bytes;
   try{bytes=readFileSync(file);}catch(error){if(error.code==='ENOENT')return '';throw error;}
   available();return storage.decryptString(bytes);
  },
  save(key){
   if(!key){rmSync(file,{force:true});return;}
   available();const encrypted=storage.encryptString(key),temp=file+'.'+randomUUID();
   try{writeFileSync(temp,encrypted,{mode:0o600,flag:'wx'});renameSync(temp,file);}finally{rmSync(temp,{force:true});}
  },
 };
}
async function validateKey(key,request=fetch){
 if(typeof key!=='string'||!key.length||key.length>512||!/^[\x21-\x7e]+$/.test(key))return 'invalid';
 try{
  const response=await request('https://api.deepseek.com/models',{headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(12000)});
  if([401,403].includes(response.status))return 'invalid';
  return response.ok&&Array.isArray((await response.json()).data)?'ok':'network';
 }catch{return 'network';}
}
module.exports={credentialStore,validateKey};
