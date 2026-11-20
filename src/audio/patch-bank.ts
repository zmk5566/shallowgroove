import korobeiniki from '../../patches/korobeiniki/manifest.json';
import daisy from '../../patches/daisy-bell/manifest.json';
import basic from './synth.dsp?raw';
const sources=import.meta.glob('../../patches/*/*.dsp',{query:'?raw',import:'default',eager:true}) as Record<string,string>;
export type SoundSet='period'|'basic';
export function periodYear(projectId:string){return projectId==='Korobeiniki'?'2018':projectId==='DaisyBell'?'1961':null;}
export function assignedPatch(projectId:string,trackId:string,soundSet:SoundSet){
 const bank=projectId==='Korobeiniki'?korobeiniki:projectId==='DaisyBell'?daisy:undefined;
 const directory=projectId==='Korobeiniki'?'korobeiniki':'daisy-bell';
 const patch=soundSet==='period'?bank?.patches.find(p=>p.track_id===trackId):undefined;
 return {sources:patch?bank!.sources.filter(s=>patch.source_refs.includes(s.id)):[],code:patch?sources[`../../patches/${directory}/${patch.file}`]:basic,patch};
}
