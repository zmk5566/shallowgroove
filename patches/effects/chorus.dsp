declare name "Stereo Chorus";
import("stdfaust.lib");
rate=hslider("Rate[unit:Hz]",0.5,0.05,5,0.01);
depth=hslider("Depth[unit:ms]",3,0,8,0.1):si.smoo;
mix=hslider("Mix",0.35,0,1,0.01):si.smoo;
lfo=os.osc(rate);
channel(sign,x)=x*(1-mix)+mix*de.fdelay(8192,min(8191,(12+sign*lfo*depth)*ma.SR/1000),x);
process=channel(1),channel(-1);
