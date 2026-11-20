// Supply deterministic notes for browser checks that need a crowded mixer
// or a long track. This Vite plugin is only loaded by the two test scripts.
export function multitrackFixture() {
 const ppqn=480, bars=99;
 const tracks=Array.from({length:16},(_,index)=>{
  const channel=index+1, events=[];
  for(let note=0;note<bars*16;note++){
   const tick=note*120,pitch=72+note%16;
   events.push({kind:'midi',tick,order:2*note,channel,status:144+index,data:[pitch,80]},
               {kind:'midi',tick:tick+60,order:2*note+1,channel,status:128+index,data:[pitch,0]});
  }
  return {id:'midi-channel-'+channel,name:'Test track '+channel,midi_channel:channel,
          events,gain:1,pan:0,mute:false,solo:false};
 });
 return {name:'multitrack-test-fixture',enforce:'pre',load(id){
  if(id.split('?')[0].endsWith('/demo-projects/DaisyBell.json'))
   return JSON.stringify({schema:'shallowgroove.project.draft-1',title:'Test arrangement',
    timing:{ppqn,end_tick:bars*ppqn*4,default_tempo_us_per_quarter:500000},global_events:[],tracks});
 }};
}
