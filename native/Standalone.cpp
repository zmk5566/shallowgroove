#include "Timeline.h"
#include "SessionSchedule.h"
#include "InspectorJson.h"
#include "OutputDevice.h"
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_events/juce_events.h>
#include <iostream>
#include <thread>
#include <future>
#include <cstdio>
#if JUCE_WINDOWS
#include <io.h>
#else
#include <unistd.h>
#endif
#if JUCE_MAC
#include <CoreFoundation/CoreFoundation.h>
#endif

namespace {
using namespace sg;
using namespace sg::wire;
using namespace sg::standalone;
// Some libfaust parser diagnostics print directly to stdout. Reserve the
// original pipe for JSON; ordinary process output goes to diagnostics instead.
FILE* protocol=nullptr;
bool openProtocol(){
#if JUCE_WINDOWS
 const auto saved=_dup(_fileno(stdout));
 if(saved<0||_dup2(_fileno(stderr),_fileno(stdout))<0)return false;
 protocol=_fdopen(saved,"wb");
#else
 const auto saved=dup(STDOUT_FILENO);
 if(saved<0||dup2(STDERR_FILENO,STDOUT_FILENO)<0)return false;
 protocol=fdopen(saved,"w");
#endif
 return protocol!=nullptr;
}
void send(const var& data){
 static std::mutex output;const auto line=juce::JSON::toString(data,true).toStdString();
 std::lock_guard guard(output);std::fwrite(line.data(),1,line.size(),protocol);std::fputc('\n',protocol);std::fflush(protocol);
}
uint32_t automationId(const var& source){
 const auto device=text(source,"device");auto address=text(source,"address");
 if(device=="mixer"){
  if(address=="level")address="gain";
  if(address=="send:delay"||address=="send:reverb")address[4]='.';
 }
 return parameterId(device,address);
}
struct NativeHost final:juce::AudioIODeviceCallback,juce::MidiInputCallback,juce::Timer{
 bool headless;
 Timeline timeline;
 std::mutex lock;
 juce::AudioDeviceManager manager;
 std::vector<std::unique_ptr<juce::MidiInput>> inputs;
 size_t monitorTrack=0;
 bool monitoring=false;
 std::array<std::array<uint8_t,128>,16> monitoredNotes{};
 std::array<bool,16> monitoredPedals{};
 std::atomic<float> outputPeak=0;
 struct Monitored {int track; Midi note;double time;};
 std::array<Monitored,2048> received{};
 size_t receivedCount=0;
 bool lastPlaying=false;
 std::atomic<bool> lost=false,callbackRunning=false;
 double unhealthySince=0,openedRate=0;
 int openedBuffer=0;
 std::atomic<double> deviceRate=0;
 String deviceError,lastDevices,openedOutput,announcedDefault;
 OutputRequest preference;
 bool triedOutput=false,outputProblem=false;
 explicit NativeHost(bool offline,double rate):headless(offline),timeline(rate){
  if(!headless){manager.addAudioCallback(this);startTimerHz(25);}
 }
 ~NativeHost()override{stopTimer();inputs.clear();if(!headless)manager.removeAudioCallback(this);}
 void configureOutput(const OutputRequest& selection){
  if(headless){
   if(selection.name.isNotEmpty()||(selection.rate&&selection.rate!=timeline.rate)||(selection.buffer&&selection.buffer!=512))
    throw std::runtime_error("Output unavailable in offline renderer");
   return;
  }
  OutputCatalog catalog(manager);
  const auto options=catalog.options(selection.name,manager.getCurrentAudioDevice());
  if(options.name.isEmpty())throw std::runtime_error("No default audio output available");
  if(selection.rate&&!options.rates.contains(selection.rate))throw std::runtime_error("Sample rate unavailable on this output");
  if(selection.buffer&&!options.buffers.contains(selection.buffer))throw std::runtime_error("Buffer size unavailable on this output");
  auto previous=manager.getAudioDeviceSetup();
  const bool wasOpen=manager.getCurrentAudioDevice()!=nullptr;
  if(auto* current=manager.getCurrentAudioDevice()){
   previous.sampleRate=current->getCurrentSampleRate();previous.bufferSize=current->getCurrentBufferSizeSamples();
  }
  juce::AudioDeviceManager::AudioDeviceSetup setup;
  setup.outputDeviceName=options.name;setup.sampleRate=selection.rate;setup.bufferSize=selection.buffer;
  auto error=manager.initialise(0,2,nullptr,false,{},&setup);
  auto* device=manager.getCurrentAudioDevice();
  if(error.isEmpty()&&(!device||!device->isOpen()||device->getName()!=options.name
      ||(selection.rate&&selection.rate!=device->getCurrentSampleRate())
      ||(selection.buffer&&selection.buffer!=device->getCurrentBufferSizeSamples())))
   error="Audio driver did not apply the requested settings";
  if(error.isNotEmpty()){
   if(wasOpen){
    auto rollback=manager.setAudioDeviceSetup(previous,false);
    if(rollback.isNotEmpty())error+="; restoring previous output failed: "+rollback;
    else lost=false;
   }else manager.closeAudioDevice();
   throw std::runtime_error(error.toStdString());
  }
  unhealthySince=0;openedRate=device->getCurrentSampleRate();openedBuffer=device->getCurrentBufferSizeSamples();
  preference=selection;openedOutput=options.name;announcedDefault.clear();outputProblem=false;triedOutput=true;lost=false;deviceError.clear();
  std::lock_guard guard(lock);
  if(timeline.tracks.empty())timeline.rate=device->getCurrentSampleRate();
 }
 void ensureOutput(){
  if(headless||triedOutput)return;
  triedOutput=true;
  try{configureOutput({});}catch(const std::exception& e){deviceError=String::fromUTF8(e.what());}
 }
 var devices(){
  auto o=object();juce::Array<var> list;
  if(!headless)for(auto d:juce::MidiInput::getAvailableDevices()){
   auto item=object();put(item,"id",d.identifier);put(item,"name",d.name);
   put(item,"enabled",std::any_of(inputs.begin(),inputs.end(),[&](auto& in){return in->getIdentifier()==d.identifier;}));list.add(item);
  }
  auto* d=manager.getCurrentAudioDevice();put(o,"midiInputs",list);put(o,"audioDevice",d?d->getName():String());
  put(o,"bufferSize",d?d->getCurrentBufferSizeSamples():(headless?512:0));put(o,"sampleRate",d?d->getCurrentSampleRate():(headless?timeline.rate:0));put(o,"audioError",deviceError);return o;
 }
 void timerCallback()override{
  const bool stopped=lost.exchange(false);
  static unsigned ticks=0;
  const bool poll=++ticks%12==0;
  if((stopped||poll||unhealthySince!=0)&&openedOutput.isNotEmpty()){
   const auto catalog=OutputCatalog(manager);
   const auto systemDefault=preference.name.isEmpty()?catalog.defaultName():String();
   auto* current=manager.getCurrentAudioDevice();
   if(preference.name.isEmpty()&&systemDefault.isNotEmpty()&&systemDefault!=openedOutput){
    if(announcedDefault!=systemDefault){
     announcedDefault=systemDefault;auto event=object();put(event,"event","outputDefaultChanged");put(event,"audioDevice",systemDefault);send(event);
    }
   }else{
    announcedDefault.clear();
    const bool present=catalog.type.getDeviceNames(false).contains(openedOutput);
    const bool healthy=present&&current&&current->getName()==openedOutput&&current->isOpen()&&callbackRunning
      &&current->getCurrentSampleRate()==openedRate&&current->getCurrentBufferSizeSamples()==openedBuffer;
    // CoreAudio deliberately stops its callback and reopens it on a 100 ms
    // JUCE timer after rate or buffer changes. Match the resumed stream.
    const double now=juce::Time::getMillisecondCounterHiRes();
    if(healthy)unhealthySince=0;
    else if(!unhealthySince)unhealthySince=now;
    if(!outputProblem&&(!present||(!healthy&&now-unhealthySince>=750))){
     outputProblem=true;deviceError="Audio output changed or disconnected";
     {std::lock_guard guard(lock);timeline.stop();}
     auto event=object();put(event,"event","deviceLost");put(event,"error",deviceError);send(event);
    }
   }
  }
  var position;std::array<Monitored,2048> captured;size_t count;
  {std::lock_guard guard(lock);
   if(timeline.playing||lastPlaying){position=object();put(position,"event","position");put(position,"position",timeline.frame/timeline.rate);put(position,"sessionPosition",timeline.sessionFrame/timeline.rate);put(position,"sessionTick",timeline.clipClock().tick());put(position,"playing",timeline.playing);
    put(position,"countToken",timeline.metronome.countToken);put(position,"countBeat",timeline.metronome.displayedBeat());}
   lastPlaying=timeline.playing;count=receivedCount;std::copy_n(received.begin(),count,captured.begin());receivedCount=0;
  }
  if(!position.isVoid())send(position);
  for(size_t i=0;i<count;++i){const auto& e=captured[i];auto o=object();put(o,"event","midi");put(o,"track",e.track);put(o,"status",int(e.note.status));put(o,"data1",int(e.note.data1));put(o,"data2",int(e.note.data2));put(o,"position",e.time);send(o);}
  if(!headless&&poll){
   auto available=juce::MidiInput::getAvailableDevices();
   const auto removed=std::erase_if(inputs,[&](const auto& in){return std::none_of(available.begin(),available.end(),[&](const auto& d){return d.identifier==in->getIdentifier();});});
   if(removed){std::lock_guard guard(lock);releaseMonitor();}
   auto info=devices();auto key=juce::JSON::toString(info,true);
   if(lastDevices!=key){lastDevices=key;put(info,"event","devices");send(info);}
  }
 }
 void audioDeviceAboutToStart(juce::AudioIODevice* d) override{
  callbackRunning=true;const auto rate=d->getCurrentSampleRate(),was=deviceRate.exchange(rate);
  if(was>0&&rate!=was)lost=true;
 }
 void audioDeviceStopped() override{callbackRunning=false;lost=true;}
 void audioDeviceError(const String&) override{callbackRunning=false;lost=true;}
 void audioDeviceIOCallbackWithContext(const float* const*,int,float* const* out,int channels,int n,const juce::AudioIODeviceCallbackContext&)override{
  juce::ScopedNoDenormals safe;
  for(int i=0;i<channels;++i)if(out[i])std::fill_n(out[i],n,0.f);
  std::unique_lock guard(lock,std::try_to_lock);
  if(guard&&channels>=2&&out[0]&&out[1]&&deviceRate.load()==timeline.rate){
   timeline.render(out[0],out[1],n);float peak=0;
   for(int i=0;i<n;++i)peak=std::max({peak,std::abs(out[0][i]),std::abs(out[1][i])});
   outputPeak.store(peak,std::memory_order_relaxed);
  }
 }
 void releaseMonitor(){
  if(monitorTrack<timeline.tracks.size()){
   auto& t=timeline.tracks[monitorTrack];
   for(int ch=0;ch<16;++ch){
    if(monitoredPedals[ch])t.live.push_back({0,uint8_t(0xb0|ch),64,0});
    for(int n=0;n<128;++n)for(int voice=0;voice<monitoredNotes[ch][n];++voice)t.live.push_back({0,uint8_t(0x80|ch),uint8_t(n),0});
   }
  }
  monitoredNotes={};monitoredPedals={};
 }
 void handleIncomingMidiMessage(juce::MidiInput*,const juce::MidiMessage& m)override{
  const int sz=m.getRawDataSize();const auto* bytes=m.getRawData();
  if(sz<1||sz>3||bytes[0]<0x80||bytes[0]>=0xf0)return;
  std::lock_guard guard(lock);
  if(monitorTrack>=timeline.tracks.size())return;
  Midi note{0,bytes[0],uint8_t(sz>1?bytes[1]:0),uint8_t(sz>2?bytes[2]:0)};
  auto& live=timeline.tracks[monitorTrack].live;
  if(monitoring){
   const int ch=note.status&15,type=note.status>>4;
   bool route=true;
   auto& owned=monitoredNotes[ch][note.data1];
   if(type==9&&note.data2)owned=std::min<int>(owned+1,16);
   else if(type==8||type==9){route=owned>0;if(route)--owned;}
   if(type==11&&(note.data1==120||note.data1==123))monitoredNotes[ch].fill(0);
   if(type==11&&note.data1==64)monitoredPedals[ch]=note.data2>=64;
   if(route){if(live.size()<4096)live.push_back(note);else timeline.tracks[monitorTrack].core->reset();}
  }
  if(receivedCount<received.size())received[receivedCount++]={int(monitorTrack),note,timeline.frame/timeline.rate};
 }
 void selectInputs(const var& request){
  const auto* ids=request["ids"].getArray();if(!ids)throw std::runtime_error("Missing MIDI input IDs");
  const size_t target=field(request,"track",monitorTrack,0,63);
  std::set<String> wanted;for(auto& id:*ids)wanted.insert(id.toString());
  std::vector<std::unique_ptr<juce::MidiInput>> added;
  for(auto& id:wanted)if(std::none_of(inputs.begin(),inputs.end(),[&](auto& in){return in->getIdentifier()==id;})){
   auto in=juce::MidiInput::openDevice(id,this);if(!in)throw std::runtime_error("MIDI input unavailable");added.push_back(std::move(in));
  }
  auto removed=std::erase_if(inputs,[&](const auto& in){return !wanted.count(in->getIdentifier());});
  {std::lock_guard guard(lock);if(removed||target!=monitorTrack)releaseMonitor();monitorTrack=target;}
  for(auto& in:added){in->start();inputs.push_back(std::move(in));}
 }
 void load(const var& q){
  juce::Array<var> single;const auto* racks=q["racks"].getArray();
  if(!racks){single.add(q["preset"]);racks=&single;}
  if(racks->size()>64||racks->isEmpty())throw std::runtime_error("Expected 1 to 64 native racks");
  double rate=headless?timeline.rate:deviceRate.load();
  if(rate<=0)throw std::runtime_error("No audio output available");
  Timeline next(rate);
  for(const auto& r:*racks){
   auto spec=rack(r);auto core=std::make_unique<Core>();core->load(spec,rate);next.tracks.push_back({std::move(spec),std::move(core)});
   auto& t=next.tracks.back();
   for(size_t i=0;i<2;++i)t.sends[i]=t.sendBase[i]=field(r["sends"],Timeline::busNames[i],0,0,1);
  }
  for(size_t i=0;i<next.buses.size();++i){
   const auto& value=q["buses"][Timeline::busNames[i]];if(value.isVoid())continue;
   auto& bus=next.buses[i];bus.rack=rack(value,true);bus.emptyReturn=i<2&&bus.rack.effects.empty();
   bus.core=std::make_unique<Core>();bus.core->load(bus.rack,rate);
  }
  next.setupScratch();
  {std::lock_guard guard(lock);std::swap(next,timeline);receivedCount=0;monitoredNotes={};monitoredPedals={};}
 }
 void play(const var& q){
  const auto* rows=q["events"].getArray();
  if(!rows||rows->size()>1000000||timeline.tracks.empty())throw std::runtime_error("Missing racks or invalid event count");
  Timeline plan(timeline.rate);plan.metronome.configure(q,timeline.rate);plan.tracks.resize(timeline.tracks.size());
  for(auto& row:*rows){
   Event e;e.at=plan.frames(number(row["time"],0,1e9));e.track=plan.targetIndex(row["track"]);
   if(has(row,"address")){e.parameter=true;e.change={0,automationId(row),float(number(row["value"],-1e12,1e12))};}
   else {if(e.track>=plan.tracks.size())throw std::runtime_error("MIDI requires an instrument track");e.midi=readMidi(row);}
   plan.events.push_back(e);
  }
  std::stable_sort(plan.events.begin(),plan.events.end(),[](const auto& a,const auto& b){return a.at<b.at;});
  plan.end=plan.frames(number(q["end"],0,1e9));plan.playing=true;plan.setLoop(q["loop"]);
  plan.frame=plan.frames(field(q,"position",0,0,1e9));if(plan.loop && (plan.frame<plan.loopA||plan.frame>=plan.loopB))plan.frame=plan.loopA;
  plan.cursor=plan.lower(plan.frame);plan.seekChase=plan.chase(plan.frame);plan.useSeekChase=true;plan.setupScratch();plan.sessionFrame=plan.frame;
  if(q.hasProperty("slots")){auto slots=prepareSlots(plan,q["slots"],plan.sessionFrame,plan.frame);publishSlots(plan,slots);}
  {std::lock_guard guard(lock);
   for(size_t i=0;i<plan.tracks.size()+plan.buses.size();++i){
    auto& dest=plan.target(i);auto& source=timeline.target(i);dest.core.swap(source.core);
    std::swap(dest.rack,source.rack);dest.emptyReturn=source.emptyReturn;dest.sendBase=dest.sends=source.sendBase;
   }
   std::swap(timeline,plan);timeline.resetVoices();lastPlaying=true;
  }
 }
 var command(const var& q){
  const auto op=text(q,"op");auto out=object();
  if(op=="outputOptions"){
   auto name=OutputRequest::deviceName(q["device"]);
   if(headless){if(name.isNotEmpty())throw std::runtime_error("Unknown offline output");OutputCatalog::Options o;o.rates.add(timeline.rate);o.buffers.add(512);return o.json();}
   return OutputCatalog(manager).options(name,manager.getCurrentAudioDevice()).json();
  }
  if(op=="releaseOutput"){
   openedOutput.clear();triedOutput=true;unhealthySince=0;outputProblem=false;deviceError.clear();
   if(!headless){manager.closeAudioDevice();deviceRate=0;lost=false;}
   return out;
  }
  if(op=="configureOutput"){configureOutput(OutputRequest::parse(q["output"]));return devices();}
  if(op=="load"||op=="status")ensureOutput();
  if(op=="load"){load(q);juce::Array<var> params;for(const auto& t:timeline.tracks){juce::Array<var> set;for(const auto& p:t.core->parameters())set.add(json(p));params.add(set);}put(out,"parameters",params);return out;}
  if(op=="replaceRack"){
   auto index=timeline.targetIndex(q["track"]);auto& target=timeline.target(index);
   if(!target.core)throw std::runtime_error("Missing native rack");
   bool bus=index>=timeline.tracks.size();auto spec=rack(q["preset"],bus);
   target.core->load(spec,timeline.rate);
   {std::lock_guard guard(lock);target.rack=std::move(spec);
    target.emptyReturn=bus&&index<timeline.tracks.size()+2&&target.rack.effects.empty();}
   juce::Array<var> params;
   for(const auto& p:target.core->parameters())params.add(json(p));
   put(out,"parameters",params);return out;
  }
  if(op=="inspectRead" || op=="inspectClose"){
   const auto token=text(q,"token"),device=text(q,"device");
   if(token.size()>128 || device.size()>300)throw std::runtime_error("Invalid inspector target");
   ProbeFrame frame;double rate;
   const bool wave=q["wave"],spectrum=q["spectrum"],performance=q["performance"];
   {
    std::lock_guard guard(lock);auto& probes=timeline.coreFor(q["track"]).probes();
    if(op=="inspectClose"){probes.remove(token);return out;}
    rate=timeline.rate;frame=probes.read(token,device,wave||spectrum,performance,rate);
   }
   return inspectFrame(frame,rate,device!="channel" && device!="instrument",wave,spectrum,performance);
  }
  if(op=="meters"){
   juce::Array<var> levels,buses;
   auto read=[&](const auto& track){
    auto rms=track.core?track.core->probes().readMeter(timeline.rate):std::array<double,2>{};
    juce::Array<var> pair;pair.add(rms[0]);pair.add(rms[1]);return pair;
   };
   {std::lock_guard guard(lock);for(auto& t:timeline.tracks)levels.add(read(t));for(auto& t:timeline.buses)buses.add(read(t));}
   put(out,"tracks",levels);put(out,"buses",buses);return out;
  }
  if(op=="play"){play(q);return out;}
  if(op=="launch"){
   int64_t origin,arrange;{std::lock_guard guard(lock);origin=timeline.sessionFrame;arrange=timeline.frame;}
   auto at=std::max(origin,timeline.frames(field(q,"at",origin/timeline.rate,0,1e9)));
   auto changes=prepareSlots(timeline,q["slots"],at,arrange+(at-origin));
   std::lock_guard guard(lock);publishSlots(timeline,changes);return out;
  }
  if(op=="metronome"){std::lock_guard guard(lock);timeline.metronome.enabled=q["enabled"];if(!timeline.metronome.enabled&&!timeline.metronome.counting())timeline.metronome.age=-1;return out;}
  if(op=="setMonitor"){
   std::lock_guard guard(lock);bool enable=q["enabled"];
   auto target=size_t(field(q,"track",monitorTrack,0,63));
   if(enable&&target>=timeline.tracks.size())throw std::runtime_error("Unknown monitor track");
   if(!enable||target!=monitorTrack)releaseMonitor();monitorTrack=target;monitoring=enable;return out;
  }
  if(op=="setMidiInputs"){selectInputs(q);return devices();}
  if(op=="status"){out=devices();std::lock_guard guard(lock);put(out,"monitoring",monitoring);put(out,"outputPeak",outputPeak.load());put(out,"playing",timeline.playing);put(out,"position",timeline.frame/timeline.rate);put(out,"sessionPosition",timeline.sessionFrame/timeline.rate);put(out,"sessionTick",timeline.clipClock().tick());put(out,"monitorTrack",int(monitorTrack));put(out,"tracks",int(timeline.tracks.size()));return out;}
  if(op=="snapshot"){
   juce::Array<var> rows;auto buses=object();
   for(const auto& t:timeline.tracks){
    auto row=json(t.rack),sends=object();for(size_t i=0;i<2;++i)put(sends,Timeline::busNames[i],t.sendBase[i]);
    put(row,"sends",sends);rows.add(row);
   }
   for(size_t b=0;b<timeline.buses.size();++b)if(timeline.buses[b].core)put(buses,Timeline::busNames[b],json(timeline.buses[b].rack));
   put(out,"racks",rows);put(out,"buses",buses);return out;
  }
  if(op=="quit")return out;
  if(op=="render"||op=="renderPcm24"){
   if(!headless)throw std::runtime_error("Render requires --headless");
   const int frames=number(q["frames"],1,65536);
   std::vector<float> l(frames),r(frames);
   {std::lock_guard guard(lock);timeline.render(l.data(),r.data(),frames,true);}
   if(op=="renderPcm24"){
    // Pack little-endian stereo once; an export block stays below 512 KiB on the wire.
    int kept=frames;
    if(bool(q["tail"])){
     while(kept>0&&std::abs(l[kept-1])<=1e-6f&&std::abs(r[kept-1])<=1e-6f)--kept;
    }
    std::vector<uint8_t> bytes(size_t(kept)*6);
    for(int i=0;i<kept;++i)for(int ch=0;ch<2;++ch){
     const float value=ch?r[i]:l[i];
     if(!std::isfinite(value))throw std::runtime_error("Cannot export non-finite audio samples");
     const auto pcm=uint32_t(std::clamp(std::lround(std::clamp(value,-1.f,1.f)*8388608.),-8388608L,8388607L));
     const auto offset=i*6+ch*3;
     bytes[offset]=uint8_t(pcm);bytes[offset+1]=uint8_t(pcm>>8);bytes[offset+2]=uint8_t(pcm>>16);
    }
    put(out,"frames",kept);put(out,"pcm",kept?juce::Base64::toBase64(bytes.data(),bytes.size()):String());
    return out;
   }
   juce::Array<var> left,right;for(int i=0;i<frames;++i){left.add(l[i]);right.add(r[i]);}
   put(out,"left",left);put(out,"right",right);return out;
  }
  std::lock_guard guard(lock);
  if(op=="stop"){timeline.stop();return out;}
  if(op=="seek"){timeline.seek(timeline.frames(number(q["position"],0,1e9)));return out;}
  if(op=="setLoop"){timeline.setLoop(q["loop"]);return out;}
  auto index=timeline.targetIndex(q["track"]);auto& t=timeline.target(index);if(!t.core)throw std::runtime_error("Missing native rack");
  if(op=="setParam"||op=="resumeParam"){
   auto device=text(q,"device"),path=text(q,"address");auto key=automationId(q);
   if(op=="resumeParam"){t.overrides.erase(key);return out;}
   const float value=number(q["value"],-1e12,1e12);
   if(!t.core->setParameter(device,path,value))throw std::runtime_error("Unknown parameter");
   if(device=="instrument")t.rack.values[path]=value;
   for(auto& fx:t.rack.effects)if(fx.id==device)fx.values[path]=value;
   t.overrides.insert(key);return out;
  }
  if(op=="setMix"){
   t.rack.gain=field(q,"gain",t.rack.gain,0,10);t.rack.pan=field(q,"pan",t.rack.pan,-1,1);
   if(q.hasProperty("sends"))for(size_t i=0;i<2;++i){
    const auto* bus=Timeline::busNames[i];if(!q["sends"].hasProperty(bus))continue;
    t.sends[i]=t.sendBase[i]=number(q["sends"][bus],0,1);t.overrides.insert(Timeline::sendId(i));
   }
   for(const char* p:{"gain","pan"})if(has(q,p))t.overrides.insert(parameterId("mixer",p));
   t.core->setMix(t.rack.gain,t.rack.pan);return out;
  }
  if(op=="bypass"){
   auto id=text(q,"device");bool value=q["bypassed"];
   if(!t.core->setBypass(id,value))throw std::runtime_error("Unknown effect");
   for(auto& fx:t.rack.effects)if(fx.id==id)fx.bypass=value;
   return out;
  }
  if(index>=timeline.tracks.size())throw std::runtime_error("MIDI requires an instrument track");
  Midi m{};
  if(op=="noteOn"||op=="noteOff"){
   m.status=(op=="noteOn"?0x90:0x80)+int(field(q,"channel",1,1,16))-1;
   m.data1=number(q["note"],0,127);m.data2=std::lround(127*field(q,"velocity",1,0,1));
  }else if(op=="midi"){
   m.status=number(q["status"],128,239);m.data1=field(q,"data1",0,0,127);m.data2=field(q,"data2",0,0,127);
  }else throw std::runtime_error("Unknown native operation");
  if(t.live.size()>=4096)throw std::runtime_error("Live MIDI queue full");
  t.live.push_back(m);return out;
 }
};
}
int main(int argc,char** argv){
 bool headless=false;double rate=48000;
 for(int i=1;i<argc;++i){
  const std::string a=argv[i];if(a=="--headless")headless=true;
  else if(a=="--sample-rate"&&i+1<argc){rate=std::atof(argv[++i]);if(!(rate>=8000&&rate<=384000))return 2;}
  else {std::cerr<<"Usage: ShallowGrooveEngine [--headless] [--sample-rate Hz]\n";return 2;}
 }
 if(!openProtocol())return 2;
 juce::ScopedJuceInitialiser_GUI initialiser;
 NativeHost host(headless,rate);
 auto reply=[&](const var& q){
  var result;
  try{result=host.command(q);put(result,"ok",true);}
  catch(const std::exception& e){result=object();put(result,"ok",false);put(result,"error",String::fromUTF8(e.what()));}
  put(result,"id",q["id"]);send(result);
 };
 auto parse=[](const std::string& line){return line.size()<=64*1024*1024?juce::JSON::parse(String::fromUTF8(line.data(),int(line.size()))):var();};
 if(headless){
  for(std::string line;std::getline(std::cin,line);){
   auto q=parse(line);reply(q);if(q["op"].toString()=="quit")break;
  }
  return 0;
 }
 auto* messages=juce::MessageManager::getInstance();
 bool running=true;
 auto finish=[&]{
  running=false;
#if !JUCE_MAC
  messages->stopDispatchLoop();
#endif
 };
 std::thread reader([&]{
  for(std::string line;std::getline(std::cin,line);){
   const auto q=parse(line);
   const auto op=q["op"].toString();
   // DSP compilation can take seconds; keep the CoreAudio and UI clock running.
   if(op=="replaceRack"){reply(q);continue;}
   std::promise<void> completed;
   auto waiting=completed.get_future();
   juce::MessageManager::callAsync([&]{reply(q);completed.set_value();});
   waiting.get();if(op=="quit")break;
  }
  juce::MessageManager::callAsync(finish);
 });
#if JUCE_MAC
 // There is no NSApplication in this command-line audio service.
 while(running)CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.2,true);
#else
 messages->runDispatchLoop();
#endif
 reader.join();return 0;
}
