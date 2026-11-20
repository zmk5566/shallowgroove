import type {ProjectDraft,ProjectRecord,ProjectStorage} from './project-files';
let database:Promise<IDBDatabase>|undefined;
function db(){return database??=new Promise((resolve,reject)=>{const request=indexedDB.open('shallowgroove-projects',1);request.onupgradeneeded=()=>request.result.createObjectStore('projects');request.onsuccess=()=>resolve(request.result);request.onerror=()=>{database=undefined;reject(request.error);};});}
async function access(mode:'read'|'write',key:string,value?:unknown){const database=await db();return new Promise<unknown>((resolve,reject)=>{const tx=database.transaction('projects',mode==='read'?'readonly':'readwrite'),store=tx.objectStore('projects');const request=mode==='read'?key==='*'?store.getAll():store.get(key):value===null?store.delete(key):store.put(value,key);tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('Browser storage aborted'));});}
export const browserProjects:ProjectStorage={
 async list(){return (await access('read','*') as {record?:ProjectRecord}[]).filter(item=>item.record).map(item=>item.record!).sort((a,b)=>b.updated-a.updated);},
 async read(id){const saved=await access('read',`project:${id}`) as {record:ProjectRecord;text:string}|undefined;if(!saved)throw Error('Project not found in this browser');return saved;},
 async save(text,name,id){const record:ProjectRecord={id:id??crypto.randomUUID(),name,updated:Date.now(),location:'browser'};await access('write',`project:${record.id}`,{record,text});navigator.storage?.persist?.().catch(()=>{});return record;},
 async draft(value){if(value!==undefined)await access('write','draft',value);return (await access('read','draft') as ProjectDraft)??null;},
};
export function projectStorage():ProjectStorage{
 const native=window.shallowgrooveDesktop;
 return native?{list:()=>native.projectList(),read:id=>native.projectRead(id),save:(text,name,id)=>native.projectSave(text,name,id),draft:value=>native.projectDraft(value),open:()=>native.projectOpen()}:browserProjects;
}
