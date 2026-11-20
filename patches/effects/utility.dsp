declare name "Stereo Utility";
import("stdfaust.lib");
gain=hslider("Gain[unit:dB]",0,-36,12,0.1):ba.db2linear:si.smoo;
width=hslider("Width[unit:%]",100,0,200,1)*0.01:si.smoo;
stereo(l,r)=gain*(m+s),gain*(m-s) with {m=(l+r)*0.5;s=(l-r)*0.5*width;};
process=stereo;
