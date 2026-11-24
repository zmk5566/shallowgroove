#pragma once
#include "RackJson.h"
#include "SessionSlots.h"
#include "Metronome.h"
#include <algorithm>
#include <array>
#include <deque>
#include <set>
#include <mutex>

namespace sg::standalone {
using namespace sg::wire;
struct Event{
 int64_t at=0;
 size_t track=0;
 bool parameter=false;
 Midi midi{};
 ParameterChange change{};
};
struct Track {
 Rack rack;
 std::unique_ptr<Core> core;
 std::vector<Midi> live,notes;
 std::vector<ParameterChange> controls;
 std::set<std::uint32_t> overrides;
 std::array<float,2> sends{},sendBase{};
 Slot slot;size_t noteBudget=6160;bool emptyReturn=false;
};
struct Timeline {
 Metronome metronome;
 double rate;
 int64_t frame=0,end=0,loopA=0,loopB=0;
 bool playing=false,loop=false;
 int64_t sessionFrame=0;double tickShift=0,loopTicks=0;
 ClipClock clipClock()const{return {metronome.grid,frame,rate,tickShift};}
 std::vector<Track> tracks;
 std::array<Track,3> buses;
 using Stereo=std::array<std::array<float,512>,2>;
 std::array<Stereo,2> sendsBuffer{};Stereo sum{};
 std::vector<Event> events,loopChase,seekChase;
 size_t cursor=0;
 bool useLoopChase=false,useSeekChase=false;
 std::array<float,512> left{},right{};
 explicit Timeline(double sampleRate):rate(sampleRate){}
 int64_t frames(double sec)const{return std::llround(sec*rate);}
 Track& track(int index){
  if(index<0||size_t(index)>=tracks.size())throw std::runtime_error("Unknown native track");
  return tracks[size_t(index)];
 }
 static constexpr std::array<const char*,3> busNames={"delay","reverb","master"};
 size_t targetIndex(const var& channel)const{
  if(channel.isString()){
   const auto name=channel.toString();
   for(size_t i=0;i<buses.size();++i)if(name==busNames[i])return tracks.size()+i;
   throw std::runtime_error("Unknown native bus");
  }
  if(channel.isVoid())return 0;
  if(tracks.empty())throw std::runtime_error("Missing native tracks");
  return size_t(number(channel,0,tracks.size()-1));
 }
 Track& target(size_t i){
  if(i<tracks.size())return tracks[i];
  if(i-tracks.size()<buses.size())return buses[i-tracks.size()];
  throw std::runtime_error("Unknown native target");
 }
 Core& coreFor(const var& channel){auto& t=target(targetIndex(channel));if(!t.core)throw std::runtime_error("Missing native rack");return *t.core;}
 bool sessionActive()const{return std::any_of(tracks.begin(),tracks.end(),[](const Track& t){return t.slot.engaged||t.slot.queued;});}
 size_t lower(int64_t at)const{return size_t(std::lower_bound(events.begin(),events.end(),at,[](const auto& e,int64_t t){return e.at<t;})-events.begin());}
 // Build chase on the control thread. At a boundary the audio thread only consumes it.
 std::vector<Event> chase(int64_t pos)const {
  struct KeyState {std::deque<Event> down, sustained;};
  struct ChannelState {
   bool pedal=false;
   std::map<int, Event> controls;
   std::map<int, KeyState> keys;
  };
  std::map<std::pair<size_t,int>,ChannelState> channels;
  std::map<std::pair<size_t,uint32_t>,Event> params;
  for(const auto& e:events){
   if(e.at>=pos)break;
   if(e.parameter){params[{e.track,e.change.id}]=e;continue;}
   auto& ch=channels[{e.track,e.midi.status&15}];
   const int type=e.midi.status&0xf0, key=e.midi.data1;
   if(type==0x90 && e.midi.data2)ch.keys[key].down.push_back(e);
   else if(type==0x80 || type==0x90){
    auto& notes=ch.keys[key];
    if(!notes.down.empty()){
     if(ch.pedal)notes.sustained.push_back(notes.down.front());
     notes.down.pop_front();
    }
   }else if(type==0xe0)ch.controls[128]=e;
   else if(type==0xb0){
    if(key==120 || key==123){
     ch.keys.clear();
     ch.controls.erase(64);
     ch.pedal=false;
    }else if(key==121){
     ch.controls.clear();
     ch.pedal=false;
     for(auto& [pitch,notes]:ch.keys)notes.sustained.clear();
    }else{
     ch.controls[key]=e;
     if(key==64){
      ch.pedal=e.midi.data2>=64;
      if(!ch.pedal)for(auto& [pitch,notes]:ch.keys)notes.sustained.clear();
     }
    }
   }
  }
  std::vector<Event> out;
  for(const auto& [target,event]:params)out.push_back(event);
  for(const auto& [channel,state]:channels){
   for(const auto& [control,event]:state.controls)out.push_back(event);
   for(const auto& [pitch,notes]:state.keys){
    for(const auto& event:notes.sustained){
     out.push_back(event);
     auto release=event;
     release.midi.status=0x80|channel.second;
     release.midi.data2=0;
     out.push_back(release);
    }
    out.insert(out.end(),notes.down.begin(),notes.down.end());
   }
  }
  return out;
 }
 void setupScratch(){
  std::vector<size_t> counts(tracks.size()+buses.size());
  for(const auto& e:events)++counts[e.track];
  for(size_t i=0;i<counts.size();++i){
   auto& t=target(i);t.noteBudget=counts[i]*2+6160;t.notes.reserve(t.noteBudget);t.controls.reserve(counts[i]*2+16);t.live.reserve(6160);
  }
 }
 void resetVoices(){for(auto& t:tracks)if(!t.slot.engaged)t.core->reset();for(auto& bus:buses)if(bus.core)bus.core->reset();}
 void seek(int64_t to){
  const auto before=clipClock().tick();
  for(auto& t:tracks)t.slot.rebase(to-sessionFrame);sessionFrame=to;
  tickShift+=before-clipClock().tick(double(to-frame));
  frame=to;cursor=lower(to);seekChase=chase(to);useSeekChase=playing;useLoopChase=false;resetVoices();
 }
 void setLoop(const var& value){
  if(value.isVoid()||value.isUndefined()){loop=false;loopChase.clear();return;}
  const auto start=number(value["start"],0,1e9),finish=number(value["end"],0,1e9);
  const auto a=frames(start),b=frames(finish);
  if(a>=b)throw std::runtime_error("Invalid loop");
  loopTicks=clipClock().tick(finish*rate-frame)-clipClock().tick(start*rate-frame);
  loopA=a;loopB=b;loopChase=chase(a);loop=true;
 }
 void append(const Event& e,int offset){
  auto& t=target(e.track);
  if(e.parameter){if(!t.overrides.count(e.change.id))t.controls.push_back({offset,e.change.id,e.change.value});}
  else if(!t.slot.engaged){auto m=e.midi;m.offset=offset;t.notes.push_back(m);}
 }
 void stop(){
  metronome.elapsed=metronome.countLength;metronome.age=-1;
  playing=false;useLoopChase=false;useSeekChase=false;for(auto& t:tracks){t.slot.engaged=false;t.slot.queued=false;}resetVoices();
  for(auto& t:tracks)t.live.clear();
 }
 void checkEnd(){
  if(!playing||metronome.counting())return;
  if(loop && frame>=loopB){
   tickShift+=frame==loopB?loopTicks:clipClock().tick()-clipClock().tick(double(loopA-frame));
   frame=loopA;cursor=lower(frame);useLoopChase=true;useSeekChase=false;resetVoices();
  }else if(frame>=end&&!sessionActive()){
   frame=end;playing=false;resetVoices();
  }
 }
 static uint32_t sendId(size_t b){
  static const std::array<uint32_t,2> ids={parameterId("mixer","send.delay"),parameterId("mixer","send.reverb")};
  return ids[b];
 }
 void mixAudio(float* outL,float* outR,int n,bool offline){
  for(auto& s:sendsBuffer)for(auto& channel:s)std::fill_n(channel.data(),n,0.f);
  for(auto& channel:sum)std::fill_n(channel.data(),n,0.f);
  for(auto& t:tracks){
   if(offline)t.core->prepareOfflineBlock();
   t.core->render(left.data(),right.data(),n,t.notes,t.controls);
   size_t next=0;
   for(int i=0;i<n;++i){
    while(next<t.controls.size()&&t.controls[next].offset<=i){
     const auto& c=t.controls[next++];
     for(size_t b=0;b<2;++b)if(c.id==sendId(b))t.sends[b]=std::clamp(c.value,0.f,1.f);
    }
    sum[0][i]+=left[i];sum[1][i]+=right[i];
    for(size_t b=0;b<2;++b){sendsBuffer[b][0][i]+=left[i]*t.sends[b];sendsBuffer[b][1][i]+=right[i]*t.sends[b];}
   }
  }
  for(size_t i=0;i<buses.size();++i){
   auto& bus=buses[i];
   if(!bus.core)continue;
   if(offline)bus.core->prepareOfflineBlock();
   const bool master=i==2;
   auto& input=master?sum:sendsBuffer[i];
   if(bus.emptyReturn)for(auto& channel:input)std::fill_n(channel.data(),n,0.f);
   bus.core->render(left.data(),right.data(),n,{},bus.controls,input[0].data(),input[1].data());
   if(master){std::copy_n(left.data(),n,outL);std::copy_n(right.data(),n,outR);return;}
   for(int j=0;j<n;++j){sum[0][j]+=left[j];sum[1][j]+=right[j];}
  }
  std::copy_n(sum[0].data(),n,outL);std::copy_n(sum[1].data(),n,outR);
 }
 void render(float* outL,float* outR,int total,bool offline=false) {
  std::fill_n(outL,total,0.f);std::fill_n(outR,total,0.f);
  for(int at=0;at<total;){
   checkEnd();
   int n=std::min(512,total-at);
   const bool rolling=playing&&!metronome.counting();
   if(metronome.counting())n=int(std::min<int64_t>(n,metronome.countLength-metronome.elapsed));
   if(rolling&&(loop||!sessionActive()))n=int(std::min<int64_t>(n,(loop?loopB:end)-frame));
   if(n<=0){playing=false;continue;}
   for(auto& t:tracks){t.notes.clear();t.controls.clear();for(auto m:t.live)t.notes.push_back(m);t.live.clear();}
   for(auto& bus:buses)bus.controls.clear();
   if(rolling){
    for(auto& t:tracks){t.slot.transition(sessionFrame,t.notes,clipClock());n=t.slot.limit(sessionFrame,n,clipClock());}
    if(!loop&&!sessionActive()){
     if(frame>=end){checkEnd();continue;}
     n=int(std::min<int64_t>(n,end-frame));
    }
    if(useSeekChase||useLoopChase){
     for(const auto& e:useSeekChase?seekChase:loopChase)append(e,0);
     useSeekChase=false;useLoopChase=false;
    }
    while(cursor<events.size()&&events[cursor].at<frame+n){
     const auto& e=events[cursor++];append(e,int(std::max<int64_t>(0,e.at-frame)));
    }
   }
   if(rolling)for(auto& t:tracks)t.slot.render(sessionFrame,n,t.notes,clipClock());
   mixAudio(outL+at,outR+at,n,offline);
   metronome.render(outL+at,outR+at,n,rate,frame,rolling);
   if(rolling){frame+=n;sessionFrame+=n;}
   at+=n;
  }
  checkEnd();
 }
};
}
