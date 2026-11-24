#pragma once
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>

namespace sg {
struct ProbeFrame {
    static constexpr size_t length=4096;
    std::array<float,length> input{},output{};
    uint64_t samples=0;
    double measuredSeconds=0,peak=0;
    uint64_t measuredSamples=0;
};
struct Probe : ProbeFrame {
    std::string device;
    bool audio=false,timing=false;
    int lease=0;
    void capture(const float* l,const float* r,const float* inL,const float* inR,int n){
        if(audio)for(int i=0;i<n;++i){
            auto j=(samples+i)%length;
            output[j]=(l[i]+r[i])*.5f;
            if(inL)input[j]=(inL[i]+inR[i])*.5f;
        }
        samples+=n;
        lease=std::max(0,lease-n);
    }
};
// The standalone host serializes configuration/snapshots against its render callback.
// Core's plugin path does not enable any taps. No allocation or FFT happens on the callback.
class Probes {
    std::map<std::string,Probe> sinks;
    int meterLease=0,meterFrames=0;
    std::array<double,2> sums{};
public:
    using Clock=std::chrono::steady_clock;
    bool active()const{return !sinks.empty();}
    bool measuring(const std::string_view device)const{
        for(auto& [_,p]:sinks)if(p.lease && p.timing && p.device==device)return true;
        return false;
    }
    void observe(std::string_view device,const float* l,const float* r,int n,double rate,
                 const float* inL=nullptr,const float* inR=nullptr,double elapsed=0){
        for(auto& [_,p]:sinks)if(p.lease && p.device==device){
            if(p.timing){p.measuredSeconds+=elapsed;p.measuredSamples+=n;p.peak=std::max(p.peak,100*elapsed*rate/n);}
            p.capture(l,r,inL,inR,n);
        }
    }
    void meter(const float* l,const float* r,int n){
        if(!meterLease)return;
        for(int i=0;i<n;++i){sums[0]+=double(l[i])*l[i];sums[1]+=double(r[i])*r[i];}
        meterFrames+=n;meterLease=std::max(0,meterLease-n);
    }
    std::array<double,2> readMeter(double rate){
        std::array<double,2> result{};
        if(meterFrames)for(int i=0;i<2;++i)result[i]=std::sqrt(sums[i]/meterFrames);
        sums={};meterFrames=0;meterLease=std::max(1,int(rate/2));
        return result;
    }
    ProbeFrame read(const std::string& token,const std::string& device,bool audio,bool timing,double rate){
        if(!sinks.contains(token))std::erase_if(sinks,[](const auto& entry){return entry.second.lease==0;});
        if(!sinks.contains(token) && sinks.size()>=64)throw std::runtime_error("Too many native inspector taps");
        auto& p=sinks[token];p.device=device;p.audio=audio;p.timing=timing;p.lease=std::max(1,int(rate));
        auto frame=static_cast<const ProbeFrame&>(p);
        p.measuredSamples=0;p.measuredSeconds=0;p.peak=0;
        return frame;
    }
    void remove(const std::string& token){sinks.erase(token);}
};
}
