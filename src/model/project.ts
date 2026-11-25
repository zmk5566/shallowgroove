import type {PerformanceGraph} from './performance';
import type {Scene} from './scenes';
import type {Clip,ClipRef} from './clips';
import type {HardwareMapping} from './hardware';
import type {AutomationLane} from './automation';
export interface MidiEvent {clipRef?:string;tick:number; order:number; kind:string; status?:number; channel?:number; type?:number; data:number[]}
export interface TrackAnnotation {instrument:string;basis:string;initial_program:{program_zero_based:number;bank_msb:number;bank_lsb:number}|null;program_history:unknown[];rhythm_map:number;note_count:number;pitch_range:number[]|null;role:string|null;role_source:string|null}
export interface Track {clipRefs?:ClipRef[];user_named?:boolean;annotation?:TrackAnnotation;id:string; name:string; midi_channel:number; events:MidiEvent[]; gain:number; pan:number; mute:boolean; solo:boolean}
export interface Project {performance?:PerformanceGraph;scenes?:Scene[];clips?:Clip[];hardwareMappings?:HardwareMapping[];automation?:AutomationLane[];title:string; schema:string; timing:{bpm?:number;ppqn:number; end_tick:number; default_tempo_us_per_quarter:number}; global_events:MidiEvent[]; tracks:Track[]}
export interface Note {tick:number; end:number; pitch:number; velocity:number}
export const isTempoTarget=(target:{trackId:string;device:string;address:string})=>target.trackId==='master'&&target.device==='mixer'&&target.address==='bpm';
export type TempoPoint={tick:number;seconds:number;tempo:number;slope?:number};
export function tempoSeconds(point:TempoPoint,ticks:number,ppqn:number){const bpm=60e6/point.tempo,slope=point.slope??0;return Math.abs(slope)<1e-12?ticks*60/(ppqn*bpm):60*Math.log1p(slope*ticks/bpm)/(ppqn*slope);}
export function tempoTicks(point:TempoPoint,seconds:number,ppqn:number){const bpm=60e6/point.tempo,slope=point.slope??0;return Math.abs(slope)<1e-12?seconds*ppqn*bpm/60:bpm*Math.expm1(seconds*ppqn*slope/60)/slope;}
export function tempoMap(project:Project):TempoPoint[] {
  const lane=project.automation?.find(l=>isTempoTarget(l)&&l.mode==='read'&&l.points.length);
  if(lane){
    const ps=lane.points[0].tick===0?lane.points:[{...lane.points[0],tick:0},...lane.points];
    const points:TempoPoint[]=[];let seconds=0;
    for(let i=0;i<ps.length;i++){const p=ps[i],next=ps[i+1],bpm=lane.min+(lane.max-lane.min)*p.value;
      const slope=lane.interpolation==='linear'&&next?(lane.max-lane.min)*(next.value-p.value)/(next.tick-p.tick):0;
      const point={tick:p.tick,seconds,tempo:60e6/bpm,slope};points.push(point);if(next)seconds+=tempoSeconds(point,next.tick-p.tick,project.timing.ppqn);
    }return points;
  }
  if(project.timing.bpm!==undefined)return [{tick:0,seconds:0,tempo:60e6/project.timing.bpm}];
  let tick=0, seconds=0, tempo=project.timing.default_tempo_us_per_quarter;
  const points=[{tick,seconds,tempo}];
  for(const e of project.global_events.filter(e=>e.kind==='meta'&&e.type===81).sort((a,b)=>a.tick-b.tick||a.order-b.order)) {
    seconds+=(e.tick-tick)*tempo/project.timing.ppqn/1e6; tick=e.tick;
    tempo=(e.data[0]<<16)+(e.data[1]<<8)+e.data[2]; points.push({tick,seconds,tempo});
  }
  return points;
}
export function tickToSeconds(project:Project, tick:number) {
  const points=tempoMap(project); let point=points[0];
  for(const p of points) {if(p.tick>tick) break; point=p;}
  return point.seconds+tempoSeconds(point,tick-point.tick,project.timing.ppqn);
}
export function timeline(project:Project) {
  const points=tempoMap(project); let index=0;
  return project.tracks.flatMap((track,trackIndex)=>track.events.map(event=>({...event,trackIndex})))
    .sort((a,b)=>a.tick-b.tick||a.order-b.order).map(e=>{
      while(index+1<points.length&&points[index+1].tick<=e.tick) index++;
      const p=points[index];return {...e,seconds:p.seconds+tempoSeconds(p,e.tick-p.tick,project.timing.ppqn)};
    });
}
export function notesOf(track:Pick<Track,'events'>,endTick:number):Note[] {
 const held=new Map<number, MidiEvent[]>(), notes:Note[]=[];
 for(const e of track.events){const kind=(e.status??0)>>4,pitch=e.data[0];
   if(kind===9&&e.data[1]>0){const q=held.get(pitch)??[];q.push(e);held.set(pitch,q);}
   else if(kind===8||(kind===9&&e.data[1]===0)){const start=held.get(pitch)?.shift();if(start)notes.push({tick:start.tick,end:e.tick,pitch,velocity:start.data[1]});}
 }
 for(const [pitch,events] of held)for(const e of events)notes.push({tick:e.tick,end:endTick,pitch,velocity:e.data[1]});
 return notes;
}
