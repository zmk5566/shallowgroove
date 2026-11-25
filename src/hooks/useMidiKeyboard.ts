import {useEffect,useEffectEvent,useState} from 'react';

export function useMidiKeyboard(onMessage:(data:number[],deviceId:string)=>void,onDisconnect:(deviceId:string)=>void,onError:(message:string)=>void){
 const [access,setAccess]=useState<MIDIAccess|null>(null),[devices,setDevices]=useState<MIDIInput[]>([]);
 const [disabled,setDisabled]=useState<string[]>(()=>{try{const ids=JSON.parse(localStorage.getItem('shallowgroove.disabledMidiInputs')??'[]');return Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[];}catch{return [];}});
 const enabled=(id:string)=>!disabled.includes(id);
 function setEnabled(id:string,value:boolean){
  const ids=value?disabled.filter(port=>port!==id):[...new Set([...disabled,id])];
  setDisabled(ids);try{localStorage.setItem('shallowgroove.disabledMidiInputs',JSON.stringify(ids));}catch{}
 }
 const message=useEffectEvent(onMessage),disconnect=useEffectEvent(onDisconnect),error=useEffectEvent(onError);
 async function connect(){
  if(!navigator.requestMIDIAccess)throw Error('当前窗口不支持 MIDI 输入 / MIDI input is unavailable');
  if(!access)setAccess(await navigator.requestMIDIAccess({sysex:false}));
 }
 useEffect(()=>{
  if(!access)return;
  function update(){setDevices(Array.from(access!.inputs.values()).filter(input=>input.state==='connected'));}
  function change(event:MIDIConnectionEvent){if(event.port?.type==='input'&&event.port.state==='disconnected'&&enabled(event.port.id))disconnect(event.port.id);update();}
  update();access.addEventListener('statechange',change);return()=>access.removeEventListener('statechange',change);
 },[access,disabled]);
 useEffect(()=>{
  const inputs=devices.filter(port=>enabled(port.id));
  function receive(event:MIDIMessageEvent){if(event.data&&event.currentTarget)message(Array.from(event.data),(event.currentTarget as MIDIInput).id);}
  for(const input of inputs){input.addEventListener('midimessage',receive);void input.open().catch(e=>error(String(e)));}
  return()=>{for(const input of inputs)input.removeEventListener('midimessage',receive);};
 },[devices,disabled]);
 return {connect,devices,enabled,setEnabled};
}
