import {test} from 'node:test';import assert from 'node:assert/strict';
import {ProjectManager} from '../src/model/project-manager.ts';
import {packFile} from '../src/model/session.ts';
import {emptyProject,type ProjectDraft,type ProjectRecord,type ProjectStorage} from '../src/model/project-files.ts';
function fixture(){
 const project=emptyProject();project.tracks=[];
 let text=JSON.stringify(packFile({project,voices:[],chains:[[],[],[]],sends:[],buses:[{level:1,muted:false},{level:1,muted:false},{level:1,muted:false}]}));let draft:ProjectDraft|null=null;
 const files=new Map<string,{record:ProjectRecord;text:string}>();
 const storage:ProjectStorage={async list(){return [...files.values()].map(x=>x.record);},async read(id){const f=files.get(id);if(!f)throw Error('missing');return f;},async save(text,name,id){const record:ProjectRecord={id:id??'saved',name,updated:1,location:'browser'};files.set(record.id,{record,text});return record;},async draft(value){if(value!==undefined)draft=value;return draft;}};
 const manager=new ProjectManager(storage,{snapshot:()=>text,load:async next=>{text=next;},example:async()=>{},create:async()=>{},pause:()=>{},askName:async()=> 'My song',askLeave:async()=> 'discard'});
 return {manager,storage,files,getDraft:()=>draft,edit:()=>{const f=JSON.parse(text);f.session.buses[2].level=.4;text=JSON.stringify(f);}};
}
test('example edits only create a recovery draft until explicit Save',async()=>{const f=fixture();await f.manager.openExample('DaisyBell');f.edit();await f.manager.scan();assert.equal(f.files.size,0);assert.ok(f.getDraft());assert.equal(f.manager.state.dirty,true);await f.manager.save();assert.equal(f.files.size,1);assert.equal(f.manager.state.dirty,false);});
test('cancelling Save keeps dirty project and does not leave',async()=>{const f=fixture();await f.manager.newProject();f.storage.save=async()=>null;assert.equal(await f.manager.save(),false);assert.equal(f.manager.state.dirty,true);});
test('discard to welcome removes recovery without overwriting saved project',async()=>{const f=fixture();await f.manager.newProject();await f.manager.save();const original=f.files.get('saved')!.text;f.edit();await f.manager.scan();await f.manager.goHome();assert.equal(f.getDraft(),null);assert.equal(f.files.get('saved')!.text,original);assert.equal(f.manager.state.home,true);});
test('failed open keeps current project identity and changes',async()=>{const f=fixture();await f.manager.newProject();f.edit();await f.manager.scan();await assert.rejects(()=>f.manager.openRecent('missing'));assert.equal(f.manager.state.source,'new');assert.equal(f.manager.state.dirty,true);assert.equal(f.manager.state.home,false);});
test('startup lists recovery separately and does not auto-load audio',async()=>{const f=fixture();await f.manager.newProject();await f.manager.scan();await f.manager.initialize();assert.ok(f.manager.state.draft);assert.equal(f.files.size,0);});
test('welcome does not overwrite an existing recovery draft without consent',async()=>{const f=fixture();await f.manager.newProject();await f.manager.scan();f.manager.state={...f.manager.state,home:true};f.manager.adapter.askLeave=async()=> 'cancel';const old=f.getDraft();await f.manager.openExample('DaisyBell');assert.deepEqual(f.getDraft(),old);assert.equal(f.manager.state.home,true);});
test('closing the welcome page retains an existing recovery draft',async()=>{const f=fixture();await f.manager.newProject();await f.manager.scan();f.manager.state={...f.manager.state,home:true};const old=f.getDraft();assert.equal(await f.manager.requestClose(),true);assert.deepEqual(f.getDraft(),old);});
test('edits made while a save is pending remain dirty and recoverable',async()=>{const f=fixture();await f.manager.newProject();let finish!:(value:ProjectRecord)=>void;f.storage.save=async()=>new Promise(resolve=>{finish=resolve;});const saving=f.manager.save();await new Promise(resolve=>setImmediate(resolve));f.edit();finish({id:'saved',name:'My song',location:'browser',updated:1});assert.equal(await saving,false);assert.equal(f.manager.state.dirty,true);assert.ok(f.getDraft());});

test('idle recovery scans skip packing until MIDI or mutable editor settings change',async()=>{
 const f=fixture();await f.manager.openExample('DaisyBell');
 const snapshot=f.manager.adapter.snapshot;let packs=0;
 f.manager.adapter.snapshot=()=>{packs++;return snapshot();};
 const revision={project:{},settings:'initial'};
 await f.manager.scan(revision);
 const count=packs;await f.manager.scan(revision);
 assert.equal(packs,count);assert.equal(f.getDraft(),null);
 f.edit();await f.manager.scan({...revision,settings:'changed rack'});
 assert.ok(f.getDraft());assert.equal(packs,count+1);
 await f.manager.scan({project:{},settings:'changed rack'});
 assert.equal(packs,count+2);
});
