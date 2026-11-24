import assert from 'node:assert/strict';
import {test} from 'node:test';
import {libraryParameters} from '../src/audio/library-parameters.ts';

test('factory labels and stable Faust addresses apply only to supported controls',()=>{
 const controls=[{label:'Mix',address:'/echo/Mix',min:0,max:1},{label:'Time',address:'/echo/Time',min:1,max:500}];
 const values={Mix:.5,'/echo/Mix':.2,Time:600,'/removed/Feedback':10};
 assert.deepEqual(libraryParameters(controls,values),{'/echo/Mix':.2,'/echo/Time':500});
 assert.deepEqual(libraryParameters(controls,{Time:NaN}),{});
});
