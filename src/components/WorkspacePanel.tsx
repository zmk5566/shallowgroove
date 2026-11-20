import type {ReactNode} from 'react';
export function WorkspacePanel({id,title,summary,collapsed,onToggle,children}:{id:string;title:string;summary:string;collapsed:boolean;onToggle:()=>void;children:ReactNode}){
 return <section className={`workspace-panel ${collapsed?'is-collapsed':''}`} aria-label={title}>
  <button className="workspace-panel-toggle" aria-expanded={!collapsed} aria-controls={`${id}-content`} onClick={onToggle}><span aria-hidden="true">{collapsed?'▸':'▾'}</span><strong>{title}</strong><small>{summary}</small></button>
  <div id={`${id}-content`} className="workspace-panel-content" hidden={collapsed}>{children}</div>
 </section>;
}
