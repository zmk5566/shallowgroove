#pragma once
#include "Core.h"
#include <juce_core/juce_core.h>
#include <cmath>
#include <stdexcept>

namespace sg::wire {
using juce::var;
using juce::String;
inline var object() { return new juce::DynamicObject; }
inline void put(var& target,const juce::Identifier& key,var value){ target.getDynamicObject()->setProperty(key,std::move(value)); }
inline bool has(const var& v,const char* key){return v.hasProperty(key);}
inline double number(const var& v,double lo,double hi){
 if (!(v.isInt()||v.isDouble()||v.isInt64()||v.isBool())) throw std::runtime_error("Expected numeric field");
 const auto n=static_cast<double>(v);
 if (!std::isfinite(n)||n<lo||n>hi) throw std::runtime_error("Number out of range");
 return n;
}
inline double field(const var& v,const char* key,double fallback,double lo,double hi){
 return has(v,key)?number(v[key],lo,hi):fallback;
}
inline std::string text(const var& v,const char* key){
 const auto value=v[key];
 if(!value.isString()||value.toString().isEmpty())throw std::runtime_error(std::string("Missing ")+key);
 return value.toString().toStdString();
}
inline Values values(const var& v){
 Values result;
 if(!v.isVoid()){
  const auto* obj=v.getDynamicObject();
  if(!obj)throw std::runtime_error("Invalid parameter values");
  for(const auto& p:obj->getProperties()) result.emplace(p.name.toString().toStdString(),number(p.value,-1e12,1e12));
 }
 return result;
}
inline Rack rack(const var& v,bool bus=false){
 Rack r;
 if(!bus)r.instrument=text(v,"instrument");r.values=values(v["values"]);
 r.gain=field(v,"gain",1,0,10);r.pan=field(v,"pan",0,-1,1);
 if(has(v,"effects")){
  const auto* fx=v["effects"].getArray();
  if(!fx||fx->size()>64)throw std::runtime_error("Invalid effect chain");
  for(const auto& f:*fx)r.effects.push_back({text(f,"id"),text(f,"code"),values(f["values"]),bool(f["bypass"]),bool(f["wetOnly"])});
 }
 return r;
}
inline var json(const Values& values){
 auto out=object();
 for(const auto& [path,value]:values)put(out,String(path),value);
 return out;
}
inline var json(const Rack& r){
 auto out=object();juce::Array<var> effects;
 put(out,"instrument",String(r.instrument));put(out,"values",json(r.values));put(out,"gain",r.gain);put(out,"pan",r.pan);
 for(const auto& f:r.effects){
  auto e=object();put(e,"id",String(f.id));put(e,"code",String(f.code));put(e,"values",json(f.values));put(e,"bypass",f.bypass);if(f.wetOnly)put(e,"wetOnly",true);effects.add(e);
 }
 put(out,"effects",effects);return out;
}
inline var json(const Parameter& p){
 auto o=object();put(o,"device",String(p.device));put(o,"address",String(p.address));put(o,"label",String(p.label));put(o,"min",p.min);put(o,"max",p.max);put(o,"init",p.init);put(o,"step",p.step);return o;
}
}
