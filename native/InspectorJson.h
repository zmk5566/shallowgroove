#pragma once
#include "Probe.h"
#include "RackJson.h"
#include <complex>
#include <numbers>

namespace sg::wire {
inline String plotWave(const std::array<float,ProbeFrame::length>& ring,uint64_t cursor) {
    std::array<unsigned char,1024> wave;
    for(size_t i=0;i<wave.size();++i){
        float v=ring[(cursor+ring.size()-wave.size()+i)%ring.size()];
        wave[i]=static_cast<unsigned char>(std::clamp(std::lround(v*128.f+128.f),0l,255l));
    }
    return juce::Base64::toBase64(wave.data(),wave.size());
}
// FFT and JSON encoding run on the control thread after releasing the device lock.
inline String plotSpectrum(const std::array<float,ProbeFrame::length>& ring,uint64_t cursor){
    constexpr size_t N=ProbeFrame::length;
    std::array<std::complex<float>,N> a;
    constexpr double tau=2*std::numbers::pi;
    static const auto window=[]{
        std::array<float,N> w;
        for(size_t i=0;i<N;++i)w[i]=float(.42-.5*std::cos(tau*i/N)+.08*std::cos(2*tau*i/N));
        return w;
    }();
    for(size_t i=0,j=0;i<N;++i){
        a[j]=ring[(cursor+i)%N]*window[i];
        size_t bit=N>>1;
        while(bit && (j&bit)){j^=bit;bit>>=1;}
        j^=bit;
    }
    for(size_t size=2;size<=N;size*=2){
        const auto step=std::polar(1.f,float(-tau/size));
        for(size_t i=0;i<N;i+=size){
            std::complex<float> w=1;
            for(size_t j=0;j<size/2;++j,w*=step){
                auto u=a[i+j],v=w*a[i+j+size/2];a[i+j]=u+v;a[i+j+size/2]=u-v;
            }
        }
    }
    std::array<unsigned char,N/2> out;
    for(size_t k=0;k<out.size();++k){
        const auto db=20*std::log10(std::max(1e-10f,std::abs(a[k])/N));
        out[k]=static_cast<unsigned char>(std::clamp((db+100)*255/70,0.f,255.f));
    }
    return juce::Base64::toBase64(out.data(),out.size());
}
inline var inspectFrame(const ProbeFrame& p,double rate,bool input,bool wave,bool frequencies,bool performance){
    var out=object();put(out,"seconds",p.samples/rate);
    auto lines=[&](auto encode){
        juce::Array<var> result;if(input)result.add(encode(p.input,p.samples));result.add(encode(p.output,p.samples));return result;
    };
    if(wave)put(out,"wave",lines(plotWave));
    if(frequencies)put(out,"spectrum",lines(plotSpectrum));
    if(performance && p.measuredSamples){
        put(out,"average",p.measuredSeconds*rate*100/p.measuredSamples);put(out,"peak",p.peak);
    }
    return out;
}
}
