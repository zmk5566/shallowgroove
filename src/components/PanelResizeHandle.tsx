import {useRef} from 'react';
export function PanelResizeHandle({value,min,max,onChange,zh,target="arrangement"}:{target?:"arrangement"|"mixer";value:number;min:number;max:number;onChange:(value:number)=>void;zh:boolean}){
 const drag=useRef<{y:number;height:number;value:number}|null>(null),clamp=(n:number)=>Math.max(min,Math.min(max,Math.round(n)));
 return <div className="panel-resize-handle" role="separator" aria-label={target==="mixer"?"Resize mixer and device chain":"Resize arrangement height"} aria-orientation="horizontal" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0} title={target==='mixer'?(zh?'拖动调整混音台和设备链高度 · 方向键微调':'Resize mixer and device chain · Arrow keys to adjust'):zh?'上下拖动调整总览高度 · 方向键微调':'Drag up/down to resize arrangement · Arrow keys to adjust'}
 onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();drag.current={y:e.clientY,height:e.currentTarget.closest('.workspace-panel')!.getBoundingClientRect().height,value};e.currentTarget.setPointerCapture(e.pointerId);}}
 onPointerMove={e=>{if(drag.current)onChange(clamp(drag.current.height+e.clientY-drag.current.y));}}
 onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{if(drag.current)onChange(drag.current.value);drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
 onKeyDown={e=>{if(e.key==='Escape'&&drag.current){onChange(drag.current.value);drag.current=null;e.preventDefault();}else if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();onChange(e.key==='Home'?min:e.key==='End'?max:clamp(value+(e.key==='ArrowUp'?-1:1)*(e.shiftKey?48:16)));}}}><span aria-hidden="true"/></div>;
}
