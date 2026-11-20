export function drawInspector(canvas,mode,lines,rate,effect,colors){
 const w=canvas.clientWidth,h=canvas.clientHeight,scale=window.devicePixelRatio||1;
 if(!w||!h)return;
 const width=Math.round(w*scale),height=Math.round(h*scale);
 if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
 const g=canvas.getContext('2d');
 g.setTransform(scale,0,0,scale,0,0);
 g.clearRect(0,0,w,h);g.strokeStyle=colors.grid;g.setLineDash([]);
 g.beginPath();for(const y of [h/4,h/2,3*h/4]){g.moveTo(0,y);g.lineTo(w,y);}g.stroke();
 lines.forEach((samples,index)=>{
  const input=effect&&index===0;
  g.strokeStyle=input?colors.input:colors.output;g.lineWidth=input?1:1.5;g.setLineDash(input?[7,5]:[]);g.beginPath();
  for(let x=0;x<w;x++){
   const t=x/Math.max(1,w-1);
   const bin=mode==='wave'?Math.floor(t*(samples.length-1)):Math.min(samples.length-1,Math.round(20*(rate/40)**t*4096/rate));
   const y=h*(1-samples[bin]/255);
   if(x===0)g.moveTo(x,y);else g.lineTo(x,y);
  }
  g.stroke();
 });
}
