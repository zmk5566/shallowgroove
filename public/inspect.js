import {drawInspector} from './inspect-plots.js';
import {createSpectrogram} from './spectrogram.js';
const bus=new BroadcastChannel(location.hash.slice(1));
const modes=['wave','spectrum','spectrogram','performance'];
const panels=new Map();
const heading=document.querySelector('h1');
const theme=getComputedStyle(document.documentElement);
const color=key=>theme.getPropertyValue('--'+key).trim();
const grid=color('line'),inputColor=color('muted'),outputColor=color('signal');
let zh,effect,rate,paintSpectrogram;
function setup(info){
 ({zh,effect,rate}=info);
 document.documentElement.lang=zh?'zh-CN':'en';
 document.title=heading.title=heading.textContent=info.title;
 const names=zh?['波形','频谱','声谱图','性能']:['Waveform','Spectrum','Spectrogram','Performance'];
 modes.forEach((mode,i)=>{
  const label=document.querySelectorAll('nav label')[i],toggle=label.querySelector('input');
  if(mode==='performance'&&info.canBenchmark===false){label.remove();return;}
  label.querySelector('span').textContent=' '+names[i];toggle.disabled=false;
  const panel=document.createElement('figure'),caption=document.createElement('figcaption');
  panel.className=mode;panel.hidden=true;caption.textContent=names[i];panel.append(caption);
  if(mode==='performance'){
   const detail=document.createElement('small');
   detail.textContent=(zh?'离线 DSP 测试 · ':'Offline DSP benchmark · ')+(effect?'440 Hz':zh?'单音 C4':'one note, C4')+' · '+rate+' Hz · '+(zh?'耗时 / 音频时长':'render time / audio duration');
   panel.append(detail,document.createElement('output'));
  }else{
   const canvas=document.createElement('canvas'),axis=document.createElement('small');
   canvas.setAttribute('role','img');canvas.setAttribute('aria-label',names[i]);
   const output=zh?'输出':'Output',input=zh?'输入':'Input';
   axis.textContent=(effect?input+' (┄) / ':'')+output+' (●) · '+(mode==='wave'?'0 – '+(1024/rate*1000).toFixed(1)+' ms':'20 Hz – '+(rate/2000).toFixed(1)+' kHz · −100 … −30 dB');
   if(mode==='spectrogram')axis.textContent=output+' · 8 s → · 20 Hz ↑ '+(rate/2000).toFixed(1)+' kHz';
   axis.className='legend';panel.append(canvas,axis);
  }
  const updateMode=()=>{
   panel.hidden=!toggle.checked;
   if(mode==='spectrogram'){
    paintSpectrogram=toggle.checked?createSpectrogram(panel.querySelector('canvas'),rate,[color('bg'),color('line'),color('signal'),color('ink')]):undefined;
   }
   if(mode==='performance')panel.querySelector('output').textContent=zh?'测量中…':'Measuring…';
   bus.postMessage({mode,enabled:toggle.checked});
  };
  toggle.onchange=updateMode;
  panels.set(mode,panel);document.querySelector(mode==='performance'?'main':'.plots').append(panel);
  toggle.checked=info.modes?info.modes.includes(mode):mode!=='performance';
  if(toggle.checked)updateMode();
 });
}
bus.onmessage=({data})=>{
 if(data.title){
  clearInterval(retry);document.querySelector('[role=status]').hidden=true;
  if(!panels.size)setup(data);
  return;
 }
 const panel=panels.get(data.mode);
 if(!panel||panel.hidden)return;
 if(data.mode==='performance'){
  panel.querySelector('output').textContent=data.error??((zh?'平均 ':'Mean ')+data.average.toFixed(2)+'% · '+(zh?'峰值 ':'Peak ')+data.peak.toFixed(2)+'%');
 }else if(data.mode==='spectrogram'){
  paintSpectrogram?.(data.lines[0],data.seconds);
 }else drawInspector(panel.querySelector('canvas'),data.mode,data.lines,rate,effect,{grid,input:inputColor,output:outputColor});
};
window.addEventListener('pagehide',()=>{bus.postMessage({close:true});bus.close();},{once:true});
let attempts=0;
const retry=setInterval(()=>{
 if(++attempts===10)document.querySelector('[role=status]').textContent='等待主窗口响应。可关闭并重新检查。 · Waiting for the main window. Close and reopen to retry.';
 bus.postMessage({ready:true});
},500);
bus.postMessage({ready:true});
