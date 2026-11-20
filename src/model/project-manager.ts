import {documentFingerprint,namedDocument,readDocument,type ProjectDraft,type ProjectRecord,type ProjectStorage} from './project-files.ts';
export type ProjectAdapter={snapshot:()=>string|null;load:(text:string)=>Promise<void>;example:(id:string)=>Promise<void>;create:()=>Promise<void>;pause:()=>void;askName:(name:string)=>Promise<string|null>;askLeave:()=>Promise<'save'|'discard'|'cancel'>};
export type LibraryState={home:boolean;busy:boolean;initialized:boolean;dirty:boolean;id:string|null;name:string;source:ProjectDraft['source'];recent:ProjectRecord[];draft:ProjectDraft|null;status:string;error:string};
export class ProjectManager {
 state:LibraryState={home:true,busy:false,initialized:false,dirty:false,id:null,name:'Untitled',source:'new',recent:[],draft:null,status:'',error:''};
 storage:ProjectStorage;adapter:ProjectAdapter;notify=()=>{};
 private baseline='';private observed='';private draftWrites:Promise<unknown>=Promise.resolve();
 constructor(storage:ProjectStorage,adapter:ProjectAdapter){this.storage=storage;this.adapter=adapter;}
 private update(patch:Partial<LibraryState>={}){this.state={...this.state,...patch};this.notify();}
 async initialize(){try{const [recent,draft]=await Promise.all([this.storage.list(),this.storage.draft()]);if(draft)readDocument(draft.text);this.update({recent,draft,initialized:true});}catch(e){this.update({initialized:true,error:String(e)});}}
 async run(action:()=>Promise<unknown>){if(this.state.busy)return;this.update({busy:true,error:''});try{return await action();}catch(e){this.update({error:String(e)});}finally{this.update({busy:false});}}
 private writeDraft(value:ProjectDraft|null){const next=this.draftWrites.catch(()=>{}).then(()=>this.storage.draft(value));this.draftWrites=next;return next;}
 private lastScan?:{project:object;settings:string};
 async scan(revision?:{project:object;settings:string;fingerprint?:()=>string}){
  if(this.state.home||this.state.busy)return;
  if(revision&&this.observed&&this.lastScan?.project===revision.project&&this.lastScan.settings===revision.settings)return;
  // The live editor already has the decoded session. File inputs still use the validated reader.
  let text:string|null=null;
  let fingerprint=revision?.fingerprint?.();
  if(fingerprint===undefined){text=this.adapter.snapshot();if(!text)return;fingerprint=documentFingerprint(text);}
  this.lastScan=revision;
  const dirty=fingerprint!==this.baseline||this.state.source==='new'||this.state.source==='import';
  if(dirty!==this.state.dirty)this.update({dirty,status:dirty?'unsaved':this.state.id?'opened':this.state.source==='example'?'example':'new'});
  if(fingerprint===this.observed)return;
  if(dirty&&!text){text=this.adapter.snapshot();if(!text)return;}
  this.observed=fingerprint;
  if(dirty&&text){const draft:ProjectDraft={text,id:this.state.id,name:this.state.name,source:this.state.source,baseline:this.baseline,updated:Date.now()};try{await this.writeDraft(draft);this.update({draft});}catch(e){this.observed='';throw e;}}
  else{await this.writeDraft(null);this.update({draft:null});}
 }
 isDirty(){const text=this.state.home?null:this.adapter.snapshot();return !this.state.home&&(this.state.dirty||!!text&&documentFingerprint(text)!==this.baseline);}
 clearError(){this.update({error:''});}
 private async mayLeave(){
  if(this.state.home&&this.state.draft){
   const choice=await this.adapter.askLeave();if(choice==='cancel')return false;if(choice==='discard')return true;
   await this.recover();return this.save();
  }
  if(!this.isDirty())return true;const choice=await this.adapter.askLeave();if(choice==='cancel')return false;if(choice==='save')return this.save();return true;}
 private async installed(source:ProjectDraft['source'],id:string|null,name:string,baseline?:string){
  const text=this.adapter.snapshot();if(!text)throw Error('Audio project is not ready');
  this.baseline=baseline??documentFingerprint(text);this.observed='';
  this.update({home:false,source,id,name,dirty:source==='new'||source==='import'||!!baseline&&documentFingerprint(text)!==baseline,status:source==='example'?'example':source==='new'?'new':'opened'});
  await this.writeDraft(null);this.update({draft:null});
 }
 async save(copy=false){
  const before=this.adapter.snapshot();if(!before||this.state.home)return false;
  let name=this.state.name;
  if(copy||!this.state.id){const answer=await this.adapter.askName(name);if(answer===null)return false;name=answer.trim();if(!name||name.length>200)throw Error('Project name must contain 1–200 characters');}
  const current=this.adapter.snapshot();if(!current)return false;
  const text=namedDocument(current,name),fingerprint=documentFingerprint(text);
  const record=await this.storage.save(text,name,copy?null:this.state.id);if(!record)return false;
  this.baseline=fingerprint;
  const latest=this.adapter.snapshot(),dirty=!!latest&&documentFingerprint(latest)!==fingerprint;
  this.update({id:record.id,name,source:'saved',dirty,status:record.location==='folder'?'saved-folder':'saved-browser'});
  this.observed='';
  // The formal save has succeeded even if refreshing the library/recovery fails.
  try{
   if(dirty&&latest){const draft:ProjectDraft={text:latest,id:record.id,name,source:'saved',baseline:this.baseline,updated:Date.now()};await this.writeDraft(draft);this.update({draft});}
   else{await this.writeDraft(null);this.update({draft:null});}
   this.update({recent:await this.storage.list()});
  }catch(e){this.update({error:`Saved, but recovery/library update failed: ${String(e)}`});}
  return !dirty;
 }
 async openExample(id:string){if(!await this.mayLeave())return;await this.adapter.example(id);const text=this.adapter.snapshot()!;await this.installed('example',null,readDocument(text).session.project.title);}
 async newProject(){if(!await this.mayLeave())return;await this.adapter.create();await this.installed('new',null,'Untitled');}
 async openRecent(id:string){const saved=await this.storage.read(id);readDocument(saved.text);if(!await this.mayLeave())return;await this.adapter.load(saved.text);await this.installed('saved',saved.record.id,saved.record.name);}
 async openFolder(){if(!this.storage.open)return;const saved=await this.storage.open();if(!saved)return;readDocument(saved.text);if(!await this.mayLeave())return;await this.adapter.load(saved.text);await this.installed('saved',saved.record.id,saved.record.name);this.update({recent:await this.storage.list()});}
 async import(text:string){const doc=readDocument(text);if(!await this.mayLeave())return;await this.adapter.load(text);await this.installed('import',null,doc.name);return true;}
 async reloadVersion(text:string){const doc=readDocument(text);await this.adapter.load(text);await this.installed('saved',this.state.id,doc.name);}
 async recover(){const draft=this.state.draft;if(!draft)return;readDocument(draft.text);if(!this.state.home&&!await this.mayLeave())return;await this.adapter.load(draft.text);await this.installed(draft.source,draft.id,draft.name,draft.baseline);await this.writeDraft(draft);this.update({draft,status:'recovered'});}
 async discardDraft(){await this.writeDraft(null);this.update({draft:null});}
 async goHome(){if(this.state.home)return;if(!await this.mayLeave())return;await this.writeDraft(null);this.adapter.pause();this.update({home:true,dirty:false,draft:null,error:''});this.update({recent:await this.storage.list()});}
 async requestClose(){if(this.state.home)return true;if(!await this.mayLeave())return false;await this.writeDraft(null);this.update({dirty:false,home:true});return true;}
}
