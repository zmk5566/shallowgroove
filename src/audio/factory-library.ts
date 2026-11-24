import {effectLibrary,libraryKinds} from '../model/effect-library';
import type {LibraryEntry} from '../model/user-library';
import {factoryInstruments} from './patch-bank';
import {effectSources} from './effects';

export function factoryEntries(zh:boolean):LibraryEntry[]{
 const locale=zh?'zh':'en';
 const entries:LibraryEntry[]=factoryInstruments(zh).map(({id,name,code})=>({
  id:'factory:instrument:'+id,revision:1,name,kind:'instrument',code,values:{}
 }));
 for(const kind of libraryKinds){
  const effect=effectLibrary[kind];
  const base={id:'factory:effect:'+kind,revision:1,kind,name:effect[locale],code:effectSources[kind],values:{}};
  entries.push(base);
  for(const preset of effect.presets){
   entries.push({...base,id:base.id+':'+preset.id,name:base.name+' · '+preset[locale],values:{...preset.values}});
  }
 }
 return entries;
}
