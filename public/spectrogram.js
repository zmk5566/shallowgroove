// 20 FFT frames per audio second. Keep history resolution independent of window size.
const columns=160, rows=128, framesPerSecond=20;

export function createSpectrogram(canvas,rate,colors){
 canvas.width=columns;
 canvas.height=rows;
 const context=canvas.getContext('2d');
 const column=context.createImageData(1,rows);
 const palette=colors.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
 const lut=Array.from({length:256},(_,i)=>{
  const t=i/255*(palette.length-1),a=Math.min(Math.floor(t),palette.length-2);
  return palette[a].map((value,c)=>Math.round(value+(palette[a+1][c]-value)*(t-a)));
 });
 let previous;
 return (bins,seconds)=>{
  const slot=Math.floor(seconds*framesPerSecond);
  if(slot===previous)return;
  const shift=previous===undefined||slot<previous?columns:Math.min(columns,slot-previous);
  previous=slot;
  if(shift<columns)context.drawImage(canvas,shift,0,columns-shift,rows,0,0,columns-shift,rows);
  context.clearRect(columns-shift,0,shift,rows);
  for(let y=0;y<rows;y++){
   const edge=t=>Math.min(bins.length-1,Math.floor(bins.length*(40/rate)**(t/rows)));
   const low=edge(y+1),high=Math.max(low+1,edge(y));
   let peak=0;
   for(let bin=low;bin<high;bin++)peak=Math.max(peak,bins[bin]);
   column.data.set(lut[peak],4*y);
   column.data[4*y+3]=255;
  }
  context.putImageData(column,columns-1,0);
 };
}
