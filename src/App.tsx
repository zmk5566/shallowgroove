import {DaisyBellNotes,daisyBellNotes} from './components/DaisyBellNotes';
import {DeepSeekSettings} from './components/DeepSeekSettings';
import {GridMenu} from './components/GridMenu';
import type {Grid,Division} from './model/arrangement-grid';
import {clipCommand,workspaceInventory} from './assistant/clip-workspace';
import {SessionView} from './components/SessionView';
import {createSlotClip,validateScenes,sceneLaunches,sceneRows,type Scene} from './model/scenes';
import {applyClip,clipEditorProject,clipReferenceCount,copyBars,renameClip,replaceClipEvents,validateClips} from './model/clips';
import {ClipMenu,type MenuAction} from './components/ClipMenu';
import {stereoLevel,type StereoLevel} from './audio/stereo-meter';
import {PanelResizeHandle} from './components/PanelResizeHandle';
import {transformNotes} from './model/note-transforms';
import {ArrangementTake} from './model/recording';
import {useMidiKeyboard} from './hooks/useMidiKeyboard';
import {ProjectVersions} from './components/ProjectVersions';
import {ProjectWelcome} from './components/ProjectWelcome';
import {useProjectLibrary} from './hooks/useProjectLibrary';
import {readDocument,namedDocument,zipDocument,unzipDocument,emptyProject,PROJECT_LIMIT,type EditorState} from './model/project-files';
import {TempoControl} from './components/TempoControl';
import {isTempoTarget} from './model/project';
import {bpmAtTick,withTempo,retimePosition,MIN_BPM,MAX_BPM} from './model/tempo';
import {PianoRoll} from './components/PianoRoll';
import {inspectNotes,editNotes,transposeNotes,noteEditBar,type NoteEdit,type NoteTranspose} from './model/notes';
import {version as appVersion} from '../package.json';
import {rememberParameter,type ParameterRef,type ParameterEdit} from './model/parameter-focus';
import {StudioSidebar} from './components/StudioSidebar';
import {useHexblocks} from './hardware/useHexblocks';
import {HexblocksPanel,type MappingDraft,type MappingOption} from './components/HexblocksPanel';
import {validateMappings,mappedValue,hardwareKey,type HardwareMapping} from './model/hardware';
import {declaredPatchName,instrumentName} from './model/patch-name';
import {meterMap,musicalPosition} from './model/meter';
import {AutomationEditor,type AutomationOption} from './components/AutomationEditor';
import {secondsToTick,normalize,validateAutomation,type AutomationLane} from './model/automation';
import {retainEngine} from './audio/engine-lifetime';
import {History,canCapture,capture,hydrate,packFile,describeEdit,type Session} from './model/session';
import {useCallback,useEffect,useEffectEvent,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {AudioEngine,defaultCode,type Control} from './audio/engine';
import {tickToSeconds,type Project,type Track} from './model/project';
import {Assistant,type AssistantContext} from './components/Assistant';
import {finiteRange,resolveChannelTarget,type Selection,type MusicCommand} from './assistant/contracts';
import {executeMusicCommand} from './assistant/controller';
import {WorkspacePanel} from './components/WorkspacePanel';
import {Mixer} from './components/Mixer';
import type {ChannelTarget} from './audio/effects';
import {Arrangement} from './components/Arrangement';
import {TrackInfo} from './components/TrackInfo';
import {localize,type DescriptionFile,type Locale} from './model/descriptions';
import {inspectDevice} from './audio/inspect';
import {EffectsPanel} from './components/EffectsPanel';
import {DevicePanel} from './components/DevicePanel';
import {assignedPatch,periodYear,type SoundSet} from './audio/patch-bank';
const demos=import.meta.glob('../demo-projects/*.json',{import:'default'});
const descriptorFiles=import.meta.glob('../track-descriptions/*.json',{import:'default'});
function clock(seconds:number){return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;}
export default function App(){
 const [grid,setGrid]=useState<Grid>({mode:'auto',triplet:false});
 const [autoGrid,setAutoGrid]=useState<Division>('1 bar');
 const gridUnit=grid.mode==='auto'?autoGrid:grid.mode;
 const [mixerShare,setMixerShare]=useState<number|null>(null);
 const [workspaceView,setWorkspaceView]=useState<'arrangement'|'session'>('arrangement');
 const [slotEditor,setSlotEditor]=useState<{track:string;clip:string|null;scene:string}|null>(null);
 const [focusedRef,setFocusedRef]=useState<string>();
 const [overviewAdjustment,setOverviewAdjustment]=useState(0);
 const [rowSpace,setRowSpace]=useState(800);
 const workspace=useRef<HTMLElement|null>(null);
 const measureWorkspace=useCallback((node:HTMLElement|null)=>{
  workspace.current=node;
  if(!node)return;
  const observer=new ResizeObserver(([entry])=>{const css=getComputedStyle(node);setRowSpace(Math.max(112,entry.contentRect.height-3*parseFloat(css.rowGap)));});
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 const [collapsed,setCollapsed]=useState(()=>{try{const saved=JSON.parse(localStorage.getItem('shallowgroove.panels')??'{}');return {overview:saved?.overview===true,mixer:saved?.mixer===true,devices:saved?.devices===true,notes:saved?.notes===true};}catch{return {overview:false,mixer:false,devices:false,notes:false};}});
 useEffect(()=>{try{localStorage.setItem('shallowgroove.panels',JSON.stringify(collapsed));}catch{}},[collapsed]);
 function togglePanel(panel:keyof typeof collapsed){setOverviewAdjustment(0);setCollapsed(current=>({...current,[panel]:!current[panel]}));}
 const [selectedDevice,setSelectedDevice]=useState('channel');
 const clipRenameDialog=useRef<HTMLDialogElement>(null),clipNameInput=useRef<HTMLInputElement>(null);
 const [renameTarget,setRenameTarget]=useState<{id:string;x:number;y:number}|null>(null);
 const recentParameters=useRef<ParameterEdit[]>([]),parameterDialog=useRef<HTMLDialogElement>(null);
 const [parameterFocus,setParameterFocus]=useState<(ParameterRef&{x:number;y:number})|null>(null);
 const [mappingRequest,setMappingRequest]=useState<{key:string;nonce:number}|null>(null);

 const generation=useRef(crypto.randomUUID());
 const operationBusy=useRef(false);
 const transportRequest=useRef(0);
 const [showInfo,setShowInfo]=useState(false);const [,refreshMixer]=useState(0);
 const [soundSet,setSoundSet]=useState<SoundSet>('period');
 const [locale,setLocale]=useState<Locale>(()=>{try{return localStorage.getItem('shallowgroove.locale')==='en'?'en':'zh-CN';}catch{return 'zh-CN';}});
 const [descriptions,setDescriptions]=useState<DescriptionFile|null>(null);
 useEffect(()=>{void window.shallowgrooveDesktop?.setConnectLocale(locale).catch(error=>console.error('Connect language sync failed',error));},[locale]);
 useEffect(()=>{document.documentElement.lang=locale;try{localStorage.setItem('shallowgroove.locale',locale);}catch{}},[locale]);
 const engine=useRef(new AudioEngine());
 const readTransportPosition=useCallback(()=>engine.current.position,[]);
 const [slug,setSlug]=useState(''),[project,setProject]=useState<Project|null>(null),[selected,setSelected]=useState<ChannelTarget>(0);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[playing,setPlaying]=useState(false),[loop,setLoop]=useState(false);
 const [audioState,setAudioState]=useState('not initialized');
 const [position,setPosition]=useState(0),[levels,setLevels]=useState<StereoLevel[]>([]),[controls,setControls]=useState<Record<number,Control[]>>({}),[values,setValues]=useState<Record<number,Record<string,number>>>({}),[codes,setCodes]=useState<Record<number,string>>({});
 const hexblocks=useHexblocks(async command=>{if(assistantTurn.current||busy)throw Error('Project is busy');const channel=resolveChannelTarget(selected,command.channel,project?.tracks.map(t=>t.id)??[]);return musicCommand({channel,device:command.device??(channel===selected?selectedDevice:'channel')},command,generation.current);});
 const [versionsOpen,setVersionsOpen]=useState(false),[zipHint,setZipHint]=useState(false),[cloneUrl,setCloneUrl]=useState('');
 const cloneDialog=useRef<HTMLDialogElement>(null);
 const versionSource=useRef<{url:string;commit:string}|undefined>(undefined);
 const [sharedChat,setSharedChat]=useState<{role:string;text:string}[]>([]);
 function readableChat(value:unknown){return (Array.isArray(value)?value:[]).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').map(({role,text})=>({role:String(role),text:String(text)}));}
 const transcript=useRef<unknown[]>([]),[includeChat,setIncludeChat]=useState(false);
 const history=useRef(new History()),baseline=useRef<Session|null>(null),[historyOpen,setHistoryOpen]=useState(false),[,renderHistory]=useState(0),[includeHistory,setIncludeHistory]=useState(true);
 const [assistantWorking,setAssistantWorking]=useState(false);
 const historyLock=useRef(false),gesture=useRef(false),assistantTurn=useRef(false),origin=useRef<'user'|'assistant'>('user');const [menuTrack,setMenuTrack]=useState<number|null>(null),[rename,setRename]=useState('');const trackDialog=useRef<HTMLDialogElement>(null);const addDialog=useRef<HTMLDialogElement>(null),[newName,setNewName]=useState(''),importInput=useRef<HTMLInputElement>(null);
 const projectInstance=useRef(crypto.randomUUID());
 const editorState=useRef<EditorState>({exampleId:null,soundSet:'basic',codeDrafts:{}});
 const library=useProjectLibrary({snapshot:projectSnapshot,load:loadDocument,example:loadExample,create:createProject,pause:()=>{engine.current.stop();setPlaying(false);}},locale);
 useLayoutEffect(()=>{
  if(workspaceView!=='session')return;
  const mixer=workspace.current?.querySelector<HTMLElement>('.mixer-tracks');
  const session=workspace.current?.querySelector<HTMLElement>('.session-scroll');
  if(!mixer||!session)return;
  let offset=mixer.clientWidth?mixer.scrollLeft:session.scrollLeft;
  function align(el:HTMLElement){
   if(el.clientWidth&&Math.abs(el.scrollLeft-offset)>.5)el.scrollLeft=offset;
  }
  function sync(event:Event){
   const source=event.currentTarget as HTMLElement;
   if(!source.clientWidth)return;
   offset=source.scrollLeft;align(source===mixer?session!:mixer!);
  }
  const observer=new ResizeObserver(()=>{
   const visible=mixer.clientWidth?mixer:session;
   if(visible.clientWidth)offset=Math.min(offset,visible.scrollWidth-visible.clientWidth);
   align(mixer);align(session);
  });
  align(session);
  for(const el of [mixer,session]){observer.observe(el);el.addEventListener('scroll',sync,{passive:true});}
  return()=>{observer.disconnect();for(const el of [mixer,session])el.removeEventListener('scroll',sync);};
 },[workspaceView,library.state.home]);

 const libraryBusy=library.state.busy;
 function projectSnapshot(exportChat=false){
  const current=engine.current;if(!current.project||!canCapture(current,current.project))return null;
  const session=capture(current,current.project),h=history.current;
  const expected=h.cursor?h.entries[h.cursor-1]?.after:h.entries[0]?.before;
  const savedHistory=includeHistory&&(!expected||JSON.stringify(expected)===JSON.stringify(session))?h:undefined;
  return JSON.stringify({...packFile(session,savedHistory,exportChat&&includeChat?readableChat(transcript.current):undefined),...(versionSource.current?{versionSource:versionSource.current}:{}),...(!exportChat&&sharedChat.length?{sharedConversation:sharedChat}:{}),editor:snapshotEditor(session)});
 }
 function snapshotEditor(session:Session){
  const ids=new Set(session.project.tracks.map(t=>t.id));
  return {...editorState.current,codeDrafts:Object.fromEntries(Object.entries(editorState.current.codeDrafts).filter(([id])=>ids.has(id))),effectDrafts:Object.fromEntries(Object.entries(editorState.current.effectDrafts??{}).filter(([id])=>session.chains.some(chain=>chain.some(fx=>fx.id===id))))};
 }
 async function installProject(replacement:AudioEngine,metadata:EditorState,description:DescriptionFile|null){
  take.current=null;armIntent.current=false;waitingForInput.current=false;setRecordArmed(false);setRecordNotice(null);setRecording(false);setArmed(null);latchedInputs.current.clear();replacement.setMetronome(click);versionSource.current=undefined;setZipHint(false);setIncludeChat(false);setSharedChat([]);const previous=engine.current;previous.pause();engine.current=replacement;editorState.current=structuredClone(metadata);
  editorState.current.conversationProject??=metadata.exampleId?'example:'+metadata.exampleId:'track:'+(replacement.project?.tracks[0]?.id??crypto.randomUUID());
  setProject(replacement.project!);setReady(true);setSelected(replacement.project!.tracks.length?0:'master');setSelectedDevice('channel');setSlug(metadata.exampleId??'');setSoundSet(metadata.soundSet);setDescriptions(description);
  setCodes(Object.fromEntries(replacement.voices.map((v,i)=>[i,metadata.codeDrafts[replacement.project!.tracks[i].id]??v.code])));
  setControls(Object.fromEntries(replacement.voices.map((v,i)=>[i,replacement.describe(v.node)])));setValues(Object.fromEntries(replacement.voices.map((v,i)=>[i,{...v.values}])));
  baseline.current=capture(replacement,replacement.project!);generation.current=crypto.randomUUID();projectInstance.current=crypto.randomUUID();setEnvelopes(new Map());setFocusedRef(undefined);setWorkspaceView('arrangement');setSlotEditor(null);recentParameters.current=[];transcript.current=[];setLoop(false);setPlaying(false);setPosition(0);setError('');renderHistory(n=>n+1);
  await previous.dispose().catch(e=>console.warn('Old audio engine cleanup failed',e));
 }
 async function loadDocument(text:string){
  const data=readDocument(text),replacement=new AudioEngine();
  try{
   await hydrate(replacement,data.session,false);
   const loadDescription=descriptorFiles[`../track-descriptions/${data.editor.exampleId}.json`];
   const description=await loadDescription?.().catch(()=>null);
   await installProject(replacement,data.editor,(description??null) as DescriptionFile|null);const raw=JSON.parse(text);const source=raw.versionSource;
   if(typeof source?.url==='string'&&/^https:\/\//.test(source.url)&&/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(source.commit))versionSource.current={url:source.url,commit:source.commit};
   setSharedChat(readableChat(raw.conversation??raw.sharedConversation));history.current=data.history;renderHistory(n=>n+1);
  }catch(e){if(engine.current!==replacement)await replacement.dispose();throw e;}
 }
 async function loadExample(id:string){
  const loader=demos[`../demo-projects/${id}.json`];if(!loader)throw Error('Unknown example');
  const replacement=new AudioEngine();
  try{const [data,description]=await Promise.all([loader(),descriptorFiles[`../track-descriptions/${id}.json`]()]);const preset=periodYear(id)?'period':'basic';await replacement.initialize(structuredClone(data as Project),preset,id,false);await installProject(replacement,{conversationProject:crypto.randomUUID(),exampleId:id,soundSet:preset,codeDrafts:{}},description as DescriptionFile);history.current=new History();}
  catch(e){if(engine.current!==replacement)await replacement.dispose();throw e;}
 }
 async function createProject(){
  const replacement=new AudioEngine();try{await replacement.initialize(emptyProject(),'basic','',false);await installProject(replacement,{exampleId:null,soundSet:'basic',codeDrafts:{}},null);history.current=new History();}catch(e){if(engine.current!==replacement)await replacement.dispose();throw e;}
 }
 function projectAction(action:()=>Promise<unknown>){if(busy||operationBusy.current||assistantTurn.current||historyLock.current)return;cancelCount();finishTake();checkpoint();void library.manager.run(action);}
 const scanProjects=useEffectEvent(()=>{
  const current=engine.current,p=current.project;
  if(library.manager.state.home||library.manager.state.busy||busy||assistantTurn.current||historyLock.current||gesture.current||!p||!canCapture(current,p))return;
  // MIDI edits replace the project. Rack parameters and editor drafts also change in place.
  const session=capture(current,p),{project:reference,...rack}=session;
  void library.manager.scan({project:reference,settings:JSON.stringify([rack,editorState.current]),fingerprint:()=>JSON.stringify({session,editor:snapshotEditor(session)})}).catch(e=>setError(String(e)));
 });
 useEffect(()=>{const timer=setInterval(()=>scanProjects(),700);return()=>clearInterval(timer);},[]);
 const fileAction=useEffectEvent((action:string)=>{if(versionsOpen)return;projectAction(async()=>{if(action==='save')await library.manager.save();else if(action==='save-as')await library.manager.save(true);else if(action==='home')await library.manager.goHome();else if(action==='close'&&await library.manager.requestClose())window.shallowgrooveDesktop?.projectAllowClose();});});
 useEffect(()=>{
  const onKey=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'&&!e.altKey&&!e.isComposing){e.preventDefault();if(!e.repeat)fileAction(e.shiftKey?'save-as':'save');}};
  const onUnload=(e:BeforeUnloadEvent)=>{if(library.manager.isDirty()||library.manager.state.busy){e.preventDefault();e.returnValue='';}};
  window.addEventListener('keydown',onKey);window.addEventListener('beforeunload',onUnload);
  const unsubscribe=window.shallowgrooveDesktop?.onProjectAction(action=>fileAction(action));
  return()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('beforeunload',onUnload);unsubscribe?.();};
 },[library.manager]);
 useEffect(()=>{window.shallowgrooveDesktop?.projectDirty(library.state.dirty||library.state.busy||busy);},[library.state.dirty,library.state.busy,busy]);

 function checkpoint(label?:string,force=false){
  if(!ready||!project||historyLock.current||busy||gesture.current||(assistantTurn.current&&!force))return;
  if(!canCapture(engine.current,project))return;
  const current=capture(engine.current,project);if(baseline.current?.project===project&&JSON.stringify({...baseline.current,project:null})===JSON.stringify({...current,project:null}))return;if(baseline.current)history.current.push(baseline.current,current,label??describeEdit(baseline.current,current),assistantTurn.current?'assistant':origin.current);baseline.current=current;origin.current='user';renderHistory(n=>n+1);
 }
 const pollHistory=useEffectEvent(()=>checkpoint());
 useEffect(()=>{const messages=(e:Event)=>{transcript.current=(e as CustomEvent<unknown[]>).detail;};window.addEventListener('shallowgroove-transcript',messages);const timer=setInterval(()=>pollHistory(),700);const down=()=>{gesture.current=true;};const up=()=>{gesture.current=false;setTimeout(()=>pollHistory(),0);};const start=()=>{pollHistory();assistantTurn.current=true;setAssistantWorking(true);origin.current='assistant';};const end=()=>{assistantTurn.current=false;setAssistantWorking(false);origin.current='assistant';};window.addEventListener('pointerdown',down);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('blur',up);window.addEventListener('shallowgroove-turn-start',start);window.addEventListener('shallowgroove-turn-end',end);return()=>{window.removeEventListener('shallowgroove-transcript',messages);clearInterval(timer);window.removeEventListener('pointerdown',down);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('blur',up);window.removeEventListener('shallowgroove-turn-start',start);window.removeEventListener('shallowgroove-turn-end',end);};},[]);
 async function restore(next:Session,selection:ChannelTarget='master',preserveTick=false){
  const replacement=new AudioEngine(),old=engine.current;historyLock.current=true;setBusy(true);setError('');
  try{await hydrate(replacement,next);replacement.configureLoop(old.loop,old.loopRange);replacement.seek(preserveTick&&old.project?retimePosition(old.timingProject??old.project,next.project,old.position):old.position);if(old.playing){
   const slots=old.currentLaunches().flatMap(s=>{
    const track=next.project.tracks.findIndex(t=>t.id===old.project?.tracks[s.track]?.id);
    return track>=0?[{track,launch:s.launch}]:[];
   });
   await replacement.play({resume:true,slots});
  }old.pause();replacement.setMetronome(click);engine.current=replacement;setProject(replacement.project!);setReady(true);setSelected(selection);setSelectedDevice('channel');setCodes(Object.fromEntries(replacement.voices.map((v,i)=>[i,editorState.current.codeDrafts[replacement.project!.tracks[i].id]??v.code])));setControls(Object.fromEntries(replacement.voices.map((v,i)=>[i,replacement.describe(v.node)])));setValues(Object.fromEntries(replacement.voices.map((v,i)=>[i,{...v.values}])));baseline.current=capture(replacement,replacement.project!);await old.dispose();}
  catch(e){await replacement.dispose();throw e;}finally{historyLock.current=false;setBusy(false);}
 }
 async function travel(direction:number,fromAssistant=false){
  if(take.current)return {changed:false};
  if(library.manager.state.home||library.manager.state.busy||busy||(!fromAssistant&&assistantTurn.current)||historyLock.current)throw Error('Project is busy');checkpoint(undefined,fromAssistant);
  const h=history.current,entry=h.entries[direction<0?h.cursor-1:h.cursor];if(!entry)return {changed:false,history:{undo:h.cursor,redo:h.entries.length-h.cursor}};
  try{const target=direction<0?entry.before:entry.after,channel:ChannelTarget=typeof selected==='number'&&selected<target.project.tracks.length?selected:'master';await restore(target,channel,true);h.cursor+=direction;if(!fromAssistant)generation.current=crypto.randomUUID();renderHistory(n=>n+1);return {changed:true,selection:{channel,device:'channel'},history:{undo:h.cursor,redo:h.entries.length-h.cursor}};}
  catch(e){setError(String(e));if(fromAssistant)throw e;return {changed:false};}
 }

 const undoKeyboard=useEffectEvent((redo:boolean)=>{void travel(redo?1:-1);});
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='z'||e.isComposing||e.altKey)return;const t=e.target;if(t instanceof HTMLElement&&(t.isContentEditable||t.closest('input:not([type=range]):not([type=checkbox]),textarea,select,dialog')))return;e.preventDefault();if(!e.repeat)undoKeyboard(e.shiftKey);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 function download(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function exportProject(){
  checkpoint();const text=projectSnapshot(true);if(!text)return;
  const doc=JSON.parse(text);
  if(window.shallowgrooveDesktop&&library.state.id){
   try{const {state}=await window.shallowgrooveDesktop.projectVersion(library.state.id,{action:'status'});if(state){delete doc.versionSource;if(state.remote)doc.versionSource={url:state.remote,commit:state.head};}}
   catch{delete doc.versionSource;}
  }
  if(doc.editor)delete doc.editor.conversationProject;
  const bytes=zipDocument(namedDocument(JSON.stringify(doc),library.state.name)),url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:'application/zip'}));
  const a=document.createElement('a');a.href=url;a.download=`${library.state.name.replace(/[<>:"/\\|?*]/g,'_')}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function importProject(file:File){
  cancelCount();
  finishTake();
  if(file.size>PROJECT_LIMIT){setError('Project exceeds 100 MB');return;}
  await library.manager.run(async()=>{const text=file.name.toLowerCase().endsWith('.zip')?unzipDocument(new Uint8Array(await file.arrayBuffer())):await file.text();const doc=JSON.parse(text);doc.editor={...readDocument(text).editor,conversationProject:crypto.randomUUID()};
   if(await library.manager.import(JSON.stringify(doc))&&file.name.toLowerCase().endsWith('.zip'))setZipHint(true);});
 }

 async function trackAction(action:string,index?:number,name?:string,source:'user'|'assistant'='user'){
  if((source==='user'&&assistantTurn.current)||busy||historyLock.current)throw Error('Project is busy');if(!project)throw Error('No project');
  if(action==='delete_track'&&(index===undefined||!project.tracks[index]))throw Error('Select a MIDI track');
  const confirmationStarted=Date.now();
  if(action==='delete_track'&&!window.confirm(`${locale==='zh-CN'?'确认删除轨道及其 MIDI、乐器和效果链？可撤销。':'Delete this track, MIDI, instrument and effects? This can be undone.'}\n${project.tracks[index!].name}`))return {cancelled:true};
  if(source==='assistant'&&Date.now()-confirmationStarted>80000)throw Error('Confirmation expired; no track was deleted.');
  checkpoint();if(!ready)await initializeAudio();const before=capture(engine.current,engine.current.project!),next=structuredClone(before);let target:ChannelTarget=index??'master';
  if(action==='rename_track'){if(index===undefined||!next.project.tracks[index])throw Error('Select a MIDI track');if(!name?.trim())throw Error('Provide a track name');next.project.tracks[index].name=name.trim();next.project.tracks[index].user_named=true;}
  else if(action==='delete_track'){if(next.project.scenes)next.project.scenes=next.project.scenes.map(s=>({...s,slots:s.slots.filter(slot=>slot.trackId!==next.project.tracks[index!].id)}));next.project.automation=next.project.automation?.filter(l=>l.trackId!==next.project.tracks[index!].id);next.project.tracks.splice(index!,1);next.voices.splice(index!,1);next.chains.splice(index!,1);next.sends.splice(index!,1);target=next.project.tracks.length?Math.min(index!,next.project.tracks.length-1):'master';}
  else {if(next.project.tracks.length>=64)throw Error('Track limit: 64');const duplicate=action==='duplicate_track';if(duplicate&&(index===undefined||!next.project.tracks[index]))throw Error('Select a MIDI track');const track=duplicate?structuredClone(next.project.tracks[index!]):{id:'',name:'',user_named:true,midi_channel:1,events:[],gain:1,pan:0,mute:false,solo:false};if(duplicate&&track.clipRefs?.length){
   const ids=new Map(track.clipRefs.map(r=>[r.id,crypto.randomUUID()]));
   track.clipRefs=track.clipRefs.map(r=>({...r,id:ids.get(r.id)!}));
   track.events=track.events.map(e=>e.clipRef?{...e,clipRef:ids.get(e.clipRef)!}:e);
  }track.user_named=true;track.id=crypto.randomUUID();track.name=name?.trim()||(duplicate?track.name+' copy':'New track');target=next.project.tracks.length;next.project.tracks.push(track);next.voices.push(duplicate?structuredClone(next.voices[index!]):{code:defaultCode,values:{},trim:1,basePan:0});next.chains.splice(target,0,duplicate?next.chains[index!].map(f=>({...structuredClone(f),id:crypto.randomUUID()})):[]);next.sends.push(duplicate?{...next.sends[index!]}:{delay:0,reverb:0});if(duplicate){const original=before.project.tracks[index!].id;next.project.automation=[...(next.project.automation??[]),...(before.project.automation??[]).filter(l=>l.trackId===original).map(l=>({...structuredClone(l),id:crypto.randomUUID(),trackId:track.id,device:['instrument','mixer'].includes(l.device)?l.device:next.chains[target as number].find((_,i)=>before.chains[index!][i].id===l.device)?.id??l.device}))];}}
  await restore(next,target);history.current.push(before,next,`${({add_track:'添加轨道 / Add track',delete_track:'删除轨道 / Delete track',duplicate_track:'复制轨道 / Duplicate track',rename_track:'重命名 / Rename'} as Record<string,string>)[action]} · ${name??before.project.tracks[index??-1]?.name??'New track'}`,source);baseline.current=capture(engine.current,engine.current.project!);renderHistory(n=>n+1);return {selection:{channel:target,device:'channel'},trackCount:next.project.tracks.length};
 }
 function commitMappings(mappings:HardwareMapping[]){if(!project||busy)throw Error('Project is busy');validateMappings(mappings);const next={...project,hardwareMappings:mappings};setProject(next);engine.current.project=next;}
 function removeMapping(id:string){if(!project?.hardwareMappings?.some(m=>m.id===id))throw Error('Mapping no longer exists');commitMappings(project.hardwareMappings.filter(m=>m.id!==id));}
 function targetForMapping(m:HardwareMapping){if(!ready)return false;const target=engine.current.automationTarget(m as unknown as AutomationLane);return !!target&&(!!target.param||isTempoTarget(m))&&m.outputMin>=target.control.min&&m.outputMax<=target.control.max;}
 function mapHardware(draft:MappingDraft,channel:ChannelTarget=selected,id?:string){
  if(!ready||!project||busy)throw Error('Wait for audio preparation');if(draft.trackId)channel=resolveChannelTarget(selected,draft.trackId,project.tracks.map(t=>t.id));const mod=hexblocks.live.current.connectors.find(c=>c.id===draft.connectorId&&c.transport.connected)?.modules.find(m=>m.uid===draft.uid);
  if(!mod||!(mod.descriptor?.channels?.some(c=>c.id===draft.sensorChannel)||mod.channels[draft.sensorChannel]))throw Error('Choose an available hardware channel from inspect_hardware');
  const option=automationOptions(channel).find(o=>o.valid&&o.lane.device===draft.device&&o.lane.address===draft.address);if(!option)throw Error('Select an existing parameter target');
  if(draft.outputMin<option.lane.min||draft.outputMax>option.lane.max)throw Error('Output range exceeds the parameter bounds');
  const mapping:HardwareMapping={...draft,id:id??crypto.randomUUID(),channel:draft.sensorChannel,trackId:option.lane.trackId,label:option.lane.label,enabled:true};
  commitMappings([...(project.hardwareMappings??[]).filter(m=>m.id!==mapping.id),mapping]);hexblocks.subscribe(mapping.connectorId,mapping.uid,mapping.channel);selectContext({channel,device:draft.device==='mixer'?'channel':draft.device});return mapping;
 }
 const [armed,setArmed]=useState<string|null>(null),[recording,setRecording]=useState(false),[click,setClick]=useState(false);
 const [recordArmed,setRecordArmed]=useState(false),armIntent=useRef(false),waitingForInput=useRef(false);
 const [recordNotice,setRecordNotice]=useState<{text:string}|null>(null);
 function notifyRecording(text:string){setRecordNotice({text});}
 useEffect(()=>{if(!recordNotice)return;const timer=setTimeout(()=>setRecordNotice(null),3200);return()=>clearTimeout(timer);},[recordNotice]);
 const [countBars,setCountBars]=useState(()=>{try{const n=Number(localStorage.getItem('shallowgroove.countInBars'));return [1,2,4].includes(n)?n:0;}catch{return 0;}});
 const [countLabel,setCountLabel]=useState(''),countRequest=useRef<AbortController|null>(null);
 const midiDialog=useRef<HTMLDialogElement>(null),[midiIssue,setMidiIssue]=useState(''),[midiLoading,setMidiLoading]=useState(false);
 function cancelCount(){countRequest.current?.abort();countRequest.current=null;setCountLabel('');}
 useEffect(()=>()=>countRequest.current?.abort(),[]);
 const take=useRef<ArrangementTake|null>(null),latchedInputs=useRef(new Map<string,number>());
 function currentTick(){const e=engine.current,p=e.timingProject??e.project;return p?Math.round(secondsToTick(p,e.position)):0;}
 function finishTake(end=currentTick()){
  waitingForInput.current=false;const active=take.current,e=engine.current,p=e.project;if(!active||!p)return;
  const tick=Math.min(p.timing.end_tick,Math.max(active.lastTick,end));
  const held=[...active.held.values()],pedals=[...active.pedals.values()];
  const next=active.finish(p,tick);if(active.warning)notifyRecording(active.warning);
  take.current=null;setRecording(false);
  for(const {track,pitch,count} of held){const i=p.tracks.findIndex(t=>t.id===track.id);for(let n=0;n<count;n++)e.monitorMidi(i,[128+track.midi_channel-1,pitch,0]);}
  for(const track of pedals)e.monitorMidi(p.tracks.findIndex(t=>t.id===track.id),[176+track.midi_channel-1,64,0]);
  for(const [key,entry] of active.envelopes){
   const applied=hardwareApplied.current.get(key);if(applied)latchedInputs.current.set(key,applied.input);
   e.releaseHardware(key);e.automationOverrides.delete(entry.lane.id);
  }
  if(next===p)return;
  const before=capture(e,p);e.setAutomationProject(next);e.setClipProject(next);setProject(next);
  const after=capture(e,next);history.current.push(before,after,'录制 / Record','user');baseline.current=after;renderHistory(n=>n+1);
 }
 function recordingTick(){
  const active=take.current;if(!active)return null;
  const e=engine.current,tick=currentTick();
  if(!e.playing||tick<active.lastTick){finishTake(e.loop?(e.loopRange?.end??e.project!.timing.end_tick):tick);return null;}
  active.lastTick=tick;return tick;
 }
 function silenceInput(){
  const e=engine.current,i=e.project?.tracks.findIndex(t=>t.id===armed)??-1;
  if(i>=0){e.monitorMidi(i,[176+e.project!.tracks[i].midi_channel-1,64,0]);e.voices[i]?.node.allNotesOff(true);}
 }
 const midi=useMidiKeyboard(data=>{
  const e=engine.current,i=e.project?.tracks.findIndex(t=>t.id===armed)??-1;
  if(i<0||busy||library.manager.state.home||library.manager.state.busy||!ready||data.length!==3||![8,9,11,14].includes(data[0]>>4))return;
  if(waitingForInput.current&&e.playing)beginTake();
  const track=e.project!.tracks[i],tick=recordingTick();
  e.monitorMidi(i,[(data[0]&240)+track.midi_channel-1,...data.slice(1)]);
  if(tick!==null&&take.current){if(take.current.canAppend(track))take.current.midi(track,data,tick);
   else{finishTake(tick);notifyRecording('轨道 MIDI 事件已满，录制已结束 / Track MIDI capacity reached. Take saved.');}}
 },()=>{finishTake();silenceInput();},notifyRecording);
 async function armTrack(id:string){
  if(take.current)return;silenceInput();
  if(armed===id){setArmed(null);return;}
  try{await midi.connect();await engine.current.resumeAudio();setArmed(id);}catch(error){notifyRecording(String(error));}
 }
 function beginTake(){
  if(!armIntent.current||take.current||!engine.current.playing)return;
  waitingForInput.current=false;latchedInputs.current.clear();take.current=new ArrangementTake(currentTick());setRecording(true);
 }
 function missingInput(){
  if(project?.hardwareMappings?.some(m=>m.enabled))return '';
  if(!project?.tracks.some(t=>t.id===armed))return locale==='zh-CN'?'请点轨道上的 ● 选择 MIDI 录制轨，或启用 HexBlocks 参数绑定。':'Arm a MIDI track or enable a HexBlocks mapping.';
  return midi.devices.some(d=>midi.enabled(d.id))?'':locale==='zh-CN'?'请连接键盘并启用 MIDI 输入。':'Connect and enable a MIDI input.';
 }
 function startArmedTake(){
  if(!armIntent.current||workspaceView!=='arrangement'||!engine.current.playing||take.current)return;
  const missing=missingInput();
  if(missing){waitingForInput.current=true;notifyRecording(missing);}else beginTake();
 }
 function toggleRecord(){
  if(!project||!ready||busy||assistantTurn.current)return;
  const enabled=!armIntent.current;armIntent.current=enabled;setRecordArmed(enabled);
  if(!enabled){finishTake();setRecordNotice(null);return;}
  checkpoint();
  if(engine.current.playing){startArmedTake();return;}
  notifyRecording(missingInput()||(locale==='zh-CN'?'录制已就绪，按播放开始。':'Recording armed. Press Play to start.'));
 }
 const hardwareSubscriptions=useRef(new Map<string,number>());
 const hardwareApplied=useRef(new Map<string,{signature:string;input:number;engine:AudioEngine}>());
 const applyHardwareFrame=useEffectEvent(()=>{
  const keep=new Set<string>(),tick=recordingTick();
  if(ready&&!busy&&!library.manager.state.home&&!library.manager.state.busy&&!historyLock.current&&hexblocks.live.current.active){for(const m of project?.hardwareMappings??[]){if(!m.enabled)continue;const connector=hexblocks.live.current.connectors.find(c=>c.id===m.connectorId&&c.transport.connected),mod=connector?.modules.find(d=>d.uid===m.uid),sample=mod?.channels[m.channel];if(!mod)continue;
   const key=hardwareKey(m);if(!targetForMapping(m))continue;
   const previous=hardwareApplied.current.get(key);if((!previous||previous.engine!==engine.current)&&Date.now()-(hardwareSubscriptions.current.get(key)??0)>2000){hexblocks.subscribe(m.connectorId,m.uid,m.channel);hardwareSubscriptions.current.set(key,Date.now());}
   if(!sample)continue;
   if(waitingForInput.current&&engine.current.playing)beginTake();
   if(latchedInputs.current.get(key)===sample.value&&!take.current)continue;
   latchedInputs.current.delete(key);const signature=JSON.stringify(m);keep.add(key);
   {
    if(engine.current.applyHardware(m,mappedValue(m,sample.value))){
     hardwareApplied.current.set(key,{signature,input:sample.value,engine:engine.current});
     const active=take.current;
     if(active&&tick!==null){
      const lane=active.envelopes.get(key)?.lane??parameterIdentity(m)?.option.lane;
      const value=engine.current.hardwareValues.get(key)?.value;
      if(lane&&value!==undefined)active.sample(key,lane,tick,value);
     }
    }else keep.delete(key);
   }
  }}
  for(const key of engine.current.hardwareValues.keys())if(!keep.has(key)){engine.current.releaseHardware(key);hardwareApplied.current.delete(key);}
 });
 useEffect(()=>{const timer=setInterval(()=>applyHardwareFrame(),33);return()=>clearInterval(timer);},[]);
 function trackMenu(index:number){if(busy||assistantTurn.current)return;selectChannel(index);setMenuTrack(index);setRename(project!.tracks[index].name);trackDialog.current?.showModal();}
 function menuAction(action:string){trackDialog.current?.close();if(menuTrack!==null)void trackAction(action,menuTrack,action==='rename_track'?rename:undefined).catch(e=>setError(String(e)));}
 useEffect(()=>{if(typeof selected==='number'){document.querySelector(`[data-track="${selected}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});document.querySelector(`[data-channel="${selected}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});}},[selected,project?.tracks.length]);

 useEffect(()=>{const release=retainEngine(engine);const timer=window.setInterval(()=>{const e=engine.current;setPlaying(e.playing);setPosition(e.position);setAudioState(e.context?.state??'not initialized');if(e.lastError){setError(e.lastError);e.lastError='';}const next=e.voices.map(v=>stereoLevel(v.pan));setLevels(old=>old.length===next.length&&next.every(([l,r],i)=>l===old[i][0]&&r===old[i][1])?old:next);},80);return()=>{clearInterval(timer);release();};},[]);
 async function initializeAudio(source:Project|null=project,activate=true,preset:SoundSet=soundSet){
  if(!source)throw Error('No project loaded');
  setBusy(true);setError('');
  try{await engine.current.initialize(source,preset,slug,activate);setReady(true);baseline.current=capture(engine.current,source);setControls(Object.fromEntries(source.tracks.map((_,i)=>[i,engine.current.describe(engine.current.voices[i].node)])));}
  finally{setBusy(false);}
 }
 async function ensurePlayable(){
  if(ready&&canCapture(engine.current,engine.current.project))return;
  if(ready&&baseline.current&&project===baseline.current.project){
   await restore(baseline.current,selected);
  }else await initializeAudio();
 }
 function pausePlayback(){cancelCount();finishTake();transportRequest.current++;engine.current.pause();setPlaying(false);setPosition(engine.current.position);}
 function stopPlayback(){if(countRequest.current){pausePlayback();return;}finishTake();transportRequest.current++;engine.current.stop();setPlaying(false);setPosition(engine.current.position);}
 function seek(seconds:number){if(!project||busy)return;if(countRequest.current){cancelCount();transportRequest.current++;}finishTake();engine.current.seek(seconds,tickToSeconds(engine.current.timingProject??project,project.timing.end_tick));setPosition(engine.current.position);setPlaying(engine.current.playing);}
 async function startTransport(withCount:boolean){
  const e=engine.current;
  if(e.playing)return;
  const rows=project&&workspaceView==='session'?sceneRows(project):[];
  const scene=rows.find(row=>row.id===slotEditor?.scene)??rows[0];
  const slots=scene&&project&&!e.currentLaunches().length?sceneLaunches(project,scene):undefined;
  if(!withCount||!countBars){await e.play({slots});startArmedTake();return;}
  const request=new AbortController();countRequest.current=request;setCountLabel('…');
  try{
   await e.countIn(countBars,request.signal,setCountLabel);
   if(!request.signal.aborted&&engine.current===e){await e.play({lead:0,slots});startArmedTake();}
  }finally{if(countRequest.current===request){countRequest.current=null;setCountLabel('');}}
 }
 async function play(){
  if(library.manager.state.home||library.manager.state.busy||!project||busy||operationBusy.current)return;
  if(engine.current.playing)return;
  operationBusy.current=true;const request=++transportRequest.current,expectedGeneration=generation.current;
  setError('');
  try{
   await ensurePlayable();
   if(request!==transportRequest.current||expectedGeneration!==generation.current)return;
   await startTransport(armIntent.current&&workspaceView==='arrangement'||engine.current.metronome);setPlaying(engine.current.playing);
  }catch(e){setError(String(e));}finally{operationBusy.current=false;}
 }
 const togglePlaybackFromKeyboard=useEffectEvent(()=>{if(countRequest.current){pausePlayback();return;}if(library.manager.state.home||library.manager.state.busy||!project||busy||operationBusy.current)return;if(engine.current.playing)pausePlayback();else void play();});
 useEffect(()=>{
  function keydown(e:KeyboardEvent){
   if(e.code!=='Space'||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||e.defaultPrevented)return;
   const target=e.target;
   if(target instanceof HTMLElement&&(target.isContentEditable||target.closest('input,textarea,select,dialog,[role="textbox"]')))return;
   e.preventDefault(); // Prevent scrolling and the focused button's native click.
   if(!e.repeat)void togglePlaybackFromKeyboard();
  }
  window.addEventListener('keydown',keydown);
  return()=>window.removeEventListener('keydown',keydown);
 },[]);
 function change(index:number,patch:Partial<Track>){if(!project)return;selectChannel(index);for(const key of ['gain','pan'] as const)if(patch[key]!==undefined)engine.current.overrideAutomation(project.tracks[index].id,'mixer',key);const next={...project,tracks:project.tracks.map((t,i)=>i===index?{...t,...patch}:t)};setProject(next);if(ready)engine.current.updateMix(next);}
 async function compile(){if(typeof selected!=='number')return;setBusy(true);setError('');try{const descriptors=await engine.current.replaceInstrument(selected,codes[selected]??assignedPatch(slug,project!.tracks[selected].id,soundSet).code);delete editorState.current.codeDrafts[project!.tracks[selected].id];setControls(s=>({...s,[selected]:descriptors}));setValues(s=>({...s,[selected]:{}}));}catch(e){setError(String(e));}finally{setBusy(false);}}
 function parameter(path:string,value:number){if(typeof selected!=='number')return;setSelectedDevice('instrument');engine.current.setParameter(selected,path,value);setValues(s=>({...s,[selected]:{...s[selected],[path]:value}}));}
 function selectChannel(channel:ChannelTarget){setSelected(channel);setSelectedDevice('channel');}
 function selectContext(selection:Selection){setSelected(selection.channel);setSelectedDevice(selection.device);}
 const inventory=useMemo(()=>project?workspaceInventory(project):null,[project]);
 function describeSelection(selection:Selection) {
  const channel=selection.channel,track=typeof channel==='number'?project?.tracks[channel]:undefined;
  const assignment=track?assignedPatch(slug,track.id,soundSet):undefined;
  const rack=ready?engine.current.effects?.chain(channel):undefined;
  const selectedEffect=rack?.effects.find(d=>d.id===selection.device);
  const voice=ready&&typeof channel==='number'?engine.current.voices[channel]:undefined;
  const currentInstrumentName=assignment?instrumentName(voice?.code??assignment.code,assignment.code,localize(assignment.patch?.name,locale,'Basic Faust synth'),locale==='zh-CN'?'自定义 Faust 音色':'Custom Faust instrument'):undefined;
  const description=descriptions?.tracks.find(d=>d.id===track?.id);
  const channelName=track?`CH ${Number(channel)+1} · ${track.user_named?track.name:localize(description?.name,locale,track.name)}`:channel==='master'?'Master':channel==='delay'?'A · Delay':'B · Reverb';
  const label=`${channelName}${selection.device==='channel'?'':selection.device==='instrument'?` / ${currentInstrumentName}`:` / ${selectedEffect?(declaredPatchName(selectedEffect.code)??selectedEffect.kind):'Removed patch'}`}`;
  return {label,channel,track,assignment,rack,selectedEffect,voice,currentInstrumentName,description};
 }
 function snapshot(selection:Selection):AssistantContext {
  const {label,channel,track,assignment,rack,selectedEffect,voice,currentInstrumentName,description}=describeSelection(selection);
  const originalInstrument=!voice||voice.code===assignment?.code;
  const activePatch=selectedEffect?{name:declaredPatchName(selectedEffect.code)??selectedEffect.kind,kind:selectedEffect.kind,code:selectedEffect.code,controls:selectedEffect.controls,values:selectedEffect.values,bypassed:selectedEffect.bypassed,wetOnly:selectedEffect.wetOnly}:track?{name:currentInstrumentName,kind:'instrument',code:voice?.code??assignment?.code,compiled:!!voice,controls:voice?engine.current.describe(voice.node):[],values:voice?Object.fromEntries(engine.current.describe(voice.node).map(c=>[c.address,voice.values[c.address]??c.init])):{},sources:originalInstrument?assignment?.sources:undefined,reference:originalInstrument?(assignment?.patch??descriptions?.faust_instruments['shallow-synth-v1']):undefined}:null;
  const shown=workspaceView==='arrangement'&&automationOpen&&!collapsed.overview?(automationOptions(selected).find(o=>o.key===automationChoice)??automationOptions(selected)[0]):undefined;
  const viewedAutomation=shown?{...shown.lane,id:project?.automation?.some(l=>l.id===shown.lane.id)?shown.lane.id:null,stored:!!project?.automation?.some(l=>l.id===shown.lane.id),channel:selected,targetAvailable:shown.valid,temporarilyOverridden:engine.current.automationOverrides.has(shown.lane.id)}:null;
  const ref=workspaceView==='arrangement'?track?.clipRefs?.find(r=>r.id===focusedRef):undefined;
  const slot=workspaceView==='session'&&slotEditor&&track?.id===slotEditor.track&&inventory?.scenes.some(s=>s.id===slotEditor.scene&&s.slots.some(v=>v.trackId===track.id&&v.clipId===slotEditor.clip))?slotEditor:null;
  const focus=ref?{trackId:track!.id,clipId:ref.clipId,refId:ref.id}:slot?{trackId:slot.track,clipId:slot.clip,sceneId:slot.scene}:null;
  const live=engine.current.live.tracks().flatMap(i=>{
   const track=project?.tracks[i];if(!track)return [];
   const {active,pending}=engine.current.liveState(i);
   return [{trackId:track.id,active:active?{sceneId:active.sceneId,clipId:active.clip?.id??null}:null,pending:pending?{sceneId:pending.sceneId,clipId:pending.clip?.id??null}:pending===null?'return_to_arrangement':null}];
  });
  return {generation:generation.current,projectId:slug,...(slug==='DaisyBell'?{projectNotes:daisyBellNotes[locale]}:{}),conversationProject:editorState.current.conversationProject,selection,workspace:{...inventory,view:workspaceView,editingGrid:{...grid,effective:gridUnit},focus,range:engine.current.loopRange,loopEnabled:engine.current.loop,live},recentParameters:recentParameterContext(),hardware:{connected:hexblocks.connected,active:hexblocks.active,connectors:hexblocks.connectors,mappings:project?.hardwareMappings??[]},viewedAutomation,interactionFocus:viewedAutomation?'automation':focus?'clip':'device',availableChannels:project?.tracks.map((t,i)=>({channel:String(i+1),id:t.id,name:t.user_named?t.name:localize(descriptions?.tracks.find(d=>d.id===t.id)?.name,locale,t.name)})),availableDevices:[...(track?[{id:'instrument',name:currentInstrumentName}]:[]),...(rack?.effects.map(d=>({id:d.id,name:declaredPatchName(d.code)??d.kind}))??[])],label,channelId:track?.id??channel,noteEditing:track?{available:true,focusedClipReference:ref,linkedEditRule:'Editing a referenced note updates every placement of that clip ID. Forked variations retain their own events.',inspectTool:'inspect_notes',editTool:'edit_notes',transposeTool:'transpose_notes',transformTool:'transform_notes',summaryOption:'inspect_notes summaryOnly:true',units:'clipId supplied: clip-local ticks; otherwise absolute arrangement ticks; pitch 60=C4; velocity 1..127'}:null,trackDescription:description,activePatch,audioReady:ready,audioContextState:engine.current.context?.state??'not initialized',transportScope:'project mix; play does not solo the selected track',playing:engine.current.playing,loop:engine.current.loop,durationSeconds:project?tickToSeconds(engine.current.timingProject??project,project.timing.end_tick):0,history:{undoCount:history.current.cursor,redoCount:history.current.entries.length-history.current.cursor},mixerParameters:ready?engine.current.mixerControls(channel):[],mix:track?{gain:track.gain,pan:track.pan,mute:track.mute,solo:track.solo}:ready?{gain:(channel==='master'?engine.current.effects?.master:engine.current.effects?.returns[channel as 'delay'|'reverb'])?.level,mute:(channel==='master'?engine.current.effects?.master:engine.current.effects?.returns[channel as 'delay'|'reverb'])?.muted}:null,meterMap:project?meterMap(project):[],transportMusicalPosition:project?musicalPosition(project,secondsToTick(engine.current.timingProject??project,engine.current.position)):null,transportPositionSeconds:engine.current.position,transportPositionTick:project?secondsToTick(engine.current.timingProject??project,engine.current.position):0,automation:project?.automation??[],automationOverrides:[...engine.current.automationOverrides],tempo:project?{bpm:ready?engine.current.bpm:bpmAtTick(project,0),source:ready?engine.current.tempoSource:'midi',target:{trackId:'master',device:'mixer',address:'bpm'},automation:project.automation?.find(isTempoTarget)??null,override:project.timing.bpm??null,min:MIN_BPM,max:MAX_BPM}:null,timing:project?.timing,timeSignatures:project?.global_events.filter(e=>e.kind==='meta'&&e.type===88),sendAmounts:typeof channel==='number'&&ready?engine.current.effects?.tracks[channel]?.amounts:null,chain:rack?.effects.map(d=>({id:d.id,name:declaredPatchName(d.code)??d.kind,kind:d.kind,bypassed:d.bypassed,controls:d.controls,values:d.values})),observation:'Source code and parameters only; no recorded audio or spectrum analysis.'};
 }
 const tempoEdit=useRef<{before:Session;source:'user'|'assistant'}|null>(null);
 function beginTempo(source:'user'|'assistant'='user'){
  if(!engine.current.context||!engine.current.voices.length||!project||busy||historyLock.current||operationBusy.current||(source==='user'&&assistantTurn.current))throw Error('Wait for the current operation to finish');
  checkpoint(undefined,true);tempoEdit.current={before:capture(engine.current,engine.current.project!),source};historyLock.current=true;operationBusy.current=true;
 }
 function previewTempo(bpm:number|null){
  if(!tempoEdit.current||!engine.current.project)throw Error('No tempo edit in progress');
  const next=withTempo(engine.current.project,bpm);engine.current.setTempoProject(next);setProject(next);setPosition(engine.current.position);setPlaying(engine.current.playing);
 }
 function finishTempo(cancel=false){
  const edit=tempoEdit.current;if(!edit)return;
  try{
   if(cancel){const next={...engine.current.project!,timing:edit.before.project.timing,automation:edit.before.project.automation};engine.current.setTempoProject(next);setProject(next);setPosition(engine.current.position);}
   else {const after=capture(engine.current,engine.current.project!);history.current.push(edit.before,after,`BPM · ${after.project.timing.bpm??'MIDI'}`,edit.source);renderHistory(n=>n+1);}
   baseline.current=capture(engine.current,engine.current.project!);
  }finally{tempoEdit.current=null;historyLock.current=false;operationBusy.current=false;}
 }
 async function clipAction(action:MenuAction){
  if(!project||typeof selected!=='number'||!ready||busy||operationBusy.current||historyLock.current||assistantTurn.current)throw Error('Project is busy');
  const index=selected;
  operationBusy.current=true;
  try{
   checkpoint(undefined,true);
   const before=capture(engine.current,project);
   const result=action.kind==='copyBars'?{project:copyBars(project,index,action.start,action.end,action.destination),ref:undefined}:applyClip(project,index,action);
   validateClips(result.project);
   const next={...before,project:result.project};
   if(engine.current.live.engaged){engine.current.setClipProject(next.project);setProject(next.project);baseline.current=next;}else await restore(next,index);
   history.current.push(before,next,`Clip · ${action.kind}`,'user');
   setFocusedRef(result.ref?.id);
   renderHistory(n=>n+1);
  }finally{operationBusy.current=false;}
 }
 async function commitNoteEdit(channel:number,edit:NoteEdit|NoteTranspose,source:'user'|'assistant'){
  if(!project||busy||operationBusy.current||historyLock.current||(source==='user'&&assistantTurn.current))throw Error('Project is busy');
  const edited='semitones' in edit?transposeNotes(project,channel,edit):editNotes(project,channel,edit);
  operationBusy.current=true;
  try{
   checkpoint(undefined,true);if(!ready)await initializeAudio();
   const before=capture(engine.current,engine.current.project!),next={...before,project:edited.project};
   engine.current.setClipProject(next.project,true);setProject(next.project);
   history.current.push(before,next,`CH ${channel+1}${'bar' in edit&&edit.bar?` · Bar ${edit.bar}`:''} 音符 / Notes +${edited.added} ~${edited.updated} −${edited.removed}`,source);
   baseline.current=capture(engine.current,engine.current.project!);renderHistory(n=>n+1);
   return {selection:{channel,device:'channel'},result:{added:edited.added,updated:edited.updated,removed:edited.removed,...('semitones' in edit?{semitones:edit.semitones}:{}),...(source==='assistant'?inspectNotes(engine.current.project!,channel,{summaryOnly:'semitones' in edit,...('bar' in edit?{bar:edit.bar}:{})}):{})}};
  }finally{operationBusy.current=false;}
 }
 async function musicCommand(selection:Selection,command:MusicCommand,expectedGeneration:string){
  if(library.manager.state.home||library.manager.state.busy||take.current)throw Error('Project is busy');
  if(generation.current!==expectedGeneration)throw Error('The project changed.');
  const clipAction=['assign_clip','create_clip','place_clip','fork_clip'].includes(command.action);
  const clipNotes=command.clipId!==undefined&&['inspect_notes','edit_notes','transpose_notes','transform_notes'].includes(command.action);
  if(clipAction||clipNotes){
   if(!project||busy||operationBusy.current||historyLock.current)throw Error('Project is busy');
   const channel=resolveChannelTarget(selection.channel,command.channel,project.tracks.map(t=>t.id));
   if(typeof channel!=='number')throw Error('Provide a MIDI track for this clip');
   const {next,result}=clipCommand(project,channel,command);
   if(next){
    if(!ready)await initializeAudio();
    commitLiveProject(next,command.action,!['assign_clip','create_clip'].includes(command.action),'assistant');
   }
   return {result};
  }
  if(command.action==='set_tempo'){
   if((command.bpm===undefined)===(command.resetToMidi!==true))throw Error('Supply exactly one of bpm or resetToMidi:true');
   if(!project||busy||operationBusy.current||historyLock.current)throw Error('Project is busy');
   const bpm=command.resetToMidi===true?null:command.bpm!;withTempo(project,bpm);
   if(!ready)await initializeAudio();beginTempo('assistant');
   try{previewTempo(bpm);finishTempo();}catch(e){finishTempo(true);throw e;}
   const current=engine.current.timingProject??engine.current.project!,tick=secondsToTick(current,engine.current.position);
   return {result:{bpm:engine.current.bpm,source:engine.current.tempoSource,playing:engine.current.playing,transportPositionTick:tick,durationSeconds:engine.current.duration}};
  }
  if(command.action==='inspect_notes'||command.action==='edit_notes'||command.action==='transpose_notes'||command.action==='transform_notes'){
   if(!project||busy||operationBusy.current||historyLock.current)throw Error('Project is busy');
   const channel=resolveChannelTarget(selection.channel,command.channel,project.tracks.map(t=>t.id));
   if(typeof channel!=='number')throw Error('Select a MIDI track; Return and Master have no notes');
   if(command.action==='inspect_notes')return {result:inspectNotes(project,channel,command)};
   if(command.action==='transform_notes'){const edit=transformNotes(project,channel,{...command,bar:command.bar!,revision:command.revision??'',operation:command.operation!});noteEditBar(project,channel,edit);return commitNoteEdit(channel,edit,'assistant');}
   if(command.action==='transpose_notes')return commitNoteEdit(channel,{revision:command.revision??'',semitones:command.semitones!},'assistant');
   const edit={bar:command.bar,revision:command.revision??'',add:command.add,update:command.update,remove:command.remove};edit.bar=noteEditBar(project,channel,edit);return commitNoteEdit(channel,edit,'assistant');
  }
  if(command.action==='inspect_hardware')return {result:{connected:hexblocks.connected,active:hexblocks.active,connectors:hexblocks.connectors,mappings:project?.hardwareMappings??[]}};
  if(command.action==='remove_hardware_mapping'){if(!command.mappingId)throw Error('Provide mappingId');removeMapping(command.mappingId);return {result:{removed:command.mappingId}};}
  if(command.action==='set_hardware_mapping'){
   if(command.mappingId&&command.enabled!==undefined){const existing=project?.hardwareMappings?.find(m=>m.id===command.mappingId);if(!existing)throw Error('Unknown mapping');commitMappings(project!.hardwareMappings!.map(m=>m.id===command.mappingId?{...m,enabled:command.enabled!}:m));return {result:{mappingId:command.mappingId,enabled:command.enabled}};}
   const channel=resolveChannelTarget(selection.channel,command.channel,project?.tracks.map(t=>t.id)??[]);
   if(!command.connectorId||!command.uid||command.sensorChannel===undefined||!command.device||!command.address)throw Error('Provide connectorId, uid, sensorChannel, device and address');
   const option=automationOptions(channel).find(o=>o.valid&&o.lane.device===command.device&&o.lane.address===command.address);if(!option)throw Error('Unknown target parameter');
   const mapping=mapHardware({connectorId:command.connectorId,uid:command.uid,sensorChannel:command.sensorChannel,device:command.device,address:command.address,inputMin:command.inputMin!,inputMax:command.inputMax!,outputMin:command.outputMin??option.lane.min,outputMax:command.outputMax??option.lane.max,curve:command.curve??option.lane.scale,invert:command.invert??false,smoothingMs:command.smoothingMs??40},channel,command.mappingId);
   return {result:{mapping},selection:{channel,device:mapping.device==='mixer'?'channel':mapping.device}};
  }
  if(['undo','redo'].includes(command.action)){const result=await travel(command.action==='undo'?-1:1,true);return {result,selection:result.selection};}
  if(command.action==='import_project'){setHistoryOpen(true);return {result:{status:'awaiting_user_file_selection',instruction:'Use Import project in the open Project history panel to choose a local JSON file. No project has been imported yet.'}};}
  if(['export_project','export_history'].includes(command.action)){
   if(!ready||!project||busy)throw Error('Wait for the project to be ready');checkpoint(undefined,true);
   const filename=command.action==='export_project'?'ShallowGroove.project.json':'ShallowGroove.history.json';
   const data=command.action==='export_project'?packFile(capture(engine.current,project),command.includeHistory!==false?history.current:undefined,command.includeConversation===true?readableChat(transcript.current):undefined):{format:'shallowgroove-history',version:1,...history.current};download(data,filename);return {result:{status:'download_requested',filename}};
  }
  if(command.action==='seek'){if(!project||busy)throw Error('Project is busy');seek(finiteRange(command.seconds,0,tickToSeconds(engine.current.timingProject??project,project.timing.end_tick)));return {result:{position:engine.current.position,playing:engine.current.playing}};}
  if(command.action==='set_loop'){if(typeof command.enabled!=='boolean')throw Error('Provide enabled');engine.current.configureLoop(command.enabled);setLoop(command.enabled);return {result:{loop:command.enabled}};}
  if(['set_mix','remove_effect','move_effect','bypass_effect'].includes(command.action)){
   if(!ready||!project||busy||operationBusy.current)throw Error('Project is busy');
   const channel=resolveChannelTarget(selection.channel,command.channel,project.tracks.map(t=>t.id));
   let next:Selection={channel,device:'channel'};operationBusy.current=true;
   try{
    if(command.action==='set_mix'){
     if(!['gain','pan','mute','solo'].some(k=>command[k as keyof MusicCommand]!==undefined))throw Error('Provide a mixer parameter');
     if(command.gain!==undefined)finiteRange(command.gain,0,1.5);if(command.pan!==undefined)finiteRange(command.pan,-1,1);
     for(const key of ['mute','solo'] as const)if(command[key]!==undefined&&typeof command[key]!=='boolean')throw Error('Expected boolean '+key);
     if(typeof channel==='number'){const patch:Partial<Track>={};for(const key of ['gain','pan','mute','solo'] as const)if(command[key]!==undefined)Object.assign(patch,{[key]:command[key]});change(channel,patch);}
     else {if(command.pan!==undefined||command.solo!==undefined)throw Error('Return and Master support gain and mute only');const bus=channel==='master'?engine.current.effects!.master:engine.current.effects!.returns[channel];if(!bus)throw Error('Bus unavailable');if(channel==='master')engine.current.effects!.setMaster(command.gain??bus.level,command.mute??bus.muted);else engine.current.effects!.setReturn(channel,command.gain??bus.level,command.mute??bus.muted);}
    }else{
     const chain=engine.current.effects!.chain(channel),id=command.device??(channel===selection.channel?selection.device:''),index=chain.effects.findIndex(d=>d.id===id);if(index<0)throw Error('Choose an effect ID from inspect_selection');const effect=chain.effects[index];next={channel,device:id};
     if(command.action==='bypass_effect'){if(typeof command.bypassed!=='boolean')throw Error('Provide bypassed');engine.current.effects!.bypass(effect,command.bypassed);}
     else {if(command.action==='move_effect'){const position=finiteRange(command.position,1,chain.effects.length);if(!Number.isInteger(position))throw Error('Position must be an integer');setBusy(true);await engine.current.moveEffect(channel,id,position-1-index);}else{setBusy(true);await engine.current.removeEffect(channel,id);next.device='channel';}}
    }
    selectContext(next);refreshMixer(v=>v+1);return {selection:next,result:{applied:true,action:command.action,channel}};
   }finally{operationBusy.current=false;setBusy(false);}
  }
  if(command.action==='select_target'){
   const channel=resolveChannelTarget(selection.channel,command.channel,project?.tracks.map(t=>t.id)??[]);
   const device=command.device??'channel';
   if(device==='instrument'&&typeof channel!=='number')throw Error('Return and Master channels have no instrument.');
   if(device!=='instrument'&&device!=='channel'&&(!ready||!engine.current.effects?.chain(channel)?.effects.some(d=>d.id===device)))throw Error('Unknown effect ID. Inspect the channel for available devices.');
   const next={channel,device};selectContext(next);return {selection:next,result:snapshot(next)};
  }
  if(['add_track','duplicate_track','rename_track','delete_track'].includes(command.action)){const target=resolveChannelTarget(selection.channel,command.channel,project?.tracks.map(t=>t.id)??[]);const result=await trackAction(command.action,typeof target==='number'?target:undefined,command.name,'assistant');return {result,selection:result.selection};}
  if(command.action==='delete_automation'){if(!command.automationId)throw Error('Provide the automation ID from viewedAutomation or inspect_selection');removeAutomation(command.automationId);return {result:{deletedAutomationId:command.automationId}};}
  if(command.action==='set_automation'){
   if(busy||!ready)throw Error('Enable audio and wait for compilation first');const channel=resolveChannelTarget(selection.channel,command.channel,project?.tracks.map(t=>t.id)??[]),options=automationOptions(channel).filter(o=>o.valid&&(!command.device||o.lane.device===command.device));const candidates=options.filter(o=>o.lane.address===command.address||o.lane.label.toLowerCase()===command.address?.toLowerCase());if(candidates.length!==1)throw Error('Choose one unambiguous device and parameter from inspect_selection');const lane={...candidates[0].lane,points:command.points??candidates[0].lane.points,mode:command.mode??'read'};validateAutomation([lane],project!.timing.end_tick);editAutomation(lane);if(lane.mode==='read')engine.current.resumeAutomation(lane.id);selectContext({channel,device:lane.device==='mixer'?'channel':lane.device});setEnvelope(channel,true,candidates[0].key);return {selection:{channel,device:lane.device==='mixer'?'channel':lane.device},result:{automation:lane}};
  }
  if(command.action==='pause'){pausePlayback();return {result:{playing:false,audioReady:ready,scope:'project',position:engine.current.position}};}
  if(command.action==='stop'){stopPlayback();return {result:{playing:false,audioReady:ready,scope:'project',position:engine.current.position}};}
  if(!project||operationBusy.current||busy)throw Error('The rack is busy.');
  operationBusy.current=true;
  try{
   if(command.action==='play'||command.action==='enable_audio'){
    const request=++transportRequest.current;
    await ensurePlayable();await engine.current.resumeAudio();
    if(request!==transportRequest.current||generation.current!==expectedGeneration)throw Error('Playback request cancelled.');
    if(command.action==='play')await startTransport(armIntent.current&&workspaceView==='arrangement'||engine.current.metronome);
    setPlaying(engine.current.playing);
    return {result:{audioReady:true,audioContextState:engine.current.context?.state,playing:engine.current.playing,scope:'project',position:engine.current.position}};
   }
   const outcome=await executeMusicCommand({engine:engine.current,project,projectId:slug,generation:expectedGeneration,ready,busy,notify:()=>{refreshMixer(v=>v+1);setValues(Object.fromEntries(engine.current.voices.map((v,i)=>[i,{...v.values}])));},setBusy,instrumentChanged:(index,code)=>{delete editorState.current.codeDrafts[engine.current.project!.tracks[index].id];setCodes(c=>({...c,[index]:code}));setControls(c=>({...c,[index]:engine.current.describe(engine.current.voices[index].node)}));}},selection,command);if(outcome.selection)selectContext(outcome.selection);return {...outcome,undo:undefined};}finally{operationBusy.current=false;}
 }
 const [envelopes,setEnvelopes]=useState(new Map<string,{open:boolean;choice:string}>());
 function envelopeId(channel:ChannelTarget){return typeof channel==='number'?project?.tracks[channel]?.id:channel;}
 function setEnvelope(channel:ChannelTarget,open:boolean,choice?:string){
  const id=envelopeId(channel);
  if(!id)return;
  const lanes=project?.automation?.filter(l=>l.trackId===id&&l.points.length);
  const preferred=lanes?.find(l=>l.mode==='read')??lanes?.[0];
  setEnvelopes(previous=>{
   const saved=previous.get(id);
   const nextChoice=choice??saved?.choice??(preferred?JSON.stringify([preferred.device,preferred.address]):'');
   return new Map(previous).set(id,{open,choice:nextChoice});
  });
 }
 const activeEnvelope=envelopes.get(envelopeId(selected)??'');
 const automationOpen=!!activeEnvelope?.open,automationChoice=activeEnvelope?.choice??'';
 function automationOptions(channel:ChannelTarget):AutomationOption[]{
  if(!ready||!project)return [];const trackId=typeof channel==='number'?project.tracks[channel]?.id:channel;if(!trackId)return [];
  const instruments=typeof channel==='number'&&engine.current.voices[channel]?[{id:'instrument',controls:engine.current.describe(engine.current.voices[channel].node),values:engine.current.voices[channel].values}]:[];
  const effects=engine.current.effects?.chain(channel).effects??[];
  const effectLabels=new Map(effects.map((fx,i)=>[fx.id,`FX ${i+1} · ${declaredPatchName(fx.code)??fx.kind}`]));
  const devices=[{id:'mixer',controls:engine.current.mixerControls(channel),values:{} as Record<string,number>},...instruments,...effects];
  const options:AutomationOption[]=devices.flatMap(d=>d.controls.filter(c=>c.max>c.min&&(c.label!=='BPM'||(trackId==='master'&&d.id==='mixer'&&c.address==='bpm'))&&!(('wetOnly' in d)&&d.wetOnly&&c.label==='Mix')).map(c=>{
   const old=project.automation?.find(l=>l.trackId===trackId&&l.device===d.id&&l.address===c.address),discrete=['Sync','Division'].includes(c.label),scale=c.min>0&&/cutoff|frequency|high cut/i.test(c.label)?'log':'linear';
   const lane:AutomationLane=old??{id:crypto.randomUUID(),trackId,device:d.id,address:c.address,label:c.label,min:c.min,max:c.max,step:c.step,scale,mode:'read',interpolation:discrete?'step':'linear',points:[]};const current=engine.current.automationDisplay(trackId,d.id,c.address,d.values[c.address]??c.init);
   if(!old)lane.points=[{tick:0,value:normalize(lane,current)},{tick:project.timing.end_tick,value:normalize(lane,current)}].filter((p,i,a)=>i===0||p.tick!==a[i-1].tick);
   return {key:JSON.stringify([d.id,c.address]),lane,current,valid:true,deviceLabel:effectLabels.get(d.id)};
  }));
  for(const lane of project.automation??[])if(lane.trackId===trackId&&!options.some(o=>o.lane.device===lane.device&&o.lane.address===lane.address))options.push({key:JSON.stringify([lane.device,lane.address]),lane,current:lane.min,valid:false});return options;
 }
 function parameterIdentity(ref:ParameterRef,knownOption?:AutomationOption){
  if(!project)return null;const index=project.tracks.findIndex(t=>t.id===ref.trackId),channel:ChannelTarget=index>=0?index:ref.trackId as ChannelTarget;
  if(index<0&&!['delay','reverb','master'].includes(ref.trackId))return null;
  const option=knownOption??automationOptions(channel).find(o=>o.valid&&o.lane.device===ref.device&&o.lane.address===ref.address);if(!option)return null;
  const track=index>=0?project.tracks[index]:undefined,assignment=track?assignedPatch(slug,track.id,soundSet):undefined;
  const channelLabel=track?`CH ${index+1} · ${track.user_named?track.name:localize(descriptions?.tracks.find(t=>t.id===track.id)?.name,locale,track.name)}`:channel==='delay'?'A · Delay':channel==='reverb'?'B · Reverb':'Master';
  const fx=ref.device!=='mixer'&&ref.device!=='instrument'?engine.current.effects?.chain(channel).effects.find(d=>d.id===ref.device):undefined;
  const patchName=ref.device==='mixer'?'Mixer':fx?`${(engine.current.effects!.chain(channel).effects.indexOf(fx))+1} · ${declaredPatchName(fx.code)??fx.kind}`:assignment?instrumentName(engine.current.voices[index]?.code??assignment.code,assignment.code,localize(assignment.patch?.name,locale,'Instrument'),locale==='zh-CN'?'自定义音色':'Custom instrument'):'Instrument';
  return {channel,channelLabel,patchName,option};
 }
 function mappingOptions():MappingOption[]{
  if(!project||!ready)return [];const channels:ChannelTarget[]=[...project.tracks.map((_,i)=>i),'delay','reverb','master'];
  return channels.flatMap(channel=>automationOptions(channel).filter(o=>o.valid).map(o=>{const ref={trackId:o.lane.trackId,device:o.lane.device,address:o.lane.address},identity=parameterIdentity(ref,o)!;return {...o,key:JSON.stringify([ref.trackId,ref.device,ref.address]),group:`${identity.channelLabel} / ${identity.patchName}`};}));
 }
 function recentParameterContext(){return recentParameters.current.filter(p=>p.generation===generation.current).map(({generation:_generation,...p})=>{const identity=parameterIdentity(p);return {...p,channel:identity?(typeof identity.channel==='number'?String(identity.channel+1):identity.channel):undefined,channelName:identity?.channelLabel,patchName:identity?.patchName,label:identity?.option.lane.label,currentValue:identity?.option.current,targetAvailable:!!identity};});}
 const receiveParameterMenu=useEffectEvent((detail:ParameterRef&{x:number;y:number})=>{if(busy||assistantTurn.current)return;const identity=parameterIdentity(detail);if(!identity)return;selectContext({channel:identity.channel,device:detail.device==='mixer'?'channel':detail.device});setParameterFocus(detail);parameterDialog.current?.showModal();});
 const receiveParameterEdit=useEffectEvent((detail:ParameterRef&{value:number})=>{if(!Number.isFinite(detail.value))return;const identity=parameterIdentity(detail);if(!identity)return;recentParameters.current=rememberParameter(recentParameters.current,{...detail,at:Date.now(),generation:generation.current});selectContext({channel:identity.channel,device:detail.device==='mixer'?'channel':detail.device});});
 useEffect(()=>{const menu=(e:Event)=>receiveParameterMenu((e as CustomEvent).detail),edit=(e:Event)=>receiveParameterEdit((e as CustomEvent).detail);window.addEventListener('shallowgroove-parameter-menu',menu);window.addEventListener('shallowgroove-parameter-edited',edit);return()=>{window.removeEventListener('shallowgroove-parameter-menu',menu);window.removeEventListener('shallowgroove-parameter-edited',edit);};},[]);
 function parameterAction(kind:'automation'|'mapping'){
  if(!parameterFocus)return;const identity=parameterIdentity(parameterFocus);if(!identity){parameterDialog.current?.close();return;}
  selectContext({channel:identity.channel,device:parameterFocus.device==='mixer'?'channel':parameterFocus.device});parameterDialog.current?.close();
  if(kind==='automation'){setEnvelope(identity.channel,true,identity.option.key);setWorkspaceView('arrangement');setCollapsed(c=>({...c,overview:false}));}
  else {window.dispatchEvent(new Event('shallowgroove-show-sidebar'));setMappingRequest({key:JSON.stringify([parameterFocus.trackId,parameterFocus.device,parameterFocus.address]),nonce:Date.now()});}
 }
 function removeAutomation(id:string){if(!project||busy)throw Error('Project is busy');if(!project.automation?.some(l=>l.id===id))throw Error('Automation no longer exists');const next={...project,automation:project.automation.filter(l=>l.id!==id)};engine.current.automationOverrides.delete(id);engine.current.setAutomationProject(next);setProject(next);}
 function editAutomation(lane:AutomationLane){if(!project||busy)return;const lanes=[...(project.automation??[]).filter(l=>l.id!==lane.id&&!(l.trackId===lane.trackId&&l.device===lane.device&&l.address===lane.address)),lane];validateAutomation(lanes,project.timing.end_tick);const next={...project,automation:lanes};engine.current.setAutomationProject(next);setProject(next);}
 const showAutomation=useEffectEvent((detail:{device:string;address:string})=>{setSelectedDevice(detail.device==='mixer'?'channel':detail.device);setEnvelope(selected,true,JSON.stringify([detail.device,detail.address]));setCollapsed(c=>({...c,overview:false}));});
 useEffect(()=>{const show=(event:Event)=>showAutomation((event as CustomEvent).detail);window.addEventListener('shallowgroove-automation',show);return()=>window.removeEventListener('shallowgroove-automation',show);},[]);
 const selectedDeviceExists=selectedDevice==='channel'||selectedDevice==='instrument'||(ready&&!!engine.current.effects?.chain(selected)?.effects.some(d=>d.id===selectedDevice));
 useEffect(()=>{if(!selectedDeviceExists)setSelectedDevice('channel');},[selectedDeviceExists]);
 const editingClip=project&&typeof selected==='number'&&workspaceView==='session'&&slotEditor?.track===project.tracks[selected]?.id&&inventory?.scenes.some(s=>s.id===slotEditor.scene&&s.slots.some(v=>v.trackId===slotEditor.track&&v.clipId===slotEditor.clip))?project.clips?.find(c=>c.id===slotEditor?.clip):undefined;
 const localEditor=useMemo(()=>project&&editingClip&&typeof selected==='number'?clipEditorProject(project,selected,editingClip):undefined,[project,editingClip,selected]);
 function commitLiveProject(next:Project,label:string,notes=false,source:'assistant'|'user'='user'){
  if(!project||busy||!canCapture(engine.current,project)||operationBusy.current||(source==='user'&&assistantTurn.current)||historyLock.current)throw Error('Project is busy');
  checkpoint(undefined,source==='assistant');const before=capture(engine.current,project);
  if(notes)engine.current.setClipProject(next);else engine.current.project=next;
  setProject(next);const after=capture(engine.current,next);
  history.current.push(before,after,label,source);baseline.current=after;renderHistory(n=>n+1);
 }
 function clipContextMenu(event:React.MouseEvent){
  const id=(event.target as Element).closest<HTMLElement>('[data-clip-id]')?.dataset.clipId;
  if(!id||!project)return;
  event.preventDefault();event.stopPropagation();
  const clip=project.clips?.find(c=>c.id===id),input=clipNameInput.current;
  if(!clip||!input||!ready||busy||assistantTurn.current)return;
  setRenameTarget({id,x:event.clientX,y:event.clientY});
  input.value=clip.name;clipRenameDialog.current?.showModal();input.focus();input.select();
 }
 function submitClipName(event:React.FormEvent){
  event.preventDefault();
  if(!project||!renameTarget||!clipNameInput.current)return;
  try{
   const next=renameClip(project,renameTarget.id,clipNameInput.current.value);
   if(next!==project)commitLiveProject(next,'重命名 Clip / Rename clip');
   clipRenameDialog.current?.close();
  }catch(e){clipNameInput.current.setCustomValidity(String(e));clipNameInput.current.reportValidity();}
 }
 function openSlotEditor(index:number,clip:string,scene:string){
  if(!project)return;
  selectChannel(index);setSlotEditor({track:project.tracks[index].id,clip,scene});setCollapsed(c=>({...c,notes:false}));
 }
 function createInSlot(scene:string,track:string,bars:number){
  if(!project)throw Error('No project');
  const result=createSlotClip(project,scene,track,bars);
  commitLiveProject(result.project,'新建现场 Clip / Create session clip');
  openSlotEditor(project.tracks.findIndex(t=>t.id===track),result.clip.id,scene);
 }
 function changeScenes(scenes:Scene[]){
  if(!project)return;try{const next={...project,scenes};validateScenes(next);commitLiveProject(next,'现场场景 / Session scenes');}catch(e){setError(String(e));}
 }
 async function editSlotNotes(edit:NoteEdit){
  if(!project||!localEditor||!editingClip||typeof selected!=='number')throw Error('Select a clip');
  const notes=editNotes(localEditor,selected,edit).project.tracks[selected].events;
  commitLiveProject(replaceClipEvents(project,editingClip.id,notes),'现场 Clip / Clip notes',true);
 }
 async function launchScene(scene:Scene,onlyTrack?:string){
  if(!project||busy||!ready)return;
  const launches=sceneLaunches(project,scene,onlyTrack);
  try{await engine.current.launchSlots(launches);setPlaying(engine.current.playing);refreshMixer(n=>n+1);}catch(e){setError(String(e));}
 }
 const displayProject=useMemo(()=>project?({...project,tracks:project.tracks.map(t=>({...t,name:t.user_named?t.name:localize(descriptions?.tracks.find(d=>d.id===t.id)?.name,locale,t.name)}))}):null,[project,descriptions,locale]);
 const fileInput=<input ref={importInput} type="file" accept=".json,.zip,application/zip" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importProject(file);}}/>;
 const saveStatus=({example:locale==='zh-CN'?'Example · 保存创建副本':'Example · Save a copy',new:locale==='zh-CN'?'新项目 · 尚未保存':'New · Not saved',unsaved:locale==='zh-CN'?'有未保存的修改':'Unsaved changes','saved-folder':locale==='zh-CN'?'已保存到本地文件夹':'Saved to local folder','saved-browser':locale==='zh-CN'?'已保存到此浏览器':'Saved in this browser',opened:locale==='zh-CN'?'项目已打开':'Project opened',recovered:locale==='zh-CN'?'已恢复草稿 · 尚未保存':'Draft recovered · Not saved'} as Record<string,string>)[library.state.status]??'';
 if(library.state.home||!project||!displayProject)return <><ProjectWelcome settings={<DeepSeekSettings zh={locale==='zh-CN'} welcome/>} state={{...library.state,error:library.state.error||error}} locale={locale} onLocale={setLocale} version={appVersion} desktop={!!window.shallowgrooveDesktop} onExample={id=>projectAction(()=>library.manager.openExample(id))} onNew={()=>projectAction(()=>library.manager.newProject())} onRecent={id=>projectAction(()=>library.manager.openRecent(id))} onClone={()=>cloneDialog.current?.showModal()} onFolder={()=>projectAction(()=>library.manager.openFolder())} onImport={()=>importInput.current?.click()} onRecover={()=>projectAction(()=>library.manager.recover())} onDiscardDraft={()=>projectAction(()=>library.manager.discardDraft())}/>{fileInput}{library.dialog}<dialog ref={cloneDialog} className="versions-dialog"><form onSubmit={e=>{e.preventDefault();cloneDialog.current?.close();projectAction(async()=>{const value=await window.shallowgrooveDesktop!.projectClone(cloneUrl);if(value)await library.manager.openRecent(value.record.id);});}}><label>{locale==='zh-CN'?'远端 Git 地址':'Remote Git URL'} <input required type="url" value={cloneUrl} placeholder="https://…" onChange={e=>setCloneUrl(e.target.value)}/></label><button>{locale==='zh-CN'?'打开':'Open'}</button><button type="button" onClick={()=>cloneDialog.current?.close()}>×</button></form></dialog></>;
 const assistantTarget={channel:selected,device:selectedDevice};
 const targetLabel=describeSelection(assistantTarget).label;
 const trackIndex=typeof selected==='number'?selected:0;
 const assignment=assignedPatch(slug,project.tracks[trackIndex]?.id??'',soundSet);
 const activeCode=engine.current.voices[trackIndex]?.code??assignment.code;
 const activeName=instrumentName(activeCode,assignment.code,localize(assignment.patch?.name,locale,'Basic Faust synth'),locale==='zh-CN'?'自定义 Faust 音色':'Custom Faust instrument');
 const headerHeight=28;
 const bodySpace=Math.max(0,rowSpace-4*headerHeight);
 const expandedLower=!collapsed.mixer||!collapsed.devices||!collapsed.notes;
 // Size the utility docks first. Timeline editors share the remaining canvas.
 const mixerBody=collapsed.mixer?0:Math.min(230,bodySpace*.28);
 const devicesBody=collapsed.devices?0:Math.min(194,bodySpace*.23);
 const editorSpace=bodySpace-mixerBody-devicesBody;
 const overviewBody=collapsed.overview?0:editorSpace*(collapsed.notes?1:.52);
 const notesBody=collapsed.notes?0:editorSpace-overviewBody;
 const lowerBody=mixerBody+devicesBody+notesBody;
 const overviewMin=headerHeight+Math.min(90,bodySpace*.18);
 const openLowerCount=[collapsed.mixer,collapsed.devices,collapsed.notes].filter(folded=>!folded).length;
 const overviewMax=headerHeight+bodySpace-openLowerCount*Math.min(70,bodySpace*.15);
 const defaultOverview=headerHeight+overviewBody;
 const overviewHeight=collapsed.overview?headerHeight:Math.max(overviewMin,Math.min(overviewMax,defaultOverview+overviewAdjustment*rowSpace));
 const lowerScale=collapsed.overview||!lowerBody?1:(rowSpace-4*headerHeight-(overviewHeight-headerHeight))/lowerBody;
 const dockSpace=(mixerBody+devicesBody)*lowerScale;
 const splitDocks=!collapsed.mixer&&!collapsed.devices&&dockSpace>0;
 const minDockBody=Math.min(48,dockSpace/3);
 const mixerHeight=headerHeight+(splitDocks&&mixerShare!==null
  ?Math.max(minDockBody,Math.min(dockSpace-minDockBody,dockSpace*mixerShare))
  :mixerBody*lowerScale);
 const devicesHeight=2*headerHeight+dockSpace-mixerHeight;
 const panelRows=[overviewHeight,mixerHeight,devicesHeight,headerHeight+notesBody*lowerScale].map(height=>`${height}px`).join(' ');
 const timingProject=ready?(engine.current.timingProject??project):project;
 const duration=tickToSeconds(timingProject,project.timing.end_tick);
 const activeRef=typeof selected==='number'?project.tracks[selected]?.clipRefs?.find(r=>r.id===focusedRef):undefined;
 const activeClip=activeRef&&project.clips?.find(c=>c.id===activeRef.clipId);
 const playheadMeter=musicalPosition(project,secondsToTick(timingProject,position));
 const barDigits=String(musicalPosition(project,project.timing.end_tick).bar).length;
 const beatDigits=meterMap(project).reduce((digits,meter)=>Math.max(digits,String(meter.numerator).length),1);
 function renderEnvelope(channel:ChannelTarget){
  const id=envelopeId(channel),state=id&&envelopes.get(id);
  if(!state||!state.open||!project)return null;
  const options=automationOptions(channel);
  return <AutomationEditor key={id} project={project} timingProject={timingProject} options={options} choice={state.choice}
   onChoice={key=>{
    const option=options.find(o=>o.key===key);
    setEnvelope(channel,true,key);
    selectChannel(channel);
    if(option?.valid)setSelectedDevice(option.lane.device==='mixer'?'channel':option.lane.device);
   }}
   onChange={lane=>{if(channel!==selected)selectChannel(channel);editAutomation(lane);}}
   onDelete={laneId=>{removeAutomation(laneId);setEnvelope(channel,false);}}
   overridden={laneId=>engine.current.automationOverrides.has(laneId)}
   onResume={laneId=>{engine.current.resumeAutomation(laneId);refreshMixer(n=>n+1);}}
   onClose={()=>setEnvelope(channel,false)} zh={locale==='zh-CN'}/>;
 }
 function openVersions(){projectAction(async()=>{if(!library.manager.state.id&&!await library.manager.save())return;setVersionsOpen(true);setZipHint(false);});}
 return <><div className="app studio" inert={libraryBusy}><div className="project-filebar"><button onClick={()=>fileAction('home')}>{locale==='zh-CN'?'← 欢迎页':'← Home'}</button><strong>{library.state.name}{library.state.dirty?' *':''}</strong>{slug==='DaisyBell'&&<DaisyBellNotes zh={locale==='zh-CN'}/>}<span className="project-source">{library.state.source==='example'?'EXAMPLE':window.shallowgrooveDesktop?'LOCAL PROJECT':'BROWSER PROJECT'}</span><button disabled={!ready||busy||assistantTurn.current} onClick={()=>fileAction('save')} title="Cmd/Ctrl+S">{locale==='zh-CN'?'保存':'Save'}</button><button disabled={!ready||busy||assistantTurn.current} onClick={()=>fileAction('save-as')}>{locale==='zh-CN'?'另存为…':'Save as…'}</button><button disabled={!ready||busy||assistantTurn.current} onClick={()=>projectAction(exportProject)}>{locale==='zh-CN'?'导出 ZIP':'Export ZIP'}</button><button disabled={busy||assistantTurn.current} onClick={()=>importInput.current?.click()}>{locale==='zh-CN'?'导入':'Import'}</button>{window.shallowgrooveDesktop&&<button disabled={busy||assistantTurn.current} onClick={openVersions}>{locale==='zh-CN'?'版本':'Versions'}</button>}<span role="status" className="project-save-status">{library.state.dirty?(locale==='zh-CN'?'有未保存的修改':'Unsaved changes'):saveStatus}</span><div className="view-switch" role="group" aria-label={locale==='zh-CN'?'工作区视图':'Workspace view'}>
 {engine.current.live.engaged&&<button onClick={()=>engine.current.backToArrangement()}>{locale==='zh-CN'?'恢复编曲播放':'Back to arrangement'}</button>}
 {(['arrangement','session'] as const).map(mode=>{const name=mode==='session'?(locale==='zh-CN'?'现场':'Session'):(locale==='zh-CN'?'编曲':'Arrangement');return <button key={mode} title={name} aria-label={name} aria-pressed={workspaceView===mode} disabled={recording||!!countLabel} onClick={()=>{setWorkspaceView(mode);setCollapsed(c=>({...c,overview:false}));}}><i className={mode} aria-hidden="true"/></button>;})}</div></div><header className="transport"><h1>shallowgroove<span>音序 · 声音 · 机架</span></h1><span className="project-title-transport">{library.state.name}</span>
  {periodYear(slug)&&<select aria-label="Sound set" disabled={busy||recording} value={soundSet} onChange={e=>{history.current=new History();baseline.current=null;engine.current.stop();setSoundSet(e.target.value as SoundSet);editorState.current.soundSet=e.target.value as SoundSet;editorState.current.codeDrafts={};setReady(false);generation.current=crypto.randomUUID();setSelectedDevice('channel');setCodes({});setControls({});setValues({});void initializeAudio(project,false,e.target.value as SoundSet).catch(e=>setError(String(e)));}}><option value="period">{periodYear(slug)} · {locale==='zh-CN'?'近似音色':'Inspired patches'}</option><option value="basic">{locale==='zh-CN'?'原基础音色':'Basic synth'}</option></select>}
  <button aria-label="Undo" disabled={recording||busy||assistantTurn.current||!ready||history.current.cursor===0} onClick={()=>void travel(-1)}>↶</button><button aria-label="Redo" disabled={recording||busy||assistantTurn.current||!ready||history.current.cursor===history.current.entries.length} onClick={()=>void travel(1)}>↷</button><TempoControl bpm={bpmAtTick(timingProject,secondsToTick(timingProject,position))} source={ready?engine.current.tempoSource:undefined} resumable={!!project.automation?.some(l=>isTempoTarget(l)&&l.mode==='off'&&l.points.length)} onResume={()=>{const lane=project.automation?.find(isTempoTarget);if(lane)editAutomation({...lane,mode:'read'});}} overridden={project.timing.bpm!==undefined} disabled={!ready||busy||assistantTurn.current} zh={locale==='zh-CN'} onBegin={()=>beginTempo()} onChange={previewTempo} onFinish={finishTempo}/><div className="transport-buttons"><button className="play" title={loop&&engine.current.loopRange?(locale==='zh-CN'?'从播放头播放；在选区外时从左端开始 · 空格':'Play from cursor, or selection start if outside · Space'):(locale==='zh-CN'?'播放 · 空格':'Play · Space')} aria-keyshortcuts="Space" aria-label="Play" aria-pressed={playing} aria-busy={busy} disabled={busy||playing||!!countLabel} onClick={()=>void play()}>{busy?'…':'▶'}</button><button className="transport-record" disabled={busy||!ready||assistantWorking||workspaceView!=='arrangement'} aria-label="Record arrangement" title={recording?(locale==='zh-CN'?'正在录制 · 点击结束录制':'Recording · click to end take'):recordArmed?(locale==='zh-CN'?'录制已就绪':'Recording armed'):(locale==='zh-CN'?'准备录制编曲':'Arm arrangement recording')} aria-pressed={recordArmed} data-recording={recording} data-counting={!!countLabel&&recordArmed} onClick={toggleRecord}>●</button><button aria-label="Pause" title={locale==='zh-CN'?'暂停 · 保留当前位置 · 空格':'Pause · keep position · Space'} disabled={!playing||busy} onClick={pausePlayback}>Ⅱ</button><button aria-label="Stop" title={locale==='zh-CN'?'停止 · 回到开头':'Stop · return to start'} disabled={busy} onClick={stopPlayback}>■</button><button aria-label="Return to start" title={locale==='zh-CN'?'回到开头':'Return to start'} disabled={busy} onClick={()=>seek(0)}>Ⅰ◀</button><button aria-label="Loop" disabled={recording} title={locale==='zh-CN'?'到达右端后回到左端重复播放':'Repeat from the left boundary at the end'} aria-pressed={loop} className={loop?'active':''} onClick={()=>{engine.current.configureLoop(!loop);setLoop(!loop);}}>↻</button></div><output className="clock" aria-label="Current position" title={locale==='zh-CN'?'小节.拍':'Bar.beat'}><span className="clock-musical"><span className="clock-bar" style={{width:barDigits+'ch'}}>{playheadMeter.bar}</span>.<span style={{width:beatDigits+'ch'}}>{playheadMeter.beat}</span><small> · {playheadMeter.numerator}/{playheadMeter.denominator}</small></span><small className="clock-time">{clock(position)} / {clock(duration)}</small></output><GridMenu grid={grid} auto={autoGrid} zh={locale==='zh-CN'} onChange={setGrid}/><button className="metronome-toggle" aria-label={locale==='zh-CN'?'节拍器':'Metronome'} title={locale==='zh-CN'?'节拍器':'Metronome'} aria-pressed={click} onClick={()=>{engine.current.setMetronome(!click);setClick(!click);}}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3h3l4 18H5L10 3Z M6 17h10 M11 17l8-12"/>
          <path d="m15.5 8 3 2" strokeWidth="3"/>
        </svg>
      </button><select className="count-in-menu" aria-label="Count-in" title={locale==='zh-CN'?'预备拍小节数':'Count-in length'} disabled={!!countLabel||recording} value={countBars} onChange={e=>{const n=Number(e.target.value);setCountBars(n);try{localStorage.setItem('shallowgroove.countInBars',String(n));}catch{}}}>{[0,1,2,4].map(n=><option key={n} value={n}>{locale==='zh-CN'?(n?n+' 小节':'无预备拍'):(n?n+(n===1?' bar':' bars'):'No count-in')}</option>)}</select>{countLabel&&<output className="count-in-display" aria-label="Count-in position">{countLabel}</output>}<button disabled={recording||!!countLabel} onClick={async()=>{setMidiIssue('');setMidiLoading(true);midiDialog.current?.showModal();try{await midi.connect();}catch(e){setMidiIssue(String(e));}finally{setMidiLoading(false);}}}>{locale==='zh-CN'?'MIDI 设备':'MIDI devices'}</button><dialog ref={midiDialog} className="versions-dialog"><header><strong>{locale==='zh-CN'?'MIDI 输入设备':'MIDI input devices'}</strong><button onClick={()=>midiDialog.current?.close()} aria-label="Close MIDI settings">×</button></header>{midiIssue?<p role="alert">{midiIssue}</p>:midiLoading?<p>…</p>:midi.devices.length?midi.devices.map(d=><label className="midi-input-row" key={d.id}><input type="checkbox" checked={midi.enabled(d.id)} onChange={e=>{if(!e.target.checked)silenceInput();midi.setEnabled(d.id,e.target.checked);}}/>{d.name||d.id}{d.manufacturer&&<small>{d.manufacturer}</small>}</label>):<p>{locale==='zh-CN'?'尚未检测到 MIDI 输入。连接键盘后会自动显示。':'Connect a MIDI keyboard to see it here.'}</p>}</dialog><select className="locale-select" aria-label="Language / 语言" value={locale} onChange={e=>setLocale(e.target.value as Locale)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></header>
  {zipHint&&<div className="zip-hint" role="status"><span>{locale==='zh-CN'?'已导入 ZIP。多人协作推荐用远端 Git 同步工程版本。':'ZIP imported. For collaboration, sync project versions with a Git remote.'}</span>{window.shallowgrooveDesktop&&<button onClick={openVersions}>{locale==='zh-CN'?'设置同步':'Set up sync'}</button>}<button onClick={()=>setZipHint(false)}>{locale==='zh-CN'?'知道了':'Dismiss'}</button></div>}
  {(error||library.state.error)&&<div className="error" role="alert">{error||library.state.error}<button aria-label="Dismiss error" onClick={()=>{setError('');library.manager.clearError();}}>×</button></div>}
  {assistantWorking&&<div className="assistant-lock-notice" role="status" aria-live="polite"><span aria-hidden="true">◷</span><span>{locale==='zh-CN'?'请等待AI助手更新完成':'Please wait for the AI assistant to finish updating'}</span></div>}
  <div className="studio-workspace"><main onContextMenuCapture={clipContextMenu} ref={measureWorkspace} aria-busy={assistantWorking} inert={busy||assistantTurn.current||recording||!!countLabel} className="studio-main" style={{gridTemplateRows:panelRows}}><WorkspacePanel id="overview" title={workspaceView==='session'?(locale==='zh-CN'?'现场':'Session'):locale==='zh-CN'?'轨道总览':'Arrangement'} summary={`${project.tracks.length} TRACKS`} collapsed={collapsed.overview} onToggle={()=>togglePanel('overview')}><section className="overview"><div className="arrangement-view" hidden={workspaceView!=='arrangement'}><Arrangement playing={playing&&workspaceView==='arrangement'&&!collapsed.overview} readPosition={readTransportPosition} armed={armed} onArm={id=>void armTrack(id)} grid={grid} onAuto={setAutoGrid} focusedRef={activeRef?.id} onFocusClip={(index,id)=>{selectChannel(index);setFocusedRef(id);if(id)setCollapsed(c=>({...c,notes:false}));}} clipMenu={<ClipMenu unit={gridUnit} triplet={grid.triplet} project={project} index={typeof selected==='number'?selected:-1} range={engine.current.loopRange} active={activeRef} cursor={secondsToTick(timingProject,position)} zh={locale==='zh-CN'} disabled={busy||!ready} onAction={clipAction}/>} automationChoice={id=>envelopes.get(id)?.choice} onFold={i=>{selectChannel(i);setEnvelope(i,!envelopes.get(project.tracks[i].id)?.open);}} loop={loop} range={engine.current.loopRange} onRange={r=>{engine.current.configureLoop(loop,r);setPosition(engine.current.position);refreshMixer(n=>n+1);}} automationAt={renderEnvelope} busAutomation={typeof selected==='number'?null:renderEnvelope(selected)} onAdd={()=>addDialog.current?.showModal()} onTrackMenu={trackMenu} onSeek={seek} seekingDisabled={busy} locale={locale} project={{...displayProject,timing:timingProject.timing,automation:timingProject.automation}} selected={typeof selected==='number'?selected:-1} onSelect={selectChannel} onChange={change} position={position} duration={duration} levels={levels}/></div>{workspaceView==='session'&&<SessionView project={displayProject} selected={typeof selected==='number'?selected:-1} zh={locale==='zh-CN'} disabled={busy||!ready} onScenes={changeScenes} onCreate={createInSlot} state={i=>engine.current.liveState(i)} focus={slotEditor} onEmpty={(i,scene)=>{const track=project.tracks[i].id;selectChannel(i);setSlotEditor({track,scene:scene.id,clip:null});if(engine.current.playing)void launchScene(scene,track);}} onLaunch={launchScene} onEdit={openSlotEditor}/>}{workspaceView==='arrangement'&&showInfo&&typeof selected==='number'&&<div className="track-context"><button onClick={()=>setShowInfo(false)} aria-label="Close track info">×</button><TrackInfo activeInstrument={activeCode===assignment.code?(assignment.patch??descriptions?.faust_instruments['shallow-synth-v1']):{name:{[locale]:activeName},description:{'zh-CN':'当前自定义 Faust 音色；原始 MIDI 乐器资料仅供参考。',en:'Current custom Faust patch; original MIDI instrument notes are reference only.'}}} track={descriptions?.tracks.find(t=>t.id===project.tracks[selected].id)} file={descriptions} locale={locale}/></div>}</section><PanelResizeHandle value={overviewHeight} min={overviewMin} max={expandedLower?overviewMax:overviewHeight} onChange={height=>setOverviewAdjustment((height-defaultOverview)/rowSpace)} zh={locale==='zh-CN'}/></WorkspacePanel>
  <WorkspacePanel id="mixer" title={locale==='zh-CN'?'混音台':'Mixer'} summary="A / B / MASTER" collapsed={collapsed.mixer} onToggle={()=>togglePanel('mixer')}><Mixer locale={locale} onAdd={()=>addDialog.current?.showModal()} onTrackMenu={trackMenu} project={displayProject} engine={engine.current} selected={selected} onSelect={selectChannel} onChange={change} ready={ready} busy={busy} levels={levels.map(pair=>typeof pair==='number'?pair:Math.hypot(...pair)/Math.SQRT2)} refresh={()=>refreshMixer(v=>v+1)}/>{splitDocks&&<PanelResizeHandle target="mixer" value={mixerHeight} min={headerHeight+minDockBody} max={headerHeight+dockSpace-minDockBody} onChange={height=>setMixerShare((height-headerHeight)/dockSpace)} zh={locale==='zh-CN'}/>}</WorkspacePanel>
  <WorkspacePanel id="devices" title={locale==='zh-CN'?'设备链':'Devices'} summary={typeof selected==='number'?`CH ${selected+1}`:selected.toUpperCase()} collapsed={collapsed.devices} onToggle={()=>togglePanel('devices')}><section className="device-dock"><EffectsPanel drafts={editorState.current.effectDrafts??{}} onDraft={(id,code)=>{editorState.current.effectDrafts??={};if(code===undefined)delete editorState.current.effectDrafts[id];else editorState.current.effectDrafts[id]=code;refreshMixer(n=>n+1);}} engine={engine.current} track={selected} locale={locale} ready={ready} busy={busy} playing={playing} setBusy={setBusy} onError={setError} selectedDevice={selectedDevice} onSelectDevice={setSelectedDevice}>{typeof selected==='number'&&<DevicePanel onInspect={()=>inspectDevice(engine.current,selected,undefined,activeName,locale==='zh-CN')} trackId={project.tracks[selected].id} selected={selectedDevice==='instrument'} onSelect={()=>setSelectedDevice('instrument')} key={project.tracks[selected].id} title={activeName} locale={locale} parameterLabels={engine.current.voices[trackIndex]?.code===assignment.code?(assignment.patch?.parameters??descriptions?.faust_instruments['shallow-synth-v1']?.parameters):undefined} channel={project.tracks[selected].midi_channel} controls={controls[selected]??[]} values={Object.fromEntries((controls[selected]??[]).map(c=>[c.address,engine.current.automationDisplay(project.tracks[selected].id,'instrument',c.address,values[selected]?.[c.address]??c.init)]))} code={codes[selected]??assignedPatch(slug,project.tracks[selected].id,soundSet).code} compiledCode={engine.current.voices[selected]?.code} onCode={s=>{editorState.current.codeDrafts[project.tracks[selected].id]=s;setCodes(c=>({...c,[selected]:s}));}} onParameter={parameter} onCompile={()=>void compile()} busy={busy} ready={ready} playing={playing}/>}</EffectsPanel></section></WorkspacePanel>
  <WorkspacePanel id="notes" title={locale==='zh-CN'?'音符编辑':'Notes'} summary={typeof selected==='number'?`CH ${selected+1} · MIDI`:'MIDI'} collapsed={collapsed.notes} onToggle={()=>togglePanel('notes')}>
   {workspaceView==='session'&&typeof selected==='number'&&!editingClip?<p className="piano-no-track">{locale==='zh-CN'?'未选择 Clip':'No clip selected'}</p>:typeof selected==='number'?<PianoRoll referenceCount={editingClip?clipReferenceCount(project,editingClip.id):undefined} clipRef={workspaceView==='arrangement'?activeRef:undefined} clip={editingClip??(workspaceView==='arrangement'?activeClip:undefined)} onExitClip={()=>{setFocusedRef(undefined);setSlotEditor(null);}} key={`${generation.current}/${project.tracks[selected].id}/${editingClip?.id??''}`} project={localEditor??project} index={selected} zh={locale==='zh-CN'} disabled={busy||!ready||assistantTurn.current} playhead={editingClip?(engine.current.liveState(selected).active?.clip?.id===editingClip.id?engine.current.liveState(selected).phase:0):secondsToTick(timingProject,position)} onCommit={editingClip?editSlotNotes:edit=>commitNoteEdit(selected,edit,'user')} onSeek={editingClip?undefined:tick=>seek(tickToSeconds(timingProject,tick))}/>:<p className="piano-no-track">{locale==='zh-CN'?'选择一条 MIDI 轨道来编辑音符。Return 和 Master 没有音符。':'Select a MIDI track to edit notes. Return and Master have no notes.'}</p>}
  </WorkspacePanel></main><StudioSidebar zh={locale==='zh-CN'} inspectorKey={projectInstance.current} hardware={<HexblocksPanel zh={locale==='zh-CN'} connected={hexblocks.connected} active={hexblocks.active} connectors={hexblocks.connectors} config={hexblocks.config} error={hexblocks.error} claim={hexblocks.claim} options={mappingOptions()} mappingRequest={mappingRequest} mappings={project.hardwareMappings??[]} onMap={draft=>{mapHardware(draft);}} onRemove={removeMapping} onToggle={id=>commitMappings((project.hardwareMappings??[]).map(m=>m.id===id?{...m,enabled:!m.enabled}:m))} targetLabel={targetLabel} busy={busy||assistantTurn.current} targetValid={m=>!!targetForMapping(m)}/>}>{heading=><Assistant heading={heading} projectScope={editorState.current.conversationProject!} onUserGesture={()=>{void engine.current.resumeAudio().catch(()=>{});}} key={projectInstance.current} locale={locale} context={{generation:generation.current,selection:assistantTarget}} getContext={snapshot} execute={musicCommand}/>}</StudioSidebar></div>
  <dialog ref={clipRenameDialog} className="parameter-menu clip-rename" aria-label={locale==='zh-CN'?'重命名 Clip':'Rename clip'} onClose={()=>{clipNameInput.current?.setCustomValidity('');setRenameTarget(null);}} style={renameTarget?{left:Math.max(4,Math.min(renameTarget.x,window.innerWidth-250)),top:Math.max(4,Math.min(renameTarget.y,window.innerHeight-110))}:undefined} onClick={e=>{if(e.target===e.currentTarget)clipRenameDialog.current?.close();}}>
   <form onSubmit={submitClipName}><label>{locale==='zh-CN'?'Clip 名称':'Clip name'}<input ref={clipNameInput} required onInput={e=>e.currentTarget.setCustomValidity('')}/></label>
   <button type="submit">{locale==='zh-CN'?'重命名':'Rename'}</button></form>
  </dialog>
  <dialog ref={trackDialog} className="effect-picker"><h3>{locale==='zh-CN'?'轨道操作':'Track actions'}</h3><input aria-label="Track name" value={rename} onChange={e=>setRename(e.target.value)}/><button aria-label="Rename track" onClick={()=>menuAction('rename_track')}>{locale==='zh-CN'?'重命名':'Rename'}</button><button aria-label="Duplicate track" onClick={()=>menuAction('duplicate_track')}>{locale==='zh-CN'?'复制轨道':'Duplicate'}</button><button aria-label="Delete track" onClick={()=>menuAction('delete_track')}>{locale==='zh-CN'?'删除轨道…':'Delete…'}</button><button onClick={()=>trackDialog.current?.close()}>×</button></dialog><dialog ref={addDialog} className="effect-picker"><h3>{locale==='zh-CN'?'添加轨道':'Add track'}</h3><input aria-label="New track name" placeholder="Track name" value={newName} onChange={e=>setNewName(e.target.value)}/><p>{locale==='zh-CN'?'空白 Faust 乐器轨道，不含 MIDI 音符。':'Empty Faust instrument track; no MIDI notes.'}</p><button disabled={busy} onClick={()=>{addDialog.current?.close();void trackAction('add_track',undefined,newName).catch(e=>setError(String(e)));}}>＋ {locale==='zh-CN'?'添加':'Add'}</button><button onClick={()=>addDialog.current?.close()}>{locale==='zh-CN'?'取消':'Cancel'}</button></dialog>
  {historyOpen&&<aside className="history-panel"><header><strong>{locale==='zh-CN'?'工程历史':'Project history'}</strong><button onClick={()=>setHistoryOpen(false)}>×</button></header><div><button disabled={!ready||busy||assistantTurn.current} onClick={()=>projectAction(exportProject)}>{locale==='zh-CN'?'导出 ZIP':'Export ZIP'}</button><label><input type="checkbox" checked={includeHistory} onChange={e=>setIncludeHistory(e.target.checked)}/>{locale==='zh-CN'?'附带撤销历史':'Include history'}</label><label><input type="checkbox" checked={includeChat} onChange={e=>setIncludeChat(e.target.checked)}/>{locale==='zh-CN'?'附带聊天文本':'Include conversation text'}</label><button disabled={busy||assistantTurn.current} onClick={()=>importInput.current?.click()}>{locale==='zh-CN'?'导入工程':'Import project'}</button><button disabled={busy||assistantTurn.current} onClick={()=>{checkpoint();download({format:'shallowgroove-history',version:1,...history.current},'ShallowGroove.history.json');}}>{locale==='zh-CN'?'导出历史':'Export history'}</button></div>{sharedChat.length>0&&<details><summary>{locale==='zh-CN'?'随工程分享的对话':'Shared conversation'}</summary>{sharedChat.map((m,i)=><p key={i}><b>{m.role}</b> {m.text}</p>)}</details>}<ol>{history.current.entries.map((e,i)=><li key={i} className={i>=history.current.cursor?'undone':''}>{i+1}. {e.label} · {e.source==='assistant'?'AI':locale==='zh-CN'?'你':'You'} · {new Date(e.time).toLocaleTimeString()}</li>)}</ol></aside>}
  <dialog ref={parameterDialog} className="parameter-menu" aria-label="Parameter actions" style={parameterFocus?{left:Math.max(8,Math.min(parameterFocus.x,window.innerWidth-260)),top:Math.max(8,Math.min(parameterFocus.y,window.innerHeight-160))}:undefined} onClick={e=>{if(e.target===e.currentTarget)parameterDialog.current?.close();}}><small>{parameterFocus?parameterIdentity(parameterFocus)?.option.lane.label:''}</small><button onClick={()=>parameterAction('automation')}>Automation</button><button onClick={()=>parameterAction('mapping')}>{locale==='zh-CN'?'映射到 Hexblocks':'Map to Hexblocks'}</button></dialog>
  {recordNotice&&<div className="record-toast" role="status">{recordNotice.text}</div>}
  <footer><button onClick={()=>setHistoryOpen(v=>!v)}>{locale==='zh-CN'?'历史 / 保存':'History / Save'}</button><span className="selection-status" title={targetLabel}>{locale==='zh-CN'?'当前选择':'Selected'} · {targetLabel}</span><span><i className={ready?'status ready':'status'}/>{ready?'Web Audio / Faust WASM':'Audio not enabled'}<span aria-live="polite" className="audio-state">{audioState}</span></span><span>{ready?`${engine.current.context?.sampleRate} Hz · 16 voices / track`:'MIDI project loaded'}<button disabled={typeof selected!=='number'} onClick={()=>{setCollapsed(c=>({...c,overview:false}));setShowInfo(!showInfo);}}>{locale==='zh-CN'?'轨道说明':'Track info'}</button><b>{saveStatus}</b></span><span className="app-version" aria-label="Application version" data-app-version={appVersion}>v{appVersion}</span></footer>
 </div>{fileInput}{library.dialog}{versionsOpen&&library.state.id&&<ProjectVersions id={library.state.id} zh={locale==='zh-CN'} close={()=>setVersionsOpen(false)} pause={()=>{engine.current.pause();setPlaying(false);}} save={()=>library.manager.save()} load={text=>library.manager.reloadVersion(text)} chat={()=>readableChat(transcript.current)}/>}</>;
}
