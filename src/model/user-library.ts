import type {EffectKind} from '../audio/effects';
import {makeLibraryEntry, validLibraryRef} from './library-entry.mjs';
export {validLibraryRef} from './library-entry.mjs';

export type LibraryRef = {id:string;revision:number;name:string};
export type LibraryPatch = {kind:EffectKind|'instrument';code:string;values:Record<string,number>};
export type LibraryEntry = LibraryRef & LibraryPatch;

let database:Promise<IDBDatabase>|undefined;
function openLibrary():Promise<IDBDatabase> {
 if (!database) database = new Promise<IDBDatabase>((resolve,reject)=>{
  const request = indexedDB.open('shallowgroove-user-library',1);
  request.onupgradeneeded = ()=>{
   request.result.createObjectStore('revisions',{keyPath:['id','revision']});
   request.result.createObjectStore('heads',{keyPath:'id'});
  };
  request.onsuccess = ()=>resolve(request.result);
  request.onerror = ()=>reject(request.error);
 }).catch(error=>{database=undefined;throw error;});
 return database;
}
export async function listUserPatches():Promise<LibraryEntry[]> {
 const native = window.shallowgrooveDesktop;
 let entries:LibraryEntry[];
 if (native) entries = await native.libraryList();
 else {
  const db = await openLibrary();
  entries = await new Promise<LibraryEntry[]>((resolve,reject)=>{
   const request = db.transaction('heads').objectStore('heads').getAll();
   request.onsuccess = ()=>resolve(request.result);
   request.onerror = ()=>reject(request.error);
  });
 }
 return entries.sort((a,b)=>a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export async function saveUserPatch(name:string,patch:LibraryPatch,previous?:LibraryRef):Promise<LibraryEntry> {
 if (previous !== undefined && !validLibraryRef(previous)) throw Error('Invalid patch reference');
 const native = window.shallowgrooveDesktop;
 if (native) return native.librarySave(name,patch,previous);
 const db = await openLibrary();
 return new Promise((resolve,reject)=>{
  // Keep the head lookup and both writes inside one transaction across tabs.
  const tx = db.transaction(['heads','revisions'],'readwrite'), heads = tx.objectStore('heads');
  let saved:LibraryEntry;
  const write = (head?:LibraryEntry)=>{
   try {
    saved = makeLibraryEntry(name,patch,previous,head);
    tx.objectStore('revisions').add(saved);
    heads.put(saved);
   } catch (error) { tx.abort(); reject(error); }
  };
  tx.oncomplete = ()=>resolve(saved);
  tx.onabort = ()=>reject(tx.error ?? Error('Library write aborted'));
  if (previous) {
   const request = heads.get(previous.id);
   request.onsuccess = ()=>write(request.result);
  } else write();
 });
}
