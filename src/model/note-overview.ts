import {notesOf,type Track} from './project.ts';

// Coordinates match the arrangement's 1000-unit SVG viewBox.
const width=1000;
export function overviewWindow(start:number,span:number){
 const tiles=2**Math.floor(Math.log2(1/span));
 const padding=span/8;
 return {
  left:width*Math.max(0,Math.floor((start-padding)*tiles))/tiles,
  right:width*Math.min(tiles,Math.ceil((start+span+padding)*tiles))/tiles
 };
}

export function indexNoteOverview(events:Track['events'],endTick:number,duration:number,toSeconds:(tick:number)=>number){
 const scale=width/(duration||1);
 const notes=notesOf({events},endTick).map(note=>{
  const x=toSeconds(note.tick)*scale;
  return {x,right:x+Math.max(.5,toSeconds(note.end)*scale-x),y:36-(note.pitch-24)/84*30,velocity:note.velocity};
 }).sort((a,b)=>a.x-b.x);
 let maxRight=0;
 const ends=notes.map(note=>maxRight=Math.max(maxRight,note.right));
 return {notes,ends};
}

export function overviewPaths({notes,ends}:ReturnType<typeof indexNoteOverview>,left:number,right:number){
 // Prefix maxima include sustained notes that began before the visible range.
 let lo=0,hi=ends.length;
 while(lo<hi){
  const mid=Math.floor((lo+hi)/2);
  if(ends[mid]<=left)lo=mid+1;else hi=mid;
 }
 const groups=new Map<number,string[]>();
 for(let i=lo;i<notes.length&&notes[i].x<right;i++){
  const n=notes[i];if(n.right<=left)continue;
  let parts=groups.get(n.velocity);
  if(!parts){parts=[];groups.set(n.velocity,parts);}
  parts.push(`M${n.x} ${n.y}H${n.right}v2.5H${n.x}Z`);
 }
 return Array.from(groups,([velocity,parts])=>({velocity,d:parts.join('')}));
}
