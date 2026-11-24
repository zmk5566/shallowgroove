#include "Core.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <thread>

namespace {
void require(bool value, const char* message) {if(!value)throw std::runtime_error(message);}
std::string read(const std::string& path) {
    std::ifstream file(path);
    require(file.good(),"missing bundled Faust fixture");
    return {std::istreambuf_iterator<char>(file),{}};
}
const char* instrument=R"dsp(
declare name "TestSynth";
g=button("gate"); v=hslider("gain",0,0,1,.001);
t=hslider("Tone",.5,0,1,.001);
process=g*v*t <: _,_;
)dsp";
const char* fx=R"dsp(
declare name "TestFX";
t=hslider("Drive",1,0,4,.01);
process=*(t),*(t);
)dsp";
}
int main(int argc,char** argv) {
    std::string root=argc>1?argv[1]:".";
    sg::Core engine;
    sg::Rack rack;
    rack.instrument=instrument;
    rack.effects.push_back({"insert-a",fx,{{"Drive",2}},false});
    engine.load(rack,48000);
    auto params=engine.parameters();
    require(params.size()==2,"expected two public controls");
    auto drive=std::find_if(params.begin(),params.end(),[](auto& p){return p.label=="Drive";});
    require(drive!=params.end() && drive->id==sg::parameterId(drive->device,drive->address),"parameter identity");
    std::array<float,512> left{},right{};
    std::array<sg::Midi,3> input{{{8,0x90,60,127},{16,0x90,64,127},{24,0x80,60,0}}};
    std::array<sg::ParameterChange,2> automation{{{32,drive->id,.5},{48,sg::parameterId("mixer","pan"),1}}};
    engine.render(left.data(),right.data(),512,input,automation);
    auto near=[](float a,float b){return std::abs(a-b)<1e-5f;};
    require(near(left[7],0)&&near(left[8],1)&&near(left[16],2)&&near(left[24],1),"sample MIDI");
    require(near(left[31],1)&&near(left[32],.25f)&&near(left[48],0)&&near(right[48],.5f),"sample automation/FX/pan");
    require(engine.setBypass("insert-a",true),"FX bypass");
    engine.setMix(1,0);engine.render(left.data(),right.data(),16);
    require(near(left[0],.5f),"bypassed audio");
    for (const auto& bad: {"import(\"../other.lib\");process=_,_;","process=ffunction(float sin(float),\"\",\"\");",
                            "a=library ( /*comment*/ \"https://example.com/foo.lib\" );process=_,_;",
                            "process=soundfile(\"x\",2);","process=undefined_symbol;"}) {
        sg::Rack invalid=rack;invalid.instrument=bad;
        bool failed=false;
        try {engine.load(invalid,48000);}catch(const std::exception&){failed=true;}
        require(failed,"invalid/unsupported source accepted");
        engine.render(left.data(),right.data(),16);
        require(near(right[15],.5f),"compile failure changed live graph");
    }
    rack.values["Tone"]=.25f;
    engine.load(rack,48000);
    engine.render(left.data(),right.data(),512);
    require(near(right[511],.5f),"held note after graph swap");
    require(engine.parameters()[0].id==params[0].id,"unstable parameter id");
    engine.reset();
    engine.render(left.data(),right.data(),512);
    require(near(right[511],0),"transport reset left active voice");
    // A graph fade must continue computing the outgoing oscillator and its
    // effect release, even when the incoming graph is silent. Compare against
    // the same instrument playing uninterrupted, sample for sample.
    {
        sg::Core changing,reference;
        sg::Rack tone;
        tone.instrument=R"(import("stdfaust.lib"); f=hslider("freq",440,20,20000,1);g=button("gate");process=os.osc(f)*g <: _,_;)";
        tone.effects={{"tail",R"(import("stdfaust.lib");process=de.delay(255,100),de.delay(255,100);)",{},false}};
        changing.load(tone,48000);reference.load(tone,48000);
        std::array<float,512> refL{},refR{};
        std::array<sg::Midi,1> key{{{0,0x90,69,127}}};
        changing.render(left.data(),right.data(),512,key);
        reference.render(refL.data(),refR.data(),512,key);
        auto muted=tone;muted.gain=0;
        changing.load(muted,48000);
        std::array<sg::Midi,1> off{{{150,0x80,69,0}}};
        changing.render(left.data(),right.data(),512,off);
        reference.render(refL.data(),refR.data(),512,off);
        for(int i=0;i<512;++i){
            float weight=std::max(0.f,(480-i)/480.f);
            require(near(left[i],refL[i]*weight) && near(right[i],refR[i]*weight),"outgoing transition must render moving signal");
        }
        require(std::abs(left[168])>.02f,"fading effect tail must survive note-off");
    }
    // Web Audio stereo-panner formula, tested with asymmetric stereo inputs.
    {
        sg::Rack stereo;
        stereo.instrument=R"(g=button("gate");process=g,g*.25;)";
        sg::Core pan;pan.load(stereo,48000);
        std::array<sg::Midi,1> key{{{0,0x90,60,127}}};
        pan.render(left.data(),right.data(),1,key);
        require(near(left[0],1) && near(right[0],.25f),"stereo center");
        pan.setMix(1,-.5f);pan.render(left.data(),right.data(),1);
        require(near(left[0],1+.25f*std::sqrt(.5f)) && near(right[0],.25f*std::sqrt(.5f)),"stereo left half");
        pan.setMix(1,.5f);pan.render(left.data(),right.data(),1);
        require(near(left[0],std::sqrt(.5f)) && near(right[0],.25f+std::sqrt(.5f)),"stereo right half");
        pan.setMix(1,-1);pan.render(left.data(),right.data(),1);
        require(near(left[0],1.25f) && near(right[0],0),"stereo hard left");
    }
    rack.instrument=read(root+"/src/audio/synth.dsp");
    rack.effects={{"fx",read(root+"/patches/effects/filter.dsp"),{},false}};
    engine.load(rack,48000);
    std::array<sg::Midi,1> on{{{0,0x90,60,100}}};
    engine.render(left.data(),right.data(),512,on);
    require(std::all_of(left.begin(),left.end(),[](float v){return std::isfinite(v);}),"nonfinite signal");
    require(std::any_of(left.begin(),left.end(),[](float x){return std::abs(x)>.0001f;}),"factory patch silent");
    std::atomic<bool> run{true};
    std::thread audio([&]{while(run.load())engine.render(left.data(),right.data(),512);});
    for(int i=0;i<4;++i){rack.values["Tone"]=i*.1f;engine.load(rack,48000);}
    run.store(false);audio.join();
    std::cout<<"native core MIDI, parameter automation, bypass, hot swap, compiler validation and factory rack passed\n";
}
