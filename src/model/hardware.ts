export interface HardwareMapping {id:string;connectorId:string;uid:string;channel:number;trackId:string;device:string;address:string;label:string;inputMin:number;inputMax:number;outputMin:number;outputMax:number;curve:'linear'|'log';invert:boolean;smoothingMs:number;enabled:boolean}
export function validateMappings(value:unknown):asserts value is HardwareMapping[]|undefined {
 if(value===undefined)return;if(!Array.isArray(value)||value.length>128)throw Error('Invalid hardware mappings');const ids=new Set(),targets=new Set();
 for(const m of value){
  if(!m||typeof m.id!=='string'||ids.has(m.id)||typeof m.connectorId!=='string'||!/^[\w.-]{1,80}$/.test(m.connectorId)||typeof m.uid!=='string'||!/^[A-F0-9]{8}$/.test(m.uid)||!Number.isInteger(m.channel)||m.channel<0||m.channel>255||![m.trackId,m.device,m.address,m.label].every(v=>typeof v==='string'&&v.length>0&&v.length<=300)||![m.inputMin,m.inputMax,m.outputMin,m.outputMax,m.smoothingMs].every(Number.isFinite)||m.inputMin>=m.inputMax||m.outputMin>=m.outputMax||!['linear','log'].includes(m.curve)||(m.curve==='log'&&m.outputMin<=0)||m.smoothingMs<0||m.smoothingMs>2000||typeof m.enabled!=='boolean'||typeof m.invert!=='boolean')throw Error('Invalid hardware mapping');
  const target=JSON.stringify([m.trackId,m.device,m.address]);if(m.enabled&&targets.has(target))throw Error('Only one enabled hardware mapping per parameter');if(m.enabled)targets.add(target);ids.add(m.id);
 }
}
export function mappedValue(m:HardwareMapping,input:number){if(!Number.isFinite(input))throw Error('Invalid sensor value');let n=Math.max(0,Math.min(1,(input-m.inputMin)/(m.inputMax-m.inputMin)));if(m.invert)n=1-n;return m.curve==='log'?m.outputMin*Math.pow(m.outputMax/m.outputMin,n):m.outputMin+(m.outputMax-m.outputMin)*n;}
export const hardwareKey=(m:Pick<HardwareMapping,'trackId'|'device'|'address'>)=>JSON.stringify([m.trackId,m.device,m.address]);
