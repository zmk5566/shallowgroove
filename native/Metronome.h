#pragma once
#include "RackJson.h"
#include <algorithm>
#include <cstdint>
#include <vector>

namespace sg::standalone {
struct BeatSegment {
    double seconds,tick,ppqn,bpm,slope,origin,step;
    int beats;
    double tickAt(double time) const {
        const double dt=time-seconds;
        return tick+(std::abs(slope)<1e-12?dt*ppqn*bpm/60:bpm*std::expm1(dt*ppqn*slope/60)/slope);
    }
    double timeAt(double at) const {
        const double delta=at-tick;
        return seconds+(std::abs(slope)<1e-12?delta*60/(ppqn*bpm):60*std::log1p(slope*delta/bpm)/(ppqn*slope));
    }
};

struct Metronome {
    bool enabled=false;
    std::vector<BeatSegment> grid;
    int countToken=0,countBeats=0,beatsPerBar=4;
    double interval=0;
    int64_t elapsed=0,countLength=0;
    int age=-1;
    double frequency=0;
    bool counting() const {return elapsed<countLength;}
    int displayedBeat() const {
        return counting()?std::min(countBeats-1,int(std::floor((elapsed+.5)/interval))):countBeats;
    }
    void configure(const juce::var& q,double rate){
        using namespace sg::wire;
        enabled=q["metronome"];
        if(auto* rows=q["beatGrid"].getArray()){
            grid.reserve(rows->size());
            for(const auto& row:*rows){
                BeatSegment segment{number(row["seconds"],0,1e12),number(row["tick"],0,1e12),
                    number(row["ppqn"],1,32767),number(row["bpm"],1,6e7),number(row["slope"],-1e9,1e9),
                    number(row["origin"],0,1e12),number(row["step"],.0001,1e9),int(number(row["beats"],1,255))};
                if(!grid.empty()&&grid.back().seconds>segment.seconds)throw std::runtime_error("Unsorted metronome grid");
                grid.push_back(segment);
            }
        }
        if(q.hasProperty("countIn")){
            const auto c=q["countIn"];
            countToken=int(number(c["token"],1,2147483647));
            countBeats=int(number(c["total"],1,1020));
            beatsPerBar=int(number(c["beats"],1,255));
            interval=rate*number(c["interval"],1e-6,600);
            countLength=std::max<int64_t>(1,std::llround(countBeats*interval));
        }
    }
    void click(bool accent){age=0;frequency=accent?1500:950;}
    void tone(float* l,float* r,int n,double rate){
        if(age<0)return;
        const int duration=int(std::ceil(rate*.05));
        for(int i=0;i<n&&age<duration;i++,age++){
            const double sec=age/rate;
            const float sample=float(.12*std::exp(-std::log(1200.)*std::min(sec/.045,1.))*std::sin(6.283185307179586*frequency*sec));
            l[i]+=sample;r[i]+=sample;
        }
        if(age>=duration)age=-1;
    }
    template<class Trigger> void beatsBetween(int64_t frame,int n,double rate,Trigger trigger) const {
        if(grid.empty())return;
        const double lower=(frame-.5)/rate,upper=(frame+n-.5)/rate;
        auto seg=std::upper_bound(grid.begin(),grid.end(),lower,[](double s,const BeatSegment& b){return s<b.seconds;});
        if(seg!=grid.begin())--seg;
        for(;seg!=grid.end()&&seg->seconds<=upper;++seg){
            const auto next=std::next(seg);
            auto beat=std::max<int64_t>(0,int64_t(std::ceil((seg->tickAt(std::max(lower,seg->seconds))-seg->origin)/seg->step-1e-9)));
            for(;;++beat){
                const double tick=seg->origin+beat*seg->step;
                if(next!=grid.end()&&tick>=next->tick)break;
                const double time=seg->timeAt(tick);
                if(!std::isfinite(time)||time>upper+1e-9)break;
                const auto at=std::llround(time*rate);
                if(at>=frame+n)break;
                if(at>=frame)trigger(int(at-frame),beat%seg->beats==0);
            }
        }
    }
    void render(float* l,float* r,int n,double rate,int64_t frame,bool rolling){
        int pos=0;
        auto hit=[&](int at,bool accent){tone(l+pos,r+pos,at-pos,rate);pos=at;click(accent);};
        if(counting()){
            for(int beat=std::max(0,int(std::ceil((elapsed-.5)/interval)));beat<countBeats;beat++){
                auto at=std::llround(beat*interval)-elapsed;
                if(at>=n)break;
                if(at>=0)hit(int(at),beat%beatsPerBar==0);
            }
            elapsed+=n;
        }else if(rolling&&enabled)beatsBetween(frame,n,rate,hit);
        tone(l+pos,r+pos,n-pos,rate);
    }
};
}
