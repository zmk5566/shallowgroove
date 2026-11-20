import {parseMidi} from 'midi-file';

export interface ChatAttachment {name:string;content:string;truncated:boolean}
export const acceptedFiles='.mid,.midi,.xml,.musicxml,.txt,.md,.pdf';
const limit=24000;

function midiReference(bytes:Uint8Array){
 const {header,tracks}=parseMidi(bytes);
 if(!header.numTracks||tracks.length!==header.numTracks)throw Error('Invalid MIDI track count');
 const sampleLimit=Math.max(1,Math.min(96,Math.floor(640/tracks.length)));
 return JSON.stringify({header,noteSampleLimitPerTrack:sampleLimit,tracks:tracks.map((events,index)=>{
  let tick=0,notes=0;
  const sample:unknown[]=[],changes:unknown[]=[];
  for(const e of events){
   tick+=e.deltaTime;
   if(e.type==='noteOn'&&e.velocity){
    notes++;
    if(sample.length<sampleLimit)sample.push([tick,e.channel+1,e.noteNumber,e.velocity]);
   }
   if(['setTempo','timeSignature','programChange','keySignature'].includes(e.type)&&changes.length<64)changes.push({...e,tick});
  }
  return {track:index+1,name:events.find(e=>e.type==='trackName')?.text,endTick:tick,notes,changes,firstNotes_tick_channel_pitch_velocity:sample};
 })});
}

async function pdfReference(bytes:Uint8Array){
 const {getDocument,GlobalWorkerOptions}=await import('pdfjs-dist');
 GlobalWorkerOptions.workerSrc=(await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
 const task=getDocument({data:bytes,cMapUrl:'/pdf-cmaps/',cMapPacked:true,isEvalSupported:false,useSystemFonts:true});
 try{
  const pdf=await task.promise;
  let content='';
  for(let i=1;i<=pdf.numPages&&content.length<=limit;i++){
   const page=await pdf.getPage(i),text=await page.getTextContent();
   const lines=text.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim();
   if(lines)content+='[p. '+i+']\n'+lines+'\n';
   page.cleanup();
  }
  return content;
 }finally{await task.destroy();}
}

export async function readAttachment(file:File,zh:boolean):Promise<ChatAttachment>{
 const ext=file.name.split('.').pop()?.toLowerCase();
 if(!ext||!acceptedFiles.split(',').includes('.'+ext))throw Error(zh?'不支持此文件格式':'Unsupported file type');
 if(file.size>16*1024*1024)throw Error(zh?'单个附件上限为 16 MB':'Maximum file size is 16 MB');
 let content:string;
 if(ext==='mid'||ext==='midi')content=midiReference(new Uint8Array(await file.arrayBuffer()));
 else if(ext==='pdf')content=await pdfReference(new Uint8Array(await file.arrayBuffer()));
 else content=await file.text();
 if(!content.trim())throw Error(zh?'没有可读取的文字；扫描 PDF 需要先做 OCR。':'No readable text. Scanned PDFs require OCR.');
 const truncated=content.length>limit;
 return {name:file.name,content:truncated?content.slice(0,limit-16)+'\n[… truncated]':content,truncated};
}
