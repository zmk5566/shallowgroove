#pragma once
#include <juce_events/juce_events.h>
#include <filesystem>
#if ! JUCE_WINDOWS
 #include <sys/stat.h>
#endif
namespace sg {
// Lifetime follows the editor. No detached callback survives plugin unload.
class FxService final : private juce::Timer {
public:
 using Reply=std::function<void(juce::var)>;
 ~FxService() override { stopTimer(); cleanup(); }
 void request(const juce::var& payload,Reply reply){
  if(callback){reply(failure("Another request is running"));return;}
  auto base=juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory);
 #if JUCE_MAC
  base=base.getChildFile("Application Support");
 #endif
  auto config=juce::JSON::parse(base.getChildFile("ShallowGroove/Plugin Host.json"));
  auto exe=config["executable"].toString();
  if(!juce::File::isAbsolutePath(exe)||!juce::File(exe).existsAsFile()){
   reply(failure("Open ShallowGroove and choose File > Install VST3 plug-ins."));return;
  }
  auto dir=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("shallowgroove-fx-"+juce::Uuid().toString());
 #if JUCE_WINDOWS
  std::error_code error;
  const bool created=std::filesystem::create_directory(std::filesystem::path(dir.getFullPathName().toWideCharPointer()),error);
 #else
  const bool created=::mkdir(dir.getFullPathName().toRawUTF8(),0700)==0;
 #endif
  if(!created){reply(failure("Could not create a private request directory"));return;}
  directory=dir;
  auto input=dir.getChildFile("request.json");
  juce::StringArray args{exe};
  if(auto* extra=config["args"].getArray())for(auto& arg:*extra)args.add(arg.toString());
  args.add("--sg-fx-service");args.add("--sg-fx-request-file="+input.getFullPathName());
  if(!input.replaceWithText(juce::JSON::toString(payload,true))||!worker.start(args,0)){
   cleanup();reply(failure("Could not launch plug-in service"));return;
  }
  callback=std::move(reply);deadline=juce::Time::getMillisecondCounterHiRes()+180000;startTimer(100);
 }
private:
 juce::ChildProcess worker;
 juce::File directory;
 Reply callback;
 double deadline=0;
 static juce::var failure(const juce::String& reason){
  auto* object=new juce::DynamicObject();object->setProperty("ok",false);object->setProperty("error",reason);return juce::var(object);
 }
 void cleanup(){
  if(worker.isRunning()){worker.kill();worker.waitForProcessToFinish(1000);}
  if(directory!=juce::File()){directory.deleteRecursively();directory=juce::File();}
 }
 void timerCallback() override {
  const bool running=worker.isRunning();
  if(running&&juce::Time::getMillisecondCounterHiRes()<deadline)return;
  stopTimer();
  auto result=running?failure("Request timed out"):juce::JSON::parse(directory.getChildFile("result.json"));
  if(!result.hasProperty("ok"))result=failure("The plug-in service exited without returning a result");
  cleanup();auto reply=std::move(callback);callback={};reply(result);
 }
};
}
