import {tempoMap,tickToSeconds,isTempoTarget,type Project} from './project.ts';
import {secondsToTick} from './automation.ts';
export const MIN_BPM=20,MAX_BPM=300;
export function validBpm(value:unknown):number{
 if(typeof value!=='number'||!Number.isFinite(value)||value<MIN_BPM||value>MAX_BPM)throw Error(`BPM must be between ${MIN_BPM} and ${MAX_BPM}`);
 return Math.round(value*100)/100;
}
export function bpmAtTick(project:Project,tick:number){const points=tempoMap(project);let point=points[0];for(const next of points){if(next.tick>tick)break;point=next;}return 60e6/point.tempo+(point.slope??0)*(tick-point.tick);}
export function withTempo(project:Project,bpm:number|null):Project{
 const timing={...project.timing};if(bpm===null)delete timing.bpm;else timing.bpm=validBpm(bpm);
 return {...project,timing,...(project.automation?{automation:project.automation.map(l=>isTempoTarget(l)?{...l,mode:'off' as const}:l)}:{})};
}
export function retimePosition(before:Project,after:Project,seconds:number){return tickToSeconds(after,secondsToTick(before,seconds));}
