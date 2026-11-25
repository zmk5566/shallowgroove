import {useLayoutEffect,useRef,useState} from 'react';

export type PickerItem={key:string;name:string;disabled?:boolean;items?:PickerItem[]};
export type NodeGroup={name:string;items:PickerItem[]};

export function PerformanceNodePicker({groups,anchor,zh,onPick,onClose}:{
  groups:NodeGroup[];anchor:{x:number;y:number};zh:boolean;onPick:(key:string)=>void;onClose:()=>void;
}){
  const dialog=useRef<HTMLDialogElement>(null);
  const search=useRef<HTMLInputElement>(null);
  const [path,setPath]=useState<string[]>([]);
  const [query,setQuery]=useState('');
  const term=query.trim().toLowerCase();
  const words=term.split(/\s+/);
  const root:PickerItem[]=groups.map(g=>({...g,key:g.name,disabled:!g.items.length}));
  let level=root,category='';
  for(const key of path){
    const group=level.find(i=>i.key===key);if(!group?.items)break;
    level=group.items;category=group.name;
  }
  function matches(items:PickerItem[],prefix=''):PickerItem[]{
    return items.flatMap(item=>{
      const label=prefix+item.name;
      if(item.items)return matches(item.items,label+' / ');
      const text=(label+' '+item.key).toLowerCase();
      return words.every(word=>text.includes(word))?[{...item,name:label}]:[];
    });
  }
  const results=term?matches(root):level;
  useLayoutEffect(()=>{
    const el=dialog.current!;
    el.showModal();search.current?.focus();
    return ()=>el.close();
  },[]);
  useLayoutEffect(()=>{
    const el=dialog.current!;
    const place=()=>{
      el.style.left=Math.max(4,Math.min(anchor.x,window.innerWidth-el.offsetWidth-4))+'px';
      el.style.top=Math.max(4,Math.min(anchor.y,window.innerHeight-el.offsetHeight-4))+'px';
    };
    place();const observer=new ResizeObserver(place);observer.observe(el);
    window.addEventListener('resize',place);
    return ()=>{observer.disconnect();window.removeEventListener('resize',place);};
  },[anchor]);
  return <dialog className="perf-node-picker" ref={dialog} aria-label={zh?'添加节点':'Add node'} onCancel={onClose}
    onPointerDown={e=>{if(e.target===dialog.current){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}
    onKeyDown={e=>e.stopPropagation()}>
    <input ref={search} type="search" aria-label={zh?'搜索节点':'Search nodes'} placeholder={zh?'搜索节点…':'Search nodes…'} value={query} onChange={e=>setQuery(e.target.value)}
      onKeyDown={e=>{if(e.nativeEvent.isComposing)return;const first=results?.find(r=>!r.disabled);
        if(e.key==='Enter'&&term&&first){e.preventDefault();onPick(first.key);}
        else if(e.key==='ArrowDown'){e.preventDefault();dialog.current?.querySelector<HTMLButtonElement>('.perf-node-list button:not(:disabled)')?.focus();}}}/>
    {category&&!term&&<button className="perf-node-back" onClick={()=>{setPath(path.slice(0,-1));search.current?.focus();}}>‹ {category}</button>}
    <div className="perf-node-list">{results.map(item=><button key={item.key} disabled={item.disabled} onClick={()=>item.items?setPath([...path,item.key]):onPick(item.key)}>{item.name}{item.items&&<span>›</span>}</button>)}
      {results?.length===0&&<small>{zh?'没有匹配的节点':'No matching nodes'}</small>}
    </div>
  </dialog>;
}
