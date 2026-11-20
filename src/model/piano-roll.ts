import type {Note} from './project';
export type RollNote=Note&{id:string};
export const gridTicks=(ppqn:number,division:number)=>division===0?1:Math.max(1,Math.round(ppqn*4/division));
export const snapTick=(tick:number,step:number)=>Math.max(0,Math.round(tick/step)*step);
export function moveNotes(notes:RollNote[],deltaTick:number,deltaPitch:number){
 if(!notes.length)return [];
 const time=Math.max(deltaTick,-Math.min(...notes.map(n=>n.tick))),pitch=Math.max(-Math.min(...notes.map(n=>n.pitch)),Math.min(deltaPitch,127-Math.max(...notes.map(n=>n.pitch))));
 return notes.map(n=>({id:n.id,tick:n.tick+time,end:n.end+time,pitch:n.pitch+pitch}));
}
export function resizeNotes(notes:RollNote[],delta:number,minimum:number){
 const clamped=Math.max(delta,...notes.map(n=>Math.min(minimum,n.end-n.tick)-(n.end-n.tick)));
 return notes.map(n=>({id:n.id,end:n.end+clamped}));
}
export function pointToNote(x:number,y:number,keys:number,ruler:number,row:number,quarterWidth:number,ppqn:number){
 return {tick:Math.max(0,Math.round((x-keys)/quarterWidth*ppqn)),pitch:Math.max(0,Math.min(127,127-Math.floor((y-ruler)/row)))};
}
