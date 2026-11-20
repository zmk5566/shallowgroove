import {strFromU8,strToU8,zipSync,unzipSync} from 'fflate';
import {sourcePath,joinSources} from './music-sources.mjs';
import {parseFile} from './session.ts';
import type {Project} from './project';
export const PROJECT_LIMIT=100*1024*1024;
export type EditorState={conversationProject?:string;exampleId:string|null;soundSet:'basic'|'period';codeDrafts:Record<string,string>;effectDrafts?:Record<string,string>};
export function readDocument(text:string){
 if(new TextEncoder().encode(text).length>PROJECT_LIMIT)throw Error('Project exceeds 100 MB');
 const parsed=parseFile(text),raw=JSON.parse(text);
 if(raw.editor!=null&&(typeof raw.editor!=='object'||Array.isArray(raw.editor)))throw Error('Invalid editor metadata');
 const editor:EditorState={exampleId:null,soundSet:'basic',codeDrafts:{},...raw.editor};
 if(!['basic','period'].includes(editor.soundSet))throw Error('Invalid editor sound set');
 // The session contains its instruments and notes even when its example is no longer installed.
 if(editor.exampleId!==null&&(typeof editor.exampleId!=='string'||!editor.exampleId.length||editor.exampleId.length>200))throw Error('Invalid editor example ID');
 if(!editor.codeDrafts||Array.isArray(editor.codeDrafts)||typeof editor.codeDrafts!=='object'||Object.values(editor.codeDrafts).some(v=>typeof v!=='string'||v.length>60000))throw Error('Invalid instrument source drafts');
 if(editor.conversationProject!==undefined&&(typeof editor.conversationProject!=='string'||!editor.conversationProject.length||editor.conversationProject.length>500))throw Error('Invalid conversation project');
 if(editor.effectDrafts!==undefined&&(!editor.effectDrafts||typeof editor.effectDrafts!=='object'||Array.isArray(editor.effectDrafts)||Object.values(editor.effectDrafts).some(v=>typeof v!=='string'||v.length>60000)))throw Error('Invalid effect source drafts');
 if(raw.name!==undefined&&(typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>200))throw Error('Invalid project name');
 return {...parsed,editor,name:(raw.name??parsed.session.project.title) as string};
}
export function documentFingerprint(text:string){const {session,editor}=readDocument(text);return JSON.stringify({session,editor});}
export function namedDocument(text:string,name:string){const raw=JSON.parse(text);const result=JSON.stringify({...raw,name});readDocument(result);return result;}
export function zipDocument(text:string){readDocument(text);return zipSync({'project.json':strToU8(text)},{level:6});}
export function unzipDocument(bytes:Uint8Array){
 if(bytes.length>PROJECT_LIMIT)throw Error('Archive exceeds 100 MB');
 let total=0,count=0;const names=new Set<string>();
 const files=unzipSync(bytes,{filter:file=>{
  const name=file.name.replace(/^(?:[^/]+\/)?(?=music\/)/,'');
  if(!sourcePath.test(name)&&!/^(?:[^/]+\/)?project\.json$/.test(file.name))return false;
  if(names.has(file.name))throw Error('Duplicate project archive entry');names.add(file.name);
  total+=file.originalSize;if(++count>30000||total>PROJECT_LIMIT)throw Error('Project exceeds archive limits');
  return true;
 }});
 const entries=Object.entries(files),sourceRoots=entries.filter(([name])=>/^(?:[^/]+\/)?music\/project\.json$/.test(name));
 let text:string;
 if(sourceRoots.length){
  if(sourceRoots.length!==1||entries.some(([name])=>/^(?:[^/]+\/)?project\.json$/.test(name)&&name!==sourceRoots[0][0]))throw Error('ZIP contains multiple projects');
  const prefix=sourceRoots[0][0].slice(0,-'music/project.json'.length);
  const sources=new Map(entries.map(([name,data])=>[name.slice(prefix.length),strFromU8(data)] as const));
  text=joinSources(sources);
 }else{
  if(entries.length!==1)throw Error('ZIP must contain exactly one project.json');
  text=strFromU8(entries[0][1]);
 }
 readDocument(text);return text;
}
export function emptyProject():Project{return {schema:'shallowgroove-midi-v1',title:'Untitled',timing:{ppqn:480,end_tick:15360,default_tempo_us_per_quarter:500000},global_events:[{tick:0,order:0,kind:'meta',type:88,data:[4,2,24,8]}],tracks:[{id:crypto.randomUUID(),name:'Track 1',user_named:true,midi_channel:1,events:[],gain:1,pan:0,mute:false,solo:false}],automation:[],hardwareMappings:[]};}
export type ProjectRecord={id:string;name:string;updated:number;location:'browser'|'folder';path?:string};
export type ProjectDraft={text:string;id:string|null;name:string;source:'example'|'new'|'saved'|'import';baseline:string;updated:number};
export interface ProjectStorage {
 list():Promise<ProjectRecord[]>;
 read(id:string):Promise<{record:ProjectRecord;text:string}>;
 save(text:string,name:string,id:string|null):Promise<ProjectRecord|null>;
 draft(value?:ProjectDraft|null):Promise<ProjectDraft|null>;
 open?():Promise<{record:ProjectRecord;text:string}|null>;
}
