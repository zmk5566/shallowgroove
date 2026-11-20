declare name "Auto Filter";
import("stdfaust.lib");
cut=hslider("Cutoff[unit:Hz]",1800,60,16000,1):si.smoo;
depth=hslider("Depth[unit:oct]",1,0,3,0.01):si.smoo;
rate=hslider("Rate[unit:Hz]",0.4,0.05,8,0.01);
sync=hslider("Sync",0,0,1,1);
bpm=hslider("BPM",120,20,400,0.001);
freq=min(ma.SR*0.45,max(30,cut*pow(2,depth*os.osc(select2(sync,rate,bpm/60)))));
process=fi.lowpass(2,freq),fi.lowpass(2,freq);
