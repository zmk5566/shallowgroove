import {cp,mkdir,mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import {join,basename} from 'node:path';

export const privateBuild=process.argv.includes('--private');
export const outputDirectory=privateBuild?'release/private':'release/public';
export async function stageApplication(root,platform,privateEdition=privateBuild){
 const output=join(root,privateEdition?'release/private':'release/public');
 await mkdir(output,{recursive:true});
 const stage=await mkdtemp(join(output,'build-'+platform+'-')),app=join(stage,'app');
 await mkdir(app);
 for(const file of ['package.json','package-lock.json','LICENSE','LICENSE-EXAMPLES','NOTICE.md','desktop','server','src','dist']){
  await cp(join(root,file),join(app,file),{recursive:true,filter:path=>basename(path)!=='private-config.json'&&!/^\.env(?:\.|$)/.test(basename(path))});
 }
 if(privateEdition){
  const config=JSON.parse(await readFile(join(root,'desktop/private-config.json'),'utf8'));
  if(!config.DEEPSEEK_API_KEY)throw Error('Private build requires a DeepSeek key');
  const settings=Object.fromEntries(['DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','SHALLOWGROOVE_MODEL'].filter(k=>typeof config[k]==='string').map(k=>[k,config[k]]));
  await writeFile(join(app,'desktop/private-config.json'),JSON.stringify(settings),{mode:0o600});
 }
 return stage;
}
export async function verifyEdition(app,expectedPrivate=privateBuild){
 const exists=await access(join(app,'desktop/private-config.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
 if(exists!==expectedPrivate)throw Error('Application credential configuration does not match the requested edition');
}
