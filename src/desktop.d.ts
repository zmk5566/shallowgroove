import type {LibraryEntry,LibraryPatch,LibraryRef} from './model/user-library';
import type {ProjectDraft,ProjectRecord} from './model/project-files';
export type MusicVersions={branch:string;head:string;remote:string;remoteBranches:string[];branches:string[];commits:{graph:string;id:string;parents:string;refs:string;title:string}[]};
export type VersionCommand={action:'status'|'link'|'fetch'|'init'|'checkpoint'|'preview'|'branch'|'switch'|'pull'|'push'|'remote';name?:string;url?:string;commit?:string;chat?:unknown[]};
declare global {
 interface Window {
  sgOsc?: import("./hardware/performance-signals").OscBridge;
  sgNativeAudio?: import("./audio/native-preview").NativeBridge;
  shallowgrooveDesktop?: {
   testAssistantKey:()=>Promise<'ok'|'invalid'|'network'|'storage'>;
   setAssistantKey:(key:string|null)=>Promise<'ok'|'invalid'|'network'|'storage'|'busy'>;
   assistantStorageIssue:()=>Promise<boolean>;
   exportAudio:(options:{name:string;sampleRate:number;bitDepth:number;engine:'native'|'web';graph:ReturnType<typeof import('./audio/native-preview').nativeGraph>;sequence:ReturnType<typeof import('./audio/native-preview').nativeSequence>})=>Promise<string|null>;
   cancelAudioExport:()=>Promise<void>;
   setAudioExportAvailable:(yes:boolean)=>void;
   onAudioExportProgress:(fn:(percent:number)=>void)=>()=>void;
   libraryList:()=>Promise<LibraryEntry[]>;
   librarySave:(name:string,patch:LibraryPatch,previous?:LibraryRef)=>Promise<LibraryEntry>;
   projectList:()=>Promise<ProjectRecord[]>;
   projectRead:(id:string)=>Promise<{record:ProjectRecord;text:string}>;
   projectSave:(text:string,name:string,id:string|null)=>Promise<ProjectRecord|null>;
   projectClone:(url:string)=>Promise<{record:ProjectRecord;text:string}|null>;
   projectVersion:(id:string,cmd:VersionCommand)=>Promise<{state?:MusicVersions;text?:string;source?:{url:string;commit:string}}>;
   projectOpen:()=>Promise<{record:ProjectRecord;text:string}|null>;
   projectDraft:(value?:ProjectDraft|null)=>Promise<ProjectDraft|null>;
   projectDirty:(dirty:boolean)=>void;
   projectAllowClose:()=>void;
   onProjectAction:(callback:(action:string)=>void)=>(()=>void);
   openInspector:(id:string)=>Promise<void>;
   closeInspector:(id:string)=>void;
   onInspectorClosed:(callback:(id:string)=>void)=>()=>void;
   openSource:(href:string)=>Promise<void>;
   initialLocale?:'zh-CN'|'en'|null;
   openConnect:(locale:'zh-CN'|'en')=>Promise<boolean>;
   setConnectLocale:(locale:'zh-CN'|'en')=>Promise<boolean>;
   connectStatus:()=>Promise<{phase:'starting'|'running'|'error';message:string}>;
  };
 }
}
