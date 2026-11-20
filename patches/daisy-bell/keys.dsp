import("stdfaust.lib");
declare name "Daisy Pulse Keys";
freq = hslider("freq",440,20,20000,1);
gain = hslider("gain",0.5,0,1,0.001);
gate = button("gate");
attack = hslider("Attack[unit:s]",0.005,0.001,0.5,0.001);
decay = hslider("Decay[unit:s]",0.18,0.005,1,0.005);
sustain = hslider("Sustain",0.52,0,1,0.01);
release = hslider("Release[unit:s]",0.19,0.02,0.45,0.005);
brightness = hslider("Brightness",0.42,0,1,0.01) : si.smoo;
pitch = freq*1.0305;
phase = 2*ma.PI*os.phasor(1,pitch);
// Odd partials dominate the held accompaniment chords in the transfer.
body = sin(phase)+brightness*(0.52*sin(3*phase)+0.20*sin(5*phase))
       +0.12*sin(2*phase);
voice = body*0.24*gain*en.adsr(attack,decay,sustain,release,gate);
process = voice <: _,_;
