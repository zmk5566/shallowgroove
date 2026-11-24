#include "Core.h"
#include "Probe.h"
#include "FaustSource.h"
#include "FaustLibrary.h"
#include <faust/dsp/interpreter-dsp.h>
#include <faust/gui/APIUI.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <chrono>
#include <thread>
#include <cstdlib>
#include <filesystem>
#include <limits>
#include <mutex>
#include <set>
#include <stdexcept>

namespace sg {
std::uint32_t parameterId(std::string_view device, std::string_view address) noexcept {
    std::uint32_t id = 2166136261u;
    for (unsigned char c : device) id = (id ^ c) * 16777619u;
    id *= 16777619u; // separator
    for (unsigned char c : address) id = (id ^ c) * 16777619u;
    return id;
}

namespace {
constexpr int polyphony = 16, quantum = 256;
struct FactoryDeleter { void operator()(interpreter_dsp_factory* f) const { deleteInterpreterDSPFactory(f); } };
using Factory = std::unique_ptr<interpreter_dsp_factory, FactoryDeleter>;
using Instance = std::unique_ptr<interpreter_dsp>;
using Buffer = std::array<std::array<float, quantum>, 2>;

Factory compile(const std::string& name, const std::string& source) {
    static const bool multithreaded = startMTDSPFactories();
    if (!multithreaded) throw std::runtime_error("Faust factory synchronization unavailable");
    const auto* path = std::getenv("SG_FAUST_LIBRARY_DIR");
#ifdef SG_FAUST_LIBRARY_DIR
    if (!path) path = SG_FAUST_LIBRARY_DIR;
#endif
    const auto bundled = bundledFaustLibrary();
    const std::string directory = bundled.empty() ? (path ? path : "") : bundled.generic_string();
    if (directory.find_first_of("\"\r\n") != std::string::npos)
        throw std::runtime_error("Invalid Faust library directory");
    auto stdlib = (std::filesystem::path(directory) / "stdfaust.lib").generic_string();
    if (!std::filesystem::path(stdlib).is_absolute())
        throw std::runtime_error("Configure the installed Faust library directory");
    const auto checked = checkedFaustSource(source,stdlib);
    std::string error;
    const char* args[] = {"-I",directory.c_str(),"-ftz","2"};
    Factory factory(createInterpreterDSPFactoryFromString(name, checked, 4, args, error));
    if (!factory) throw std::runtime_error(error.empty() ? "Failed to compile Faust patch" : error);
    return factory;
}
Instance instantiate(Factory& factory, int rate, int inputs) {
    Instance result(factory->createDSPInstance());
    if (!result || result->getNumInputs()!=inputs || result->getNumOutputs()!=2)
        throw std::runtime_error(inputs ? "Effect needs stereo input and output" : "Instrument needs no inputs and two outputs");
    result->init(rate);
    return result;
}
struct Control {
    Parameter descriptor;
    std::vector<float*> zones;
    std::atomic<float> value;
    float applied = std::numeric_limits<float>::quiet_NaN();
    Control(Parameter p, float initial):descriptor(std::move(p)),value(initial) {}
    void set(float v) {
        if (std::isfinite(v)) value.store(std::clamp(v,descriptor.min,descriptor.max),std::memory_order_relaxed);
    }
    void sync() {
        float current=value.load(std::memory_order_relaxed);
        if (current!=applied) {
            for (auto* zone:zones) *zone=current;
            applied=current;
        }
    }
};
struct Voice {
    Instance dsp;
    float *gate=nullptr,*freq=nullptr,*gain=nullptr,*key=nullptr,*velocity=nullptr;
    int note=-1, channel=0, quiet=0;
    bool released=false, sustained=false;
    std::uint64_t age=0;
};
struct Insert {
    std::string id;
    Factory factory;
    Instance dsp;
    std::atomic<bool> bypass{false};
    bool wetOnly=false;
};
struct Graph {
    Factory instrument;
    std::array<Voice,polyphony> voices;
    std::vector<std::unique_ptr<Insert>> effects;
    std::vector<std::unique_ptr<Control>> controls;
    std::array<bool,16> pedal{};
    Buffer bus{},scratch{};
    int rate;
    std::uint64_t age=0;

    Graph(const Rack& rack,int sampleRate):rate(sampleRate) {
        if(!rack.instrument.empty())instrument=compile("ShallowSynth",rack.instrument);
        std::set<std::string> devices{"instrument","mixer"};
        if (rack.effects.size()>64) throw std::runtime_error("Too many effects");
        if(instrument)for (auto& voice:voices) {
            voice.dsp=instantiate(instrument,rate,0);
            bind(*voice.dsp,"instrument",rack.values,&voice);
        }
        for (const auto& spec:rack.effects) {
            if (spec.id.empty() || !devices.insert(spec.id).second) throw std::runtime_error("Duplicate or empty effect id");
            auto effect=std::make_unique<Insert>();
            effect->id=spec.id; effect->factory=compile("ShallowEffect",spec.code);
            effect->dsp=instantiate(effect->factory,rate,2);
            bind(*effect->dsp,spec.id,spec.values,nullptr);
            effect->bypass.store(spec.bypass);effect->wetOnly=spec.wetOnly;
            effects.push_back(std::move(effect));
        }
        for (auto& control:controls) control->sync();
    }

    void bind(interpreter_dsp& instance,const std::string& device,const Values& values,Voice* voice) {
        APIUI ui;
        instance.buildUserInterface(&ui);
        for(int i=0;i<ui.getParamsCount();++i) {
            if (ui.getParamItemType(i)>=APIUI::kHBargraph) continue;
            const std::string label=ui.getParamLabel(i),address=ui.getParamAddress(i);
            auto* zone=ui.getParamZone(i);
            if (voice) {
                if (label=="freq") { voice->freq=zone; continue; }
                if (label=="gate") { voice->gate=zone; *zone=0; continue; }
                if (label=="gain") { voice->gain=zone; continue; }
                if (label=="key") { voice->key=zone; continue; }
                if (label=="vel"||label=="velocity") { voice->velocity=zone; continue; }
            }
            auto id=parameterId(device,address);
            auto found=std::find_if(controls.begin(),controls.end(),[&](auto& c){return c->descriptor.id==id;});
            if(found==controls.end()){
                auto p=Parameter{device,address,label,ui.getParamMin(i),ui.getParamMax(i),ui.getParamStep(i),ui.getParamInit(i),id};
                auto c=std::make_unique<Control>(p,p.init);
                auto v=values.find(address);
                if(v==values.end())v=values.find(label);
                if(v!=values.end())c->set(v->second);
                c->zones.push_back(zone);
                controls.push_back(std::move(c));
            }else{
                auto& c=**found;
                if(c.descriptor.device!=device || c.descriptor.address!=address)throw std::runtime_error("Parameter ID collision");
                c.zones.push_back(zone);
            }
        }
        if(voice && !voice->gate)throw std::runtime_error("Polyphonic instrument needs a gate control");
    }
    void release(Voice& v) {
        v.sustained=false;v.released=true;*v.gate=0;v.quiet=0;
    }
    void noteOn(int channel,int note,int vel) {
        if(!instrument)return;
        auto voice=std::find_if(voices.begin(),voices.end(),[](const auto& v){return v.note<0;});
        if(voice==voices.end())voice=std::min_element(voices.begin(),voices.end(),[](const auto& a,const auto& b){
            if(a.released!=b.released)return a.released;
            return a.age<b.age;
        });
        if(voice->note>=0 && *voice->gate>0){
            *voice->gate=0;
            float* scratchOut[]={scratch[0].data(),scratch[1].data()};
            voice->dsp->compute(1,nullptr,scratchOut);
        }
        voice->note=note;voice->channel=channel;voice->quiet=0;voice->age=++age;voice->sustained=voice->released=false;
        if(voice->freq)*voice->freq=440.0f*std::exp2((note-69)/12.0f);
        if(voice->key)*voice->key=static_cast<float>(note);
        if(voice->gain)*voice->gain=vel/127.0f;
        if(voice->velocity)*voice->velocity=static_cast<float>(vel);
        *voice->gate=1;
    }
    void midi(const Midi& e) {
        int type=e.status&0xf0, channel=e.status&15, key=e.data1&127, vel=e.data2&127;
        if(type==0x90 && vel>0){noteOn(channel,key,vel);return;}
        if(type==0x80 || type==0x90){
            Voice* first=nullptr;
            for(auto& v:voices)if(v.note==key && v.channel==channel && !v.released && !v.sustained && (!first || v.age<first->age))first=&v;
            if(first){if(pedal[channel])first->sustained=true;else release(*first);}
        }
        if(type==0xb0 && key==64){
            pedal[channel]=vel>=64;
            if(!pedal[channel])for(auto& v:voices)if(v.channel==channel && v.sustained)release(v);
        }
        if(type==0xb0 && (key==120 || key==123)){
            pedal[channel]=false;
            for(auto& v:voices)if(v.note>=0 && v.channel==channel){release(v);if(key==120)v.note=-1;}
        }
    }
    void reset() {
        pedal.fill(false);
        if(instrument)for(auto& v:voices){v.note=-1;*v.gate=0;v.dsp->instanceClear();}
        for(auto& effect:effects)effect->dsp->instanceClear();
    }
    void compute(float* left,float* right,int count,float gain,float pan,const float* inputL,const float* inputR,Probes* probes) {
        for(auto& c:controls)c->sync();
        if(!instrument && inputL && inputR){
            std::copy_n(inputL,count,bus[0].data());std::copy_n(inputR,count,bus[1].data());
        }else for(auto& channel:bus)std::fill_n(channel.data(),count,0.f);
        float* a[]={bus[0].data(),bus[1].data()};
        float* b[]={scratch[0].data(),scratch[1].data()};
        float** in=a;float** out=b;
        const bool timeInstrument=probes && probes->measuring("instrument");
        const auto started=timeInstrument?Probes::Clock::now():Probes::Clock::time_point{};
        for(auto& v:voices){
            if(v.note<0)continue;
            v.dsp->compute(count,nullptr,out);
            float peak=0;
            for(int i=0;i<count;++i){
                for(int ch=0;ch<2;++ch){
                    in[ch][i]+=out[ch][i];peak=std::max(peak,std::abs(out[ch][i]));
                }
            }
            if(v.released){v.quiet=peak<0.00001f?v.quiet+count:0;if(v.quiet>rate/10)v.note=-1;}
        }
        if(probes && instrument)probes->observe("instrument",in[0],in[1],count,rate,nullptr,nullptr,
            timeInstrument?std::chrono::duration<double>(Probes::Clock::now()-started).count():0);
        for(auto& effect:effects){
            const bool timed=probes && probes->measuring(effect->id);
            const auto start=timed?Probes::Clock::now():Probes::Clock::time_point{};
            const bool bypass=effect->bypass.load(std::memory_order_relaxed);
            if(!bypass)effect->dsp->compute(count,in,out);
            else if(effect->wetOnly){std::fill_n(out[0],count,0.f);std::fill_n(out[1],count,0.f);}
            auto** result=bypass&&!effect->wetOnly?in:out;
            if(probes)probes->observe(effect->id,result[0],result[1],count,rate,in[0],in[1],
                timed?std::chrono::duration<double>(Probes::Clock::now()-start).count():0);
            if(result==out)std::swap(in,out);
        }
        // Same stereo panning law as StereoPannerNode. Center is unity on both sides.
        const float angle=(pan<0?pan+1:pan)*1.57079632679f, c=std::cos(angle),s=std::sin(angle);
        for(int i=0;i<count;++i){
            const float l=in[0][i],r=in[1][i];
            left[i]=gain*(pan<0?l+r*c:l*c);
            right[i]=gain*(pan<0?r*s:r+l*s);
        }
    }
};
// Only the callback chooses the rendering bank. A second initialized bank lets
// a seek cut delay/reverb history at a block boundary without clearing large
// Faust buffers on the device thread.
struct RackState {
    std::array<std::unique_ptr<Graph>,2> banks;
    std::array<std::atomic<bool>,2> dirty{};
    std::atomic<float> gain,pan;
    std::mutex recycleMutex;
    int active=0;
    RackState(const Rack& rack,int rate):gain(std::clamp(rack.gain,0.f,10.f)),pan(std::clamp(rack.pan,-1.f,1.f)) {
        for(auto& bank:banks)bank=std::make_unique<Graph>(rack,rate);
    }
    Graph* graph() noexcept {
        if(active<0){
            for(int i=0;i<2;++i)if(!dirty[i].load(std::memory_order_acquire)){active=i;break;}
        }
        return active<0?nullptr:banks[active].get();
    }
    void cut() noexcept {
        if(active<0)return;
        dirty[active].store(true,std::memory_order_release);
        active=-1;
    }
    void recycle(){
        std::lock_guard lock(recycleMutex);
        for(int i=0;i<2;++i)if(dirty[i].load(std::memory_order_acquire)){
            banks[i]->reset();
            dirty[i].store(false,std::memory_order_release);
        }
    }
    void automate(uint32_t id,float value){
        const auto& controls=banks[0]->controls;
        for(size_t i=0;i<controls.size();++i)if(controls[i]->descriptor.id==id){
            for(auto& bank:banks)bank->controls[i]->set(value);
            break;
        }
    }
};
}

struct Core::Impl {
    Probes probes;
    // A callback pins each graph in the same slot for its entire audible life.
    // Reclamation never transfers owning pointers to the device thread.
    mutable std::mutex controlMutex;
    std::mutex loadMutex;
    std::vector<std::shared_ptr<RackState>> owned;
    std::atomic<RackState*> current{nullptr};
    std::array<std::atomic<RackState*>,2> pins{};
    std::atomic<bool> panic{false};
    std::array<std::array<uint8_t,128>,16> held{};
    std::array<bool,16> pedals{};
    Buffer outgoing{},fadeInput{};
    int slot=0,fade=0,fadeLength=1;
    float lastGain=1,lastPan=0,outGain=1,outPan=0;
    bool needChase=false;

    // One housekeeping thread for all rack instances (including idle tracks).
    // No device-thread locks, wake-ups or graph destruction on a transport cut.
    struct Recycler {
        std::mutex registry;
        std::vector<Impl*> members;
        std::atomic<bool> stop{false};
        std::thread thread;
        Recycler():thread([this]{
            std::vector<std::shared_ptr<RackState>> batch;
            while(!stop.load(std::memory_order_relaxed)){
                {
                    std::lock_guard registryLock(registry);
                    for(auto* core:members){
                        std::lock_guard lock(core->controlMutex);
                        auto* latest=core->current.load();
                        auto* a=core->pins[0].load();auto* b=core->pins[1].load();
                        batch.insert(batch.end(),core->owned.begin(),core->owned.end());
                        std::erase_if(core->owned,[&](auto& r){return r.get()!=latest&&r.get()!=a&&r.get()!=b;});
                    }
                }
                for(auto& rack:batch)rack->recycle();
                batch.clear();
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
            }
        }) {}
        ~Recycler(){stop.store(true);thread.join();}
    };
    static Recycler& recycler(){static Recycler instance;return instance;}
    Impl(){
        auto& worker=recycler();std::lock_guard lock(worker.registry);
        worker.members.push_back(this);
    }
    ~Impl(){
        auto& worker=recycler();std::lock_guard lock(worker.registry);
        std::erase(worker.members,this);
    }

    RackState* pinLatest(int index) {
        RackState* rack;
        do{rack=current.load();pins[index].store(rack);}while(rack!=current.load());
        return rack;
    }
    void chase(Graph& graph){
        for(int ch=0;ch<16;++ch){
            graph.pedal[ch]=pedals[ch];
            for(int key=0;key<128;++key)if(held[ch][key])graph.noteOn(ch,key,held[ch][key]);
        }
    }
    void remember(const Midi& e) {
        auto c=e.status&15,k=e.data1&127,v=e.data2&127;
        switch(e.status&0xf0){
            case 0x90: held[c][k]=static_cast<uint8_t>(v);break;
            case 0x80: held[c][k]=0;break;
            case 0xb0:
                if(k==64)pedals[c]=v>=64;
                if(k==120||k==123){held[c].fill(0);pedals[c]=false;}
                break;
        }
    }
};
Core::Core():impl(std::make_unique<Impl>()) {}
Core::~Core()=default;
Probes& Core::probes() noexcept{return impl->probes;}
void Core::load(const Rack& rack,double sampleRate) {
    if(!std::isfinite(sampleRate)||sampleRate<8000||sampleRate>384000)throw std::runtime_error("Invalid sample rate");
    if(!std::isfinite(rack.gain)||!std::isfinite(rack.pan))throw std::runtime_error("Invalid rack mix");
    // Preserve submission order within one instance; other instances can compile concurrently.
    std::lock_guard compileLock(impl->loadMutex);
    auto graph=std::make_shared<RackState>(rack,static_cast<int>(std::lround(sampleRate)));
    std::lock_guard lock(impl->controlMutex);
    auto* next=graph.get();
    impl->owned.push_back(std::move(graph));
    impl->current.store(next);
}
std::vector<Parameter> Core::parameters() const {
    std::lock_guard lock(impl->controlMutex);
    std::vector<Parameter> result;
    if(auto* graph=impl->current.load())for(auto& c:graph->banks[0]->controls)result.push_back(c->descriptor);
    return result;
}
bool Core::setParameter(std::string_view device,std::string_view address,float value) {
    if(!std::isfinite(value))return false;
    std::lock_guard lock(impl->controlMutex);
    if(auto* graph=impl->current.load())for(auto& c:graph->banks[0]->controls){
        if(c->descriptor.device==device && c->descriptor.address==address){graph->automate(c->descriptor.id,value);return true;}
    }
    return false;
}
bool Core::setBypass(std::string_view id,bool bypass) {
    std::lock_guard lock(impl->controlMutex);
    if(auto* rack=impl->current.load())for(size_t i=0;i<rack->banks[0]->effects.size();++i){
        if(rack->banks[0]->effects[i]->id==id){
            for(auto& bank:rack->banks)bank->effects[i]->bypass.store(bypass,std::memory_order_relaxed);
            return true;
        }
    }
    return false;
}
void Core::setMix(float gain,float pan) noexcept {
    std::lock_guard lock(impl->controlMutex);
    if(auto* rack=impl->current.load()){
        if(std::isfinite(gain))rack->gain.store(std::clamp(gain,0.f,10.f),std::memory_order_relaxed);
        if(std::isfinite(pan))rack->pan.store(std::clamp(pan,-1.f,1.f),std::memory_order_relaxed);
    }
}
void Core::prepareOfflineBlock() {
    std::lock_guard lock(impl->controlMutex);
    for(const auto& rack:impl->owned)rack->recycle();
}
void Core::reset() noexcept {impl->panic.store(true);}
void Core::render(float* left,float* right,int frames,std::span<const Midi> midi,
                  std::span<const ParameterChange> automation,const float* inL,const float* inR) noexcept {
    if(frames<=0 || !left || !right)return;
    auto& state=*impl;
    auto* rack=state.pins[state.slot].load();
    if(!rack)rack=state.pinLatest(state.slot);
    const bool reset=state.panic.exchange(false);
    if(reset){
        if(rack)rack->cut();
        state.pins[1-state.slot].store(nullptr);
        state.fade=0;state.held={};state.pedals={};state.needChase=false;
    }
    if(!state.fade && rack!=state.current.load()){
        const int newSlot=1-state.slot;
        auto* incoming=state.pinLatest(newSlot);
        state.outGain=state.lastGain;state.outPan=state.lastPan;
        if(rack && incoming && !reset){
            state.fade=state.fadeLength=std::max(1,incoming->banks[0]->rate/100);
        }else state.pins[state.slot].store(nullptr);
        state.slot=newSlot;rack=incoming;state.needChase=true;
    }
    Graph* graph=rack?rack->graph():nullptr;
    auto* previous=state.fade?state.pins[1-state.slot].load():nullptr;
    Graph* old=previous?previous->graph():nullptr;
    if(graph && state.needChase){state.chase(*graph);state.needChase=false;}
    if(!graph)state.needChase=true;
    auto* probes=state.probes.active()?&state.probes:nullptr;
    size_t m=0,p=0;
    const auto gainId=parameterId("mixer","gain"),panId=parameterId("mixer","pan");
    for(int pos=0;pos<frames;){
        while(m<midi.size() && midi[m].offset<=pos){
            if(midi[m].offset>=0){state.remember(midi[m]);if(graph)graph->midi(midi[m]);if(old)old->midi(midi[m]);}
            ++m;
        }
        while(p<automation.size() && automation[p].offset<=pos){
            const auto& change=automation[p++];
            if(!rack || change.offset<0 || !std::isfinite(change.value))continue;
            if(change.id==gainId)rack->gain.store(std::clamp(change.value,0.f,10.f),std::memory_order_relaxed);
            else if(change.id==panId)rack->pan.store(std::clamp(change.value,-1.f,1.f),std::memory_order_relaxed);
            else if(rack)rack->automate(change.id,change.value);
        }
        int end=pos+std::min(quantum,frames-pos);
        if(m<midi.size())end=std::min(end,midi[m].offset);
        if(p<automation.size())end=std::min(end,automation[p].offset);
        state.lastGain=rack?rack->gain.load(std::memory_order_relaxed):1.f;
        state.lastPan=rack?rack->pan.load(std::memory_order_relaxed):0.f;
        const float* sourceL=inL?inL+pos:nullptr;
        const float* sourceR=inR?inR+pos:nullptr;
        if(state.fade && sourceL && sourceR && (inL==left || inL==right || inR==left || inR==right)){
            std::copy_n(sourceL,end-pos,state.fadeInput[0].data());sourceL=state.fadeInput[0].data();
            std::copy_n(sourceR,end-pos,state.fadeInput[1].data());sourceR=state.fadeInput[1].data();
        }
        if(graph)graph->compute(left+pos,right+pos,end-pos,state.lastGain,state.lastPan,sourceL,sourceR,probes);
        else{std::fill(left+pos,left+end,0.f);std::fill(right+pos,right+end,0.f);}
        if(state.fade){
            const int n=std::min(end-pos,state.fade);
            auto* l=state.outgoing[0].data();auto* r=state.outgoing[1].data();
            if(old)old->compute(l,r,n,state.outGain,state.outPan,sourceL,sourceR,nullptr);
            else{std::fill_n(l,n,0.f);std::fill_n(r,n,0.f);}
            for(int i=0;i<n;++i,--state.fade){
                const float oldWeight=static_cast<float>(state.fade)/state.fadeLength;
                left[pos+i]+=oldWeight*(l[i]-left[pos+i]);
                right[pos+i]+=oldWeight*(r[i]-right[pos+i]);
            }
            if(!state.fade){
                old=nullptr;
                state.pins[1-state.slot].store(nullptr);
            }
        }
        if(probes)probes->observe("channel",left+pos,right+pos,end-pos,graph?graph->rate:48000);
        state.probes.meter(left+pos,right+pos,end-pos);
        pos=end;
    }
}
}
