import {test} from 'node:test';
import assert from 'node:assert/strict';
import {overviewPaths,overviewWindow} from '../src/model/note-overview.ts';

test('zoom windows include the viewport and remain stable across nearby pans',()=>{
 for(const span of [1,.65,.5,.11,1/256])for(const fraction of [0,.1,.42,1]){
  const start=(1-span)*fraction,{left,right}=overviewWindow(start,span);
  assert.ok(left<=start*1000&&right+1e-9>=(start+span)*1000);
  assert.ok(left>=0&&right<=1000);
 }
 assert.deepEqual(overviewWindow(.321,.1),overviewWindow(.322,.1));
});
test('overview groups visible notes by velocity, retaining notes crossing either edge',()=>{
 const index={notes:[{x:2,right:60,y:1,velocity:80},{x:10,right:20,y:3,velocity:64},{x:48,right:75,y:6,velocity:80},{x:52,right:53,y:2,velocity:64}],ends:[60,60,75,75]};
 assert.deepEqual(overviewPaths(index,45,52),[{velocity:80,d:'M2 1H60v2.5H2ZM48 6H75v2.5H48Z'}]);
 assert.deepEqual(overviewPaths(index,75,90),[]);
});
