#include "RackJson.h"
#include <juce_audio_utils/juce_audio_utils.h>
#include <array>
#include <mutex>

namespace {
using namespace sg::wire;
constexpr int macroCount=8;
struct Binding {std::uint32_t id=0; float min=0,max=1; bool active=false;};
class RackProcessor;
class Editor final : public juce::AudioProcessorEditor {
public:
 explicit Editor(RackProcessor&);
 void resized() override;
private:
 juce::TextButton load{"Load Rack JSON"};
 juce::Label status;
 juce::GenericAudioProcessorEditor controls;
 std::unique_ptr<juce::FileChooser> chooser;
};
class RackProcessor final : public juce::AudioProcessor {
public:
 RackProcessor():AudioProcessor(BusesProperties().withOutput("Output",juce::AudioChannelSet::stereo(),true)){
  for(int i=0;i<macroCount;++i){
   auto* knob=new juce::AudioParameterFloat(juce::ParameterID{"macro"+String(i+1),1},"Macro "+String(i+1),0.f,1.f,0.f);
   addParameter(knob);macros[i]=knob;
  }
  auto initial=object();
  put(initial,"instrument","import(\"stdfaust.lib\"); freq=hslider(\"freq\",440,20,20000,1); gain=hslider(\"gain\",0.5,0,1,0.001); gate=button(\"gate\"); tone=hslider(\"Brightness\",0.2,0,1,0.01); process=(os.osc(freq)+tone*os.osc(freq*2))*gain*gate*0.4 <: _,_;");
  preset=initial;
 }
 const juce::String getName() const override{return "ShallowGroove Rack";}
 bool acceptsMidi() const override{return true;}
 bool producesMidi() const override{return false;}
 bool isMidiEffect() const override{return false;}
 double getTailLengthSeconds() const override{return 5;}
 int getNumPrograms() override{return 1;}
 int getCurrentProgram() override{return 0;}
 void setCurrentProgram(int) override{}
 const juce::String getProgramName(int) override{return {};}
 void changeProgramName(int,const juce::String&) override{}
 bool isBusesLayoutSupported(const BusesLayout& layout) const override{return layout.getMainOutputChannelSet()==juce::AudioChannelSet::stereo();}
 juce::AudioProcessorEditor* createEditor() override{return new Editor(*this);}
 bool hasEditor() const override{return true;}
 void releaseResources() override{core.reset();}
 void prepareToPlay(double rate,int) override{
  std::lock_guard guard(control);sampleRate=rate;
  try{install(preset,!preset.hasProperty("macros"));lastError.clear();}catch(const std::exception& e){lastError=e.what();}
 }
 void loadPreset(const var& value){
  if(value["format"].toString()=="shallowgroove-rack-v1"){
   const auto state=juce::JSON::toString(value,true);
   setStateInformation(state.toRawUTF8(),int(state.getNumBytesAsUTF8()));
   const auto issue=error();if(issue.isNotEmpty())throw std::runtime_error(issue.toStdString());
  }else {std::lock_guard guard(control);install(value,true);lastError.clear();}
 }
 juce::String error(){std::lock_guard guard(control);return lastError;}
 void processBlock(juce::AudioBuffer<float>& audio,juce::MidiBuffer& buffer) override{
  juce::ScopedNoDenormals safe;int count=0;
  for(int i=0;i<macroCount;++i){
   const auto value=macros[i]->get();
   if(bindings[i].active&&old[i]!=value){const auto& b=bindings[i];changes[count++]={0,b.id,b.min+value*(b.max-b.min)};}
   old[i]=value;
  }
  if(auto* playhead=getPlayHead())if(auto position=playhead->getPosition())if(auto bpm=position->getBpm()){
   if(std::isfinite(*bpm)&&*bpm>0&&*bpm!=lastTempo){
    for(auto id:tempoTargets)changes[count++]={0,id,float(*bpm)};
    lastTempo=*bpm;
   }
  }
  auto it=buffer.cbegin();auto end=buffer.cend();int pos=0;
  std::array<sg::Midi,1024> events;
  while(pos<audio.getNumSamples()){
   int n=std::min(256,audio.getNumSamples()-pos),used=0;
   bool overflow=false;
   for(;it!=end && (*it).samplePosition<pos+n;++it){
    const auto e=*it;if(e.numBytes<1||e.numBytes>3)continue;
    if(used>=static_cast<int>(events.size())-16){overflow=true;continue;}
    events[used++]={std::max(0,e.samplePosition-pos),e.data[0],static_cast<uint8_t>(e.numBytes>1?e.data[1]:0),static_cast<uint8_t>(e.numBytes>2?e.data[2]:0)};
   }
   if(overflow)for(int ch=0;ch<16;++ch)events[used++]={n-1,static_cast<uint8_t>(0xb0|ch),120,0};
   core.render(audio.getWritePointer(0,pos),audio.getWritePointer(1,pos),n,{events.data(),static_cast<size_t>(used)},{changes.data(),static_cast<size_t>(count)});
   pos+=n;count=0;
  }
  buffer.clear();
 }
 void getStateInformation(juce::MemoryBlock& dest) override{
  std::lock_guard guard(control);auto s=object();put(s,"format","shallowgroove-rack-v1");put(s,"preset",preset);
  juce::Array<var> v;for(auto* knob:macros)v.add(knob->get());put(s,"macroValues",v);
  auto encoded=juce::JSON::toString(s,true);auto bytes=encoded.toUTF8();dest.replaceAll(bytes.getAddress(),bytes.sizeInBytes()-1);
 }
 void setStateInformation(const void* data,int size) override{
  if(size<1||size>16*1024*1024)return;
  auto s=juce::JSON::parse(String::fromUTF8(static_cast<const char*>(data),size));
  std::lock_guard guard(control);
  try{
   if(s["format"].toString()!="shallowgroove-rack-v1")throw std::runtime_error("Unknown rack state");
   const auto* values=s["macroValues"].getArray();
   if(!values||values->size()!=macroCount)throw std::runtime_error("Invalid macro state");
   std::array<float,macroCount> restored{};
   for(int i=0;i<macroCount;++i)restored[i]=number((*values)[i],0,1);
   install(s["preset"],false);
   for(int i=0;i<macroCount;++i)macros[i]->setValueNotifyingHost(restored[i]);
   lastError.clear();
  }catch(const std::exception& e){lastError=e.what();}
 }
private:
 sg::Core core;
 double sampleRate=48000;
 std::mutex control;
 var preset;
 juce::String lastError;
 std::array<juce::AudioParameterFloat*,macroCount> macros;
 std::array<Binding,macroCount> bindings{};
 std::array<float,macroCount> old{};
 std::vector<uint32_t> tempoTargets;
 std::vector<sg::ParameterChange> changes=std::vector<sg::ParameterChange>(macroCount);
 double lastTempo=-1;
 void install(const var& value,bool setDefaults){
  auto specification=rack(value);
  const auto* mapping=value["macros"].getArray();
  if(mapping&&mapping->size()>macroCount)throw std::runtime_error("At most eight macro bindings are supported");
  core.load(specification,sampleRate);
  auto params=core.parameters();std::array<Binding,macroCount> updated{};
  std::vector<uint32_t> tempo;
  for(auto& p:params)if(p.label=="BPM")tempo.push_back(p.id);
  if(!mapping)std::erase_if(params,[](const auto& p){return p.label=="BPM";});
  auto snapshot=value.clone();juce::Array<var> actual;std::array<float,macroCount> defaults{};
  for(int i=0;i<macroCount;++i){
   const sg::Parameter* p=nullptr;
   if(mapping&&i<mapping->size()){
    const auto& slot=(*mapping)[i];const auto d=slot["device"].toString().toStdString(),a=slot["address"].toString().toStdString();
    for(const auto& param:params)if(param.device==d&&param.address==a){p=&param;break;}
   }else if(!mapping&&i<(int)params.size())p=&params[i];
   auto slot=object();
   if(p&&p->max>p->min){
    updated[i]={p->id,p->min,p->max,true};put(slot,"device",String(p->device));put(slot,"address",String(p->address));
    const sg::Values* values=&specification.values;
    for(const auto& fx:specification.effects)if(fx.id==p->device)values=&fx.values;
    auto it=values->find(p->address);defaults[i]=std::clamp(((it!=values->end()?it->second:p->init)-p->min)/(p->max-p->min),0.f,1.f);
   }
   actual.add(slot);
  }
  put(snapshot,"macros",actual);
  std::vector<sg::ParameterChange> scratch(macroCount+tempo.size());
  {const juce::ScopedLock lock(getCallbackLock());
   bindings=updated;old.fill(-1);preset=std::move(snapshot);
   tempoTargets.swap(tempo);changes.swap(scratch);lastTempo=-1;
  }
  if(setDefaults)for(int i=0;i<macroCount;++i)macros[i]->setValueNotifyingHost(defaults[i]);
 }
};
Editor::Editor(RackProcessor& p):AudioProcessorEditor(p),controls(p){
 addAndMakeVisible(load);addAndMakeVisible(status);addAndMakeVisible(controls);setSize(480,420);
 status.setText(p.error(),juce::dontSendNotification);
 load.onClick=[this,&p]{chooser=std::make_unique<juce::FileChooser>("Load a ShallowGroove rack",juce::File(),"*.json");
  chooser->launchAsync(juce::FileBrowserComponent::openMode|juce::FileBrowserComponent::canSelectFiles,[this,&p](const auto& f){
   auto file=f.getResult();if(!file.existsAsFile())return;
   try{if(file.getSize()>16*1024*1024)throw std::runtime_error("Rack exceeds 16 MB");p.loadPreset(juce::JSON::parse(file));status.setText(file.getFileName(),juce::dontSendNotification);}
   catch(const std::exception& e){status.setText(e.what(),juce::dontSendNotification);}
  });};
}
void Editor::resized(){auto area=getLocalBounds().reduced(8);auto header=area.removeFromTop(28);load.setBounds(header.removeFromLeft(130));status.setBounds(header);controls.setBounds(area);}
}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter(){return new RackProcessor;}
