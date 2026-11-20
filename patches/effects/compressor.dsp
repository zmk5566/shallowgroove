declare name "Stereo Compressor";
import("stdfaust.lib");
threshold=hslider("Threshold[unit:dB]",-18,-48,0,0.5):si.smoo;
ratio=hslider("Ratio",4,1,12,0.1):si.smoo;
attack=hslider("Attack[unit:ms]",10,1,100,1)*0.001;
release=hslider("Release[unit:ms]",120,20,800,5)*0.001;
makeup=hslider("Makeup[unit:dB]",0,0,18,0.5):ba.db2linear:si.smoo;
// Shared detector preserves the stereo image. Faust standard-library gain law.
compress(l,r)=l*g*makeup,r*g*makeup with {
 g=co.compression_gain_mono(ratio,threshold,attack,release,max(abs(l),abs(r)));
};
process=compress;
