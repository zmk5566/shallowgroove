#pragma once
#include "RackJson.h"
#include <juce_audio_devices/juce_audio_devices.h>

namespace sg::standalone {
struct OutputRequest {
 juce::String name;
 double rate=0;
 int buffer=0;
 static juce::String deviceName(const juce::var& value){
  if(value.isVoid()||value.isUndefined())return {};
  if(!value.isString()||value.toString().isEmpty())throw std::runtime_error("Invalid audio output device name");
  return value.toString();
 }
 static OutputRequest parse(const juce::var& value){
  if(!value.getDynamicObject())throw std::runtime_error("Expected audio output settings");
  auto numeric=[&](const char* key,double hi){
   const auto v=value[key];
   if(v.isVoid()||v.isUndefined())return 0.;
   if(v.isBool())throw std::runtime_error("Invalid audio output setting");
   return wire::number(v,1,hi);
  };
  const double buffer=numeric("bufferSize",1048576);
  if(buffer!=std::floor(buffer))throw std::runtime_error("Invalid audio buffer size");
  return {deviceName(value["device"]),numeric("sampleRate",1e7),int(buffer)};
 }
};
struct OutputCatalog {
 juce::AudioIODeviceType& type;
 explicit OutputCatalog(juce::AudioDeviceManager& manager):type(currentType(manager)){}
 static juce::AudioIODeviceType& currentType(juce::AudioDeviceManager& manager){
  manager.getAvailableDeviceTypes();
  if(auto* type=manager.getCurrentDeviceTypeObject())return *type;
  throw std::runtime_error("No audio output driver available");
 }
 juce::String defaultName()const{
  auto names=type.getDeviceNames(false);
  return names[type.getDefaultDeviceIndex(false)];
 }
 struct Options {
  juce::String name;
  juce::StringArray devices;
  juce::Array<double> rates;
  juce::Array<int> buffers;
  juce::var json()const{
   juce::Array<juce::var> names,rs,bs;
   for(auto n:devices)names.add(n);
   for(auto r:rates)rs.add(r);
   for(auto b:buffers)bs.add(b);
   auto out=wire::object();
   wire::put(out,"devices",names);wire::put(out,"sampleRates",rs);wire::put(out,"bufferSizes",bs);
   return out;
  }
 };
 Options options(const juce::String& requested,juce::AudioIODevice* active)const{
  type.scanForDevices();
  Options o;o.devices=type.getDeviceNames(false);
  o.name=requested.isEmpty()?defaultName():requested;
  if(o.name.isEmpty())return o;
  if(!o.devices.contains(o.name))throw std::runtime_error("Audio output device unavailable: "+o.name.toStdString());
  std::unique_ptr<juce::AudioIODevice> probe;
  if(!active||active->getName()!=o.name){probe.reset(type.createDevice(o.name,{}));active=probe.get();}
  if(!active)throw std::runtime_error("Could not inspect audio output");
  o.rates=active->getAvailableSampleRates();o.buffers=active->getAvailableBufferSizes();
  return o;
 }
};
}
