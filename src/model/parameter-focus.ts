import type {MouseEvent} from 'react';
export interface ParameterRef {trackId:string;device:string;address:string}
export interface ParameterEdit extends ParameterRef {value:number;at:number;generation:string}
export function rememberParameter(previous:ParameterEdit[],next:ParameterEdit){return [next,...previous.filter(p=>p.generation===next.generation&&!(p.trackId===next.trackId&&p.device===next.device&&p.address===next.address))].slice(0,5);}
export function parameterMenu(event:MouseEvent,target:ParameterRef){event.preventDefault();event.stopPropagation();window.dispatchEvent(new CustomEvent('shallowgroove-parameter-menu',{detail:{...target,x:event.clientX,y:event.clientY}}));}
export function parameterEdited(target:ParameterRef,value:number){window.dispatchEvent(new CustomEvent('shallowgroove-parameter-edited',{detail:{...target,value}}));}
