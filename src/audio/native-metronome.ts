import {meterMap} from '../model/meter.ts';
import {tempoMap,tempoSeconds,type Project} from '../model/project.ts';

// Send only changes in tempo or meter. The native clock generates each beat.
export function nativeBeatGrid(project:Project){
 const tempos=tempoMap(project),meters=meterMap(project),ppqn=project.timing.ppqn;
 const ticks=[...new Set([...tempos,...meters].map(point=>point.tick))].sort((a,b)=>a-b);
 let t=0,m=0;
 return ticks.map(tick=>{
  while(t+1<tempos.length&&tempos[t+1].tick<=tick)t++;
  while(m+1<meters.length&&meters[m+1].tick<=tick)m++;
  const tempo=tempos[t],meter=meters[m],delta=tick-tempo.tick,slope=tempo.slope??0;
  return {seconds:tempo.seconds+tempoSeconds(tempo,delta,ppqn),tick,ppqn,bpm:60e6/tempo.tempo+slope*delta,slope,
   origin:meter.tick,step:meter.ticksPerBeat,beats:meter.numerator};
 });
}
