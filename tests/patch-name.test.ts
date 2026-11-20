import {test} from 'node:test';import assert from 'node:assert/strict';
import {declaredPatchName,instrumentName} from '../src/model/patch-name.ts';
test('Faust names ignore comments and string contents',()=>{
 assert.equal(declaredPatchName('// declare name "old";\n/* declare name "wrong"; */\ndeclare name "清晰 Pluck";'),'清晰 Pluck');
 assert.equal(declaredPatchName('x=hslider("declare name \\"fake\\";",0,0,1,1);'),undefined);
 assert.equal(declaredPatchName('declare name "Stereo \\"Echo\\"";'),'Stereo "Echo"');
});
test('replaced instruments use current metadata or custom fallback, retaining original localized names only for original source',()=>{
 const original='declare name "Original"; process=0;';
 assert.equal(instrumentName(original,original,'原音色','自定义'),'原音色');
 assert.equal(instrumentName('declare name "New sound"; process=0;',original,'原音色','自定义'),'New sound');
 assert.equal(instrumentName('process=1;',original,'原音色','自定义'),'自定义');
});
