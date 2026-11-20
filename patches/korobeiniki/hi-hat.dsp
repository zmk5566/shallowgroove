import("stdfaust.lib");
declare name "Chip Hi-Hat";

freq = hslider("freq",440,20,20000,1);
gain = hslider("gain",0.5,0,1,0.001);
gate = button("gate");
attack = hslider("Attack[unit:s]",0.003,0.001,0.02,0.001);
release = hslider("Release[unit:s]",0.038,0.005,0.18,0.001);
brightness = hslider("Brightness",0.35,0,1,0.01) : si.smoo;

// Clocked one-bit noise gives the hat grain without tracking a pitched oscillator.
clock = os.phasor(1,12000);
grain = (2*(no.noise > 0)-1) : ba.sAndH(clock < clock');
color = grain : fi.highpass(2,1200) : fi.lowpass(2,2600+4000*brightness);
// The two SID accent keys give short and slightly longer closed hats.
tail = release*(1+0.35*(freq>3500));
voice = color*gain*0.32*en.adsr(attack,0.045,0.25,tail,gate);
process = voice <: _,_;
