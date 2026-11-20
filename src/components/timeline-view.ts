import {createContext} from 'react';

// Fractions of the whole arrangement keep the viewport valid after a tempo change.
export type TimelineView={start:number;span:number};
export const wholeTimeline:TimelineView={start:0,span:1};
export const TimelineViewContext=createContext(wholeTimeline);

export function panTimeline(view:TimelineView,delta:number):TimelineView{
 return {...view,start:Math.max(0,Math.min(1-view.span,view.start+delta))};
}

export function zoomTimeline(view:TimelineView,anchor:number,factor:number):TimelineView{
 const span=Math.max(1/256,Math.min(1,view.span*factor));
 return panTimeline({start:view.start,span},(view.span-span)*anchor);
}
