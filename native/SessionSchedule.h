#pragma once
#include "Timeline.h"

namespace sg::standalone {
using QueuedSlots=std::vector<std::pair<size_t,SlotChange>>;
inline Midi readMidi(const juce::var& v){
 return {0,uint8_t(number(v["status"],128,239)),uint8_t(field(v,"data1",0,0,127)),uint8_t(field(v,"data2",0,0,127))};
}
inline QueuedSlots prepareSlots(const Timeline& t,const juce::var& slots,int64_t at,int64_t arrangeAt){
 const auto* rows=slots.getArray();
 if(!rows||size_t(rows->size())>t.tracks.size())throw std::runtime_error("Invalid Session slots");
 if(t.loop&&arrangeAt>=t.loopB)arrangeAt=t.loopA+(arrangeAt-t.loopA)%(t.loopB-t.loopA);
 QueuedSlots result;std::set<size_t> targets;
 for(const auto& row:*rows){
  auto index=t.targetIndex(row["track"]);
  if(index>=t.tracks.size()||!targets.insert(index).second)throw std::runtime_error("Invalid Session track");
  SlotChange clip;clip.at=at;clip.arrangement=bool(row["arrangement"]);
  if(clip.arrangement){
   for(auto& e:t.chase(arrangeAt))if(!e.parameter&&e.track==index)clip.chase.push_back(e.midi);
  }else{
   clip.duration=t.frames(number(row["duration"],0,1e9));clip.phase=t.frames(field(row,"phase",0,0,1e9));
   if(!t.metronome.grid.empty()&&row.hasProperty("lengthTicks")){
    clip.lengthTicks=number(row["lengthTicks"],0,1e12);
    if(clip.lengthTicks>0&&clip.lengthTicks<1)throw std::runtime_error("Session clips need at least one tick");
    clip.phaseTicks=field(row,"phaseTicks",0,0,1e12);
    if(clip.lengthTicks>0)clip.phaseTicks=std::fmod(clip.phaseTicks,clip.lengthTicks);
   }
   if(clip.duration>0)clip.phase%=clip.duration;
   else if(clip.phase!=0)throw std::runtime_error("An empty slot cannot have a phase");
   const auto* notes=row["events"].getArray();
   if(!notes||notes->size()>200000)throw std::runtime_error("Invalid Session clip");
   for(const auto& item:*notes){
    const auto when=t.frames(number(item["time"],0,1e9));
    const auto tick=clip.lengthTicks>0?number(item["tick"],0,1e12):0;
    if(clip.lengthTicks>0?tick<clip.lengthTicks:when<clip.duration)clip.notes.push_back({when,readMidi(item),tick});
   }
   std::stable_sort(clip.notes.begin(),clip.notes.end(),[&](auto& a,auto& b){return clip.lengthTicks>0?a.tick<b.tick:a.frame<b.frame;});
   if(clip.phase||clip.phaseTicks>0){
    Timeline source(t.rate);
    for(auto& m:clip.notes)source.events.push_back({clip.lengthTicks>0?std::llround(m.tick*1024):m.frame,index,false,m.message,{}});
    for(auto& e:source.chase(clip.lengthTicks>0?std::llround(clip.phaseTicks*1024):clip.phase))clip.chase.push_back(e.midi);
   }
  }
  result.emplace_back(index,std::move(clip));
 }
 return result;
}
inline void publishSlots(Timeline& t,QueuedSlots& prepared){
 for(auto& [index,change]:prepared){
  auto& track=t.tracks[index];
  // Headless playback, and a UI launch racing the first audio callback, can
  // queue a future transition before the current slot's first block.
  if(track.slot.queued&&track.slot.next.at<=t.sessionFrame&&change.at>t.sessionFrame)
   track.slot.transition(t.sessionFrame,track.live,t.clipClock());
  track.notes.reserve(track.noteBudget+change.notes.size()+change.chase.size()+16);
  track.slot.next=std::move(change);track.slot.queued=true;
 }
}
}
