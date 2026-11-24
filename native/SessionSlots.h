#pragma once
#include "Core.h"
#include "Metronome.h"
#include <algorithm>
#include <cstdint>
#include <vector>

namespace sg::standalone {
// Map the arrangement clock onto continuous musical ticks. Loop boundaries
// change shift, so a clip keeps its phase as the local tempo map repeats.
struct ClipClock {
 const std::vector<BeatSegment>& grid;
 int64_t frame;
 double rate,shift;
 double tick(double offset=0)const{
  if(grid.empty())return 0;
  const auto time=(double(frame)+offset)/rate;
  auto it=std::upper_bound(grid.begin(),grid.end(),time,[](double v,const auto& b){return v<b.seconds;});
  if(it!=grid.begin())--it;
  return it->tickAt(time)+shift;
 }
 int64_t frameAt(double absoluteTick)const{
  const auto tick=absoluteTick-shift;
  auto it=std::upper_bound(grid.begin(),grid.end(),tick,[](double v,const auto& b){return v<b.tick;});
  if(it!=grid.begin())--it;
  return std::llround(it->timeAt(tick)*rate);
 }
};
struct ClipMidi {int64_t frame; Midi message;double tick=0;};
struct SlotChange {
 int64_t at=0,duration=0,phase=0;
 bool arrangement=false;double lengthTicks=0,phaseTicks=0;
 std::vector<ClipMidi> notes;
 std::vector<Midi> chase; // Notes/controllers at a return or resumed clip phase.
};
struct Slot {
 bool engaged=false,queued=false;
 int64_t start=0,duration=0,previousCycle=0;
 double startTick=0,lengthTicks=0;
 int64_t cycle(const ClipClock& clock)const{
  // An event within half a sample of this frame rounds onto this frame.
  return std::max<int64_t>(0,std::floor((clock.tick(.5-1e-8)-startTick)/lengthTicks));
 }
 std::vector<ClipMidi> notes;
 SlotChange next;
 int limit(int64_t now,int n,const ClipClock& clock)const{
  if(queued&&next.at>now)n=int(std::min<int64_t>(n,next.at-now));
  if(engaged&&lengthTicks>0){
   const auto nextFrame=clock.frameAt(startTick+(cycle(clock)+1)*lengthTicks);
   n=int(std::min<int64_t>(n,std::max<int64_t>(1,nextFrame-clock.frame)));
  }else if(engaged&&duration>0)n=int(std::min<int64_t>(n,duration-(now-start)%duration));
  return n;
 }
 void rebase(int64_t delta){start+=delta;if(queued)next.at+=delta;}
 void transition(int64_t now,std::vector<Midi>& live,const ClipClock& clock){
  const bool change=queued&&next.at<=now;
  const bool repeat=engaged&&(lengthTicks>0?cycle(clock)!=previousCycle:(duration>0&&now>start&&(now-start)%duration==0));
  if(!change&&!repeat)return;
  for(int ch=0;ch<16;++ch)live.push_back({0,uint8_t(0xb0|ch),123,0});
  if(!change){if(lengthTicks>0)previousCycle=cycle(clock);return;}
  queued=false;engaged=!next.arrangement;duration=next.duration;start=now-next.phase;
  lengthTicks=next.lengthTicks;startTick=clock.tick()-next.phaseTicks;previousCycle=0;
  notes.swap(next.notes);
  live.insert(live.end(),next.chase.begin(),next.chase.end());
 }
 void render(int64_t now,int n,std::vector<Midi>& live,const ClipClock& clock)const{
  if(engaged&&lengthTicks>0){
   const double base=startTick+cycle(clock)*lengthTicks;
   const auto first=clock.tick(-.5)-base-1e-7;
   auto it=std::lower_bound(notes.begin(),notes.end(),first,[](const auto& note,double tick){return note.tick<tick;});
   for(;it!=notes.end();++it){
    auto at=clock.frameAt(base+it->tick)-clock.frame;
    if(at>=n)break;
    if(at>=0){auto m=it->message;m.offset=int(at);live.push_back(m);}
   }
   return;
  }
  if(!engaged||duration==0)return;
  const auto phase=(now-start)%duration;
  auto it=std::lower_bound(notes.begin(),notes.end(),phase,[](const ClipMidi& m,int64_t t){return m.frame<t;});
  for(;it!=notes.end()&&it->frame<phase+n;++it){
   auto m=it->message;m.offset=int(it->frame-phase);live.push_back(m);
  }
 }
};
}
