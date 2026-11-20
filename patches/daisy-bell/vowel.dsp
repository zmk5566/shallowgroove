import("stdfaust.lib");
declare name "Daisy FM Voice";
freq = hslider("freq",440,20,20000,1);
gain = hslider("gain",0.5,0,1,0.001);
gate = button("gate");
attack = hslider("Attack[unit:s]",0.009,0.001,0.5,0.001);
decay = hslider("Decay[unit:s]",0.17,0.005,1,0.005);
sustain = hslider("Sustain",0.74,0,1,0.01);
release = hslider("Release[unit:s]",0.13,0.02,0.45,0.005);
vowel = hslider("Vowel",0.74,0,1,0.01) : si.smoo;
hiss = hslider("Frication",0,0,1,0.01) : si.smoo;
pitch = freq*1.0305;
phase = 2*ma.PI*os.phasor(1,pitch);
pulse = os.sawtooth(pitch)+0.13*sin(phase+0.7*sin(phase));
mouth(u,o,a,e,i) = u+(o-u)*segment(0)+(a-o)*segment(1)+(e-a)*segment(2)+(i-e)*segment(3)
with { segment(n)=max(0,min(1,4*vowel-n)); };
f1 = mouth(300,430,730,395,280);
f2 = mouth(850,980,1260,1900,2230);
res(f,bw) = fi.resonbp(f,f/bw,bw/f);
oral = (pulse : res(f1,110)) + 2.05*(pulse : res(f2,155)) + 1.15*(pulse : res(2470,200));
consonant = no.noise : fi.highpass(2,1550) : fi.lowpass(2,4300);
voice = ((0.14*sin(phase)+3.4*oral)*(1-0.72*hiss)+0.30*hiss*consonant)
        *gain*0.45*en.adsr(attack,decay,sustain,release,gate);
process = voice <: _,_;
