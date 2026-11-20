import type {Project} from './project';
export interface MeterSegment {tick:number;bar:number;numerator:number;denominator:number;ticksPerBeat:number;ticksPerBar:number;assumed:boolean}
/** Bar/beat numbers are one-based. A changed meter starts a new bar;
 * if it occurs mid-bar, the preceding bar is shortened. Redundant events do not reset it. */
export function meterMap(project:Project):MeterSegment[]{
 const make=(tick:number,bar:number,numerator:number,denominator:number,assumed=false):MeterSegment=>({tick,bar,numerator,denominator,ticksPerBeat:project.timing.ppqn*4/denominator,ticksPerBar:project.timing.ppqn*4/denominator*numerator,assumed});
 const points=[make(0,1,4,4,true)];
 for(const e of project.global_events.filter(e=>e.kind==='meta'&&e.type===88).sort((a,b)=>a.tick-b.tick||a.order-b.order)){
  const [n,power]=e.data;if(!Number.isInteger(n)||n<1||!Number.isInteger(power)||power<0||power>7||e.tick<0)continue;
  const last=points.at(-1)!,denominator=2**power;
  if(e.tick===last.tick){points[points.length-1]=make(e.tick,last.bar,n,denominator);continue;}
  if(last.numerator===n&&last.denominator===denominator){continue;}
  points.push(make(e.tick,last.bar+Math.ceil((e.tick-last.tick)/last.ticksPerBar),n,denominator));
 }
 return points;
}
export function musicalPosition(project:Project,tick:number){
 return positionInMeter(meterMap(project),tick);
}
export function positionInMeter(points:MeterSegment[],tick:number){
 let meter=points[0];for(const p of points){if(p.tick>tick)break;meter=p;}
 const offset=Math.max(0,tick-meter.tick)+1e-7,barOffset=Math.floor(offset/meter.ticksPerBar),within=offset-barOffset*meter.ticksPerBar,beatOffset=Math.floor(within/meter.ticksPerBeat);
 return {bar:meter.bar+barOffset,beat:beatOffset+1,tick:Math.floor(within-beatOffset*meter.ticksPerBeat),numerator:meter.numerator,denominator:meter.denominator,assumed:meter.assumed};
}
export function musicalLabel(project:Project,tick:number){const p=musicalPosition(project,tick);return `${p.bar}.${p.beat}.${p.tick.toString().padStart(3,'0')}`;}
/** Sparse whole-project overview: keep meter changes and adapt bar labels to available width. */
export function barGrid(project:Project,maxLabels=12){
 const map=meterMap(project),last=musicalPosition(project,project.timing.end_tick).bar,stride=2**Math.max(0,Math.ceil(Math.log2(last/Math.max(2,maxLabels))));
 return map.flatMap((m,index)=>{
  const end=Math.min(project.timing.end_tick,map[index+1]?.tick??Infinity),marks:{tick:number;bar:number;meter:string;change:boolean}[]=[];
  marks.push({tick:m.tick,bar:m.bar,meter:`${m.numerator}/${m.denominator}`,change:index>0});
  let bar=1+Math.ceil(m.bar/stride)*stride;
  for(;m.tick+(bar-m.bar)*m.ticksPerBar<end;bar+=stride)marks.push({tick:m.tick+(bar-m.bar)*m.ticksPerBar,bar,meter:`${m.numerator}/${m.denominator}`,change:false});
  return marks.filter(p=>p.tick<=project.timing.end_tick);
 });
}

/** Musical bar bounds, including shortened bars at meter changes. */
export function barRange(project:Project,bar:number){
 if(!Number.isSafeInteger(bar)||bar<1)throw Error('bar must be a positive integer');
 const map=meterMap(project);let index=0;while(index+1<map.length&&map[index+1].bar<=bar)index++;
 const meter=map[index],startTick=meter.tick+(bar-meter.bar)*meter.ticksPerBar;
 const endTick=Math.min(startTick+meter.ticksPerBar,map[index+1]?.tick??Infinity);
 if(!Number.isSafeInteger(startTick)||!Number.isSafeInteger(endTick)||endTick>1e10)throw Error('Bar is outside supported MIDI tick range');
 return {bar,startTick,endTick};
}
