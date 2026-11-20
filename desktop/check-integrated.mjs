import {execFileSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {mkdtemp,readFile,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const source=resolve(process.argv[2]);
const directory=await mkdtemp('/private/tmp/shallowgroove-integrated-');
console.log('Test directory:',directory);
const app=join(directory,'ShallowGroove.app');
if(source.endsWith('.zip'))execFileSync('/usr/bin/ditto',['-x','-k',source,directory]);
else execFileSync('/bin/cp',['-cR',source,app]);
async function links(path){for(const entry of await readdir(path)){const p=join(path,entry),s=await lstat(p);if(s.isSymbolicLink())assert.ok((await realpath(p)).startsWith(app+sep),`External symlink ${p}`);else if(s.isDirectory())await links(p);}}
await links(app);execFileSync('codesign',['--verify','--deep','--strict',app]);
const resources=join(app,'Contents/Resources'),root=join(resources,'app');
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const info=JSON.parse(execFileSync('plutil',['-convert','json','-o','-',join(app,'Contents/Info.plist')],{encoding:'utf8'}));
assert.equal(info.CFBundleShortVersionString,version);assert.ok(info.NSBluetoothAlwaysUsageDescription);
const report=join(directory,'smoke.json');
function run(exitAction='main-close'){
 rmSync(report,{force:true});
 execFileSync(join(app,'Contents/MacOS/ShallowGroove'),[],{cwd:directory,env:{...process.env,SHALLOWGROOVE_SMOKE:'1',SHALLOWGROOVE_SMOKE_OUTPUT:report,SHALLOWGROOVE_SMOKE_EXIT:exitAction},stdio:'inherit',timeout:90000});
}
async function exited(){
 const result=JSON.parse(await readFile(report,'utf8'));
 assert.equal(result.version,version);assert.equal(result.hiddenSensor,0.73);assert.equal(result.windowReused,true);assert.equal(result.connectInitiallyHidden,true);
 for(const pid of [result.backendPid,result.connectPid])assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH',`Backend ${pid} survived Quit`);
 for(const port of [result.port,result.connectPort])await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
 return result;
}
run();assert.equal((await exited()).exitAction,'main-close');
const blockers=[];
try{
 for(const port of [5198,8766]){
  const server=createServer(socket=>socket.destroy());
  await new Promise((done,reject)=>{server.once('error',error=>error.code==='EADDRINUSE'?done():reject(error));server.listen(port,'127.0.0.1',()=>{blockers.push(server);done();});});
 }
 run('quit');const fallback=await exited();assert.equal(fallback.exitAction,'quit');assert.notEqual(+fallback.port,5198);assert.notEqual(fallback.connectPort,8766);
}finally{for(const server of blockers)await new Promise(done=>server.close(done));}
if(process.argv.includes('--live'))execFileSync(join(resources,'runtime/node'),[join(root,'desktop/check.mjs'),'--live'],{cwd:directory,stdio:'inherit',timeout:120000});
console.log('PASS: signed standalone Mac app, automatic fallback for both ports, main-window close and explicit Quit stop both services');
console.log(directory);
