import type {MeterSegment} from './meter';
export const divisions=['4 bars','2 bars','1 bar','1/2','1/4','1/8','1/16','1/32'] as const;
export type Division=typeof divisions[number];
export type Grid={mode:'auto'|'off'|Division;triplet:boolean};
function stride(unit:Division,triplet:boolean,ppqn:number,meter:MeterSegment){
 return unit.includes('/')?ppqn*4/Number(unit.slice(2))*(triplet?2/3:1):parseInt(unit)*meter.ticksPerBar;
}
export function autoDivision(ticksPerPixel:number,ppqn:number,meter:MeterSegment,triplet:boolean):Division{
 return [...divisions].reverse().find(unit=>stride(unit,triplet,ppqn,meter)>=ticksPerPixel*18)??divisions[0];
}
// Bar changes restart the grid. Note divisions restart at each downbeat, including shortened bars.
function interval(meters:MeterSegment[],ppqn:number,tick:number,unit:Division,triplet:boolean){
 let i=0;while(i+1<meters.length&&meters[i+1].tick<=tick)i++;
 const meter=meters[i],step=stride(unit,triplet,ppqn,meter),byNote=unit.includes('/');
 const start=byNote?meter.tick+Math.floor((tick-meter.tick)/meter.ticksPerBar)*meter.ticksPerBar:meter.tick;
 const stop=Math.min(meters[i+1]?.tick??Infinity,byNote?start+meter.ticksPerBar:Infinity);
 const lower=start+Math.floor((tick-start)/step)*step;
 return [lower,Math.min(stop,lower+step)];
}
export function gridTick(meters:MeterSegment[],ppqn:number,tick:number,unit:Division|'off',triplet:boolean,max=Infinity){
 const t=Math.min(max,Math.max(0,tick));
 if(unit==='off')return Math.round(t);
 const [a,b]=interval(meters,ppqn,t,unit,triplet),end=Math.min(b,max);
 return Math.round(t-a<end-t?a:end);
}
export function gridMarks(meters:MeterSegment[],ppqn:number,start:number,end:number,unit:Division|'off',triplet:boolean,pixels:number){
 const marks:number[]=[];
 if(unit==='off'||pixels<=0||end<=start)return marks;
 // At coarse zoom skip visually indistinguishable lines without changing the snap resolution.
 const spacing=(end-start)*6/pixels;
 for(let tick=start;tick<=end;){
  const [lo,hi]=interval(meters,ppqn,tick,unit,triplet),point=lo>=tick-.000001?lo:hi;
  if(point>end)break;
  marks.push(point);tick=point+Math.max(.001,spacing);
 }
 return marks;
}
