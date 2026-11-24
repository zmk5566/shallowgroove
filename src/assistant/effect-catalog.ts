import type {LibraryEntry} from '../model/user-library';

export interface EffectSearch {query?:string;source?:'factory'|'user';offset?:number}
export function searchEffects(entries:LibraryEntry[],{query='',source,offset=0}:EffectSearch){
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid search offset');
 const terms=query.trim().toLowerCase().split(/\s+/);
 const matches=entries.filter(entry=>entry.kind!=='instrument').map(({id,name,kind,revision})=>({
  id,name,kind,revision,source:id.startsWith('factory:')?'factory':'user'
 })).filter(entry=>(!source||entry.source===source)&&terms.every(term=>(entry.name+' '+entry.kind+' '+entry.id).toLowerCase().includes(term)));
 const page=matches.slice(offset,offset+40);
 return {entries:page,total:matches.length,nextOffset:offset+page.length<matches.length?offset+page.length:null};
}
export function resolveEffect(entries:LibraryEntry[],id?:string,revision?:number){
 const entry=entries.find(item=>item.id===id&&item.kind!=='instrument');
 if(!entry||entry.revision!==revision)throw Error('Effect missing or revised. Search the effect library again.');
 return entry;
}
