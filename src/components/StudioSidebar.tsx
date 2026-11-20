import {useEffect,useRef,useState,type ReactNode} from 'react';
import {InspectorSection} from './InspectorSection';

export function StudioSidebar({zh,hardware,inspectorKey,children}:{zh:boolean;hardware:ReactNode;inspectorKey:string;children:(heading:ReactNode)=>ReactNode}){
 const [open,setOpen]=useState(()=>localStorage.getItem('shallowgroove.sidebar.open')!=='false');
 const [chatOpen,setChatOpen]=useState(()=>localStorage.getItem('shallowgroove.chat.open')!=='false');
 const [height,setHeight]=useState(()=>Number(localStorage.getItem('shallowgroove.chat.height'))||0);
 const body=useRef<HTMLDivElement>(null),chat=useRef<HTMLDivElement>(null);
 const drag=useRef<{y:number;height:number}|null>(null);
 useEffect(()=>{localStorage.setItem('shallowgroove.sidebar.open',String(open));},[open]);
 useEffect(()=>{localStorage.setItem('shallowgroove.chat.open',String(chatOpen));},[chatOpen]);
 useEffect(()=>{
  const expand=()=>setOpen(true);
  const focusChat=()=>{expand();setChatOpen(true);};
  window.addEventListener('shallowgroove-effect-request',focusChat);
  window.addEventListener('shallowgroove-show-sidebar',expand);
  return()=>{window.removeEventListener('shallowgroove-effect-request',focusChat);window.removeEventListener('shallowgroove-show-sidebar',expand);};
 },[]);
 function resize(value:number){
  const next=Math.min(Math.max(200,value),Math.max(0,(body.current?.clientHeight??0)-76));
  setHeight(next);return next;
 }
 const heading=<button className="chat-fold" aria-expanded={chatOpen} onClick={()=>setChatOpen(!chatOpen)}>{chatOpen?'▾':'▸'} {zh?'声音助手':'Sound assistant'}</button>;
 return <aside className={'studio-sidebar '+(open?'expanded':'collapsed')} aria-label={zh?'声音助手与 Hexblocks':'Assistant and Hexblocks'}>
  <button className="sidebar-fold" aria-label={open?'Collapse sidebar':'Expand sidebar'} aria-expanded={open} aria-controls="studio-sidebar-content" onClick={()=>setOpen(!open)}>{open?'›':'‹'}<span>AI · HEX</span></button>
  <div ref={body} id="studio-sidebar-content" className="sidebar-content" hidden={!open}>
   <div className="sidebar-monitors" style={{flexGrow:height||!chatOpen?1:0}}>{hardware}<InspectorSection key={inspectorKey} zh={zh} visible={open} reveal={()=>setOpen(true)}/></div>
   {chatOpen&&<div role="separator" aria-orientation="horizontal" aria-label={zh?'调整对话高度':'Resize chat'} tabIndex={0} className="chat-divider"
    onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={y:e.clientY,height:chat.current!.clientHeight};}}
    onPointerMove={e=>{if(drag.current)resize(drag.current.height+drag.current.y-e.clientY);}}
    onLostPointerCapture={()=>{drag.current=null;localStorage.setItem('shallowgroove.chat.height',String(chat.current!.clientHeight));}}
    onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const next=resize(chat.current!.clientHeight+(e.key==='ArrowUp'?24:-24));localStorage.setItem('shallowgroove.chat.height',String(next));}}}/>}
   <div ref={chat} className={'sidebar-chat '+(chatOpen?'open':'folded')} style={chatOpen&&height?{flex:'0 0 auto',height}:undefined}>{children(heading)}</div>
  </div>
 </aside>;
}
