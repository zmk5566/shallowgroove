import {useRef} from 'react';

export const daisyBellNotes={
 'zh-CN':[
  '1957 年，Max Mathews 在贝尔实验室开发了 MUSIC，用程序生成音乐。1961 年，John L. Kelly Jr. 和 Carol Lochbaum 让 IBM 704 合成了《Daisy Bell》的歌声；Mathews 为这次演示编写了音乐伴奏。后来，电影《2001 太空漫游》让 HAL 9000 在被关闭时唱起了这首歌。',
  'Harry Dacre 于 1892 年发表了《Daisy Bell》。这个工程取用所提供 MIDI 的副歌，按参考视频编成三拍子。簧管先奏四小节，电子琴独奏四小节伴奏型，合成歌声在第九小节进入。',
  '多年后，Miller Puckette 将自己的音乐编程环境命名为 Max，向 Mathews 致意。他尤其看重 Mathews 的实时调度系统 RTSKED，它影响了 Max 处理音乐事件的方式。',
  '展开第二轨的 Vowel 和 Frication 包络，可以编辑歌声的元音过渡和擦音。',
 ],
 en:[
  'In 1957 Max Mathews developed MUSIC at Bell Labs to generate music by computer. In 1961 John L. Kelly Jr. and Carol Lochbaum programmed an IBM 704 to sing Daisy Bell. Mathews programmed the musical accompaniment. In 2001: A Space Odyssey, HAL 9000 sings the song as it is disconnected.',
  'Harry Dacre published Daisy Bell in 1892. The supplied MIDI chorus is arranged in triple time after the reference video. Four bars of reed melody open the piece. The keys play alone for four bars before the singing voice enters in bar nine.',
  'Years later, Miller Puckette named his music programming environment Max in Mathews’s honor. Mathews’s real-time scheduler RTSKED was a particular influence on how Max handles musical events.',
  'Edit the Vowel and Frication lanes on track two to shape vowel transitions and consonants.'
 ]
};
const references=[
 ['Harry Dacre · 1892','https://old-digitalcollections.nypl.org/items/5e66b3e8-f4a2-d471-e040-e00a180654d7'],
 ['Library of Congress · Singing Circuits','https://blogs.loc.gov/now-see-hear/2014/05/singing-circuits/'],
 ['Library of Congress · Daisy Bell','https://www.loc.gov/static/programs/national-recording-preservation-board/documents/DaisyBell.pdf'],
 ['编曲参考 / Arrangement reference','https://www.youtube.com/watch?v=41U78QP8nBk'],
 ['Cycling ’74 · Max Mathews','https://cycling74.com/articles/max-mathews-an-appreciation']
];
export function DaisyBellNotes({zh}:{zh:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);
 return <><button onClick={()=>dialog.current?.showModal()}>{zh?'作品说明':'Song notes'}</button>
 <dialog ref={dialog} className="project-dialog daisy-notes" aria-labelledby="daisy-notes-title"><h2 id="daisy-notes-title">Daisy Bell (Demonstration of Envelope)</h2>
 {daisyBellNotes[zh?'zh-CN':'en'].map(p=><p key={p}>{p}</p>)}
 <ul>{references.map(([label,url])=><li key={url}><a href={url} target="_blank" rel="noreferrer" onClick={e=>{if(window.shallowgrooveDesktop){e.preventDefault();void window.shallowgrooveDesktop.openSource(url);}}}>{label}</a></li>)}</ul>
 <button onClick={()=>dialog.current?.close()}>{zh?'关闭':'Close'}</button></dialog></>;
}
