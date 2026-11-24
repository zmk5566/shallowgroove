const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {installPlugins}=require('./install-plugins.cjs');

test('installs both VST3s with a desktop launch profile and retains prior installation if a bundle is missing',async t=>{
 const root=await fs.mkdtemp(join(tmpdir(),'sg-plugin-install-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const destination=join(root,'Installed'),registration=join(root,'Settings');
 const options={destination,registration,executable:process.execPath,args:['--user-data-dir=Test Profile'],source:(_,name)=>join(root,name)};
 for(const name of ['ShallowGroove FX','ShallowGroove Rack']){
  const folder=join(root,name+'.vst3','Contents');
  await fs.mkdir(folder,{recursive:true});await fs.writeFile(join(folder,'fixture'),name);
 }
 await installPlugins(options);
 const config=JSON.parse(await fs.readFile(join(registration,'Plugin Host.json'),'utf8'));
 assert.equal(config.executable,process.execPath);assert.deepEqual(config.args,options.args);
 await fs.writeFile(join(root,'ShallowGroove FX.vst3/Contents/fixture'),'replacement');
 await fs.rename(join(root,'ShallowGroove Rack.vst3'),join(root,'Unavailable'));
 await assert.rejects(installPlugins(options));
 assert.equal(await fs.readFile(join(destination,'ShallowGroove FX.vst3/Contents/fixture'),'utf8'),'ShallowGroove FX');
});
