declare name "Saturator";
import("stdfaust.lib");
drive=hslider("Drive[unit:dB]",3,0,30,0.1):ba.db2linear:si.smoo;
gain=hslider("Output[unit:dB]",-2,-30,6,0.1):ba.db2linear:si.smoo;
mix=hslider("Mix",0.7,0,1,0.01):si.smoo;
channel(x)=x*(1-mix)+ma.tanh(x*drive)*gain*mix;
process=channel,channel;
