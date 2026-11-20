declare name "Channel EQ";
import("stdfaust.lib");
hp=hslider("Low Cut[unit:Hz]",20,20,800,1):si.smoo;
mid=hslider("Mid Frequency[unit:Hz]",500,100,4000,1):si.smoo;
level=hslider("Mid[unit:dB]",0,-12,12,0.1);
high=hslider("High[unit:dB]",0,-12,12,0.1);
channel=fi.highpass(2,max(20,hp)):fi.peak_eq(level,max(100,mid),max(100,mid)):fi.high_shelf1(high,6000);
process=channel,channel;
