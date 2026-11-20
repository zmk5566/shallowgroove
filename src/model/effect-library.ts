type Preset={id:string;zh:string;en:string;values:Record<string,number>};
function preset(id:string,zh:string,en:string,values:Record<string,number>):Preset{return {id,zh,en,values};}
export const effectLibrary={
 compressor:{zh:'压缩器',en:'Compressor',presets:[
  preset('gentle','轻柔压缩','Gentle compression',{Threshold:-16,Ratio:2,Attack:25,Release:180}),
  preset('drum-punch','保留鼓头冲击','Drum punch',{Threshold:-20,Ratio:4,Attack:35,Release:80}),
  preset('even-bass','贝斯力度均衡','Even bass',{Threshold:-22,Ratio:5,Attack:8,Release:160})]},
 delay:{zh:'延迟',en:'Delay',presets:[
  preset('slapback','短回声','Slapback',{Sync:0,Time:95,Feedback:.08,Mix:.18}),
  preset('eighth','八分音符回声','Eighth-note echo',{Sync:1,Division:1,Feedback:.3,Mix:.24}),
  preset('dotted-eighth','附点八分延迟','Dotted eighth',{Sync:1,Division:2,Feedback:.42,Mix:.29})]},
 reverb:{zh:'混响',en:'Reverb',presets:[
  preset('drum-room','紧凑鼓房','Drum room',{Room:.22,Damping:.62,'Pre-delay':5,Mix:.14}),
  preset('short-space','短尾空间','Short space',{Room:.42,Damping:.54,'Pre-delay':14,Mix:.2}),
  preset('long-ambient','长尾氛围','Long ambience',{Room:.92,Damping:.32,'Pre-delay':38,Mix:.38})]},
 eq:{zh:'均衡器',en:'EQ',presets:[
  preset('low-cut','清理低频','Low cut',{'Low Cut':85}),
  preset('clear-mud','削减中低频','Clear low mids',{'Mid Frequency':320,Mid:-4}),
  preset('air','提亮高频','Air',{High:4})]},
 filter:{zh:'自动滤波',en:'Auto Filter',presets:[
  preset('low-sweep','低通扫频','Low-pass sweep',{Cutoff:1250,Depth:2,Rate:.6}),
  preset('slow-motion','缓慢往返扫频','Slow motion',{Cutoff:850,Depth:2.6,Rate:.12}),
  preset('beat-pulse','节拍脉冲','Beat pulse',{Cutoff:680,Depth:2,Sync:1})]},
 saturator:{zh:'饱和器',en:'Saturator',presets:[
  preset('warm','轻微暖化','Subtle warmth',{Drive:3,Output:-2,Mix:.6}),
  preset('bass-harmonics','贝斯增加谐波','Bass harmonics',{Drive:10,Output:-6,Mix:.7}),
  preset('drum-drive','鼓组过载','Drum drive',{Drive:18,Output:-9,Mix:.8})]},
 chorus:{zh:'合唱',en:'Chorus',presets:[
  preset('synth-width','合成器加宽','Synth width',{Rate:.45,Depth:3,Mix:.35}),
  preset('string-ensemble','弦乐合奏','String ensemble',{Rate:.85,Depth:5,Mix:.48}),
  preset('detune','轻微失谐','Gentle detune',{Rate:.3,Depth:2,Mix:.24})]},
 utility:{zh:'立体声工具',en:'Utility',presets:[
  preset('mono','单声道检查','Mono check',{Width:0}),
  preset('narrow','收窄立体声','Narrow stereo',{Width:55}),
  preset('minus-six','降低 6 dB','Trim −6 dB',{Gain:-6})]}
};
export type LibraryKind=keyof typeof effectLibrary;
export const libraryKinds=Object.keys(effectLibrary) as LibraryKind[];
export function findPreset(kind:LibraryKind|'custom',id:string){
 const found=kind!=='custom'&&effectLibrary[kind]?.presets.find(p=>p.id===id);
 if(!found)throw Error('Unknown effect preset: '+kind+'/'+id);
 return found;
}
