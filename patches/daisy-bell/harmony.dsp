import("stdfaust.lib");
declare name "Daisy Reed Lead";
freq = hslider("freq",440,20,20000,1);
gain = hslider("gain",0.5,0,1,0.001);
gate = button("gate");
attack = hslider("Attack[unit:s]",0.006,0.001,0.5,0.001);
decay = hslider("Decay[unit:s]",0.14,0.005,1,0.005);
sustain = hslider("Sustain",0.88,0,1,0.01);
release = hslider("Release[unit:s]",0.16,0.02,0.45,0.005);
warmth = hslider("Warmth",0.26,0,1,0.01) : si.smoo;
pitch = freq*1.0305;
phase = 2*ma.PI*os.phasor(1,pitch);
reed = 0.42*sin(phase) + sin(3*phase) + (0.44+0.4*warmth)*sin(5*phase)
       + 0.24*sin(7*phase) + 0.12*sin(9*phase);
swell = hslider("Swell[unit:s]",0.075,0.005,0.6,0.005);
// Most of the reed speaks at the onset; the remaining level blooms afterwards.
body = 0.72 + 0.28*en.adsr(swell,0.01,1,release,gate);
voice = reed*0.24*gain*body*en.adsr(attack,decay,sustain,release,gate);
process = voice <: _,_;
