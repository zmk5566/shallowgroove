import {divisions,type Grid,type Division} from '../model/arrangement-grid';

export function GridMenu({grid,auto,zh,onChange}:{grid:Grid;auto:Division;zh:boolean;onChange:(g:Grid)=>void}){
 const label=(unit:Division)=>zh&&unit.includes('bar')?parseInt(unit)+' 小节':unit;
 const autoLabel=zh?'自动':'Auto',tripletLabel=zh?'三连音':'Triplet';
 const supportsTriplet=(mode:Grid['mode'])=>mode==='auto'||mode.includes('/');
 const value=grid.mode+(grid.triplet&&supportsTriplet(grid.mode)?'T':'');
 const effective=grid.mode==='auto'?label(auto)+(grid.triplet&&auto.includes('/')?'T':''):undefined;
 return <label className="grid-menu">{zh?'吸附':'Snap'}
  <select value={value} title={effective?autoLabel+' · '+effective:undefined} onChange={e=>{
   const choice=e.currentTarget.value,triplet=choice.endsWith('T');
   const mode=(triplet?choice.slice(0,-1):choice) as Grid['mode'];
   onChange({mode,triplet:supportsTriplet(mode)?triplet:grid.triplet});
  }}>
   <option value="off">{zh?'关闭':'Off'}</option><option value="auto">{autoLabel}</option>
   {divisions.map(mode=><option key={mode} value={mode}>{label(mode)}</option>)}
   <optgroup label={tripletLabel}><option value="autoT">{autoLabel} T</option>
    {divisions.filter(mode=>mode.includes('/')).map(mode=><option key={mode} value={mode+'T'}>{mode}T</option>)}
   </optgroup>
  </select>
 </label>;
}
