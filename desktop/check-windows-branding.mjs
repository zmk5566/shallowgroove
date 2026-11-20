import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {NtExecutable,NtExecutableResource,Resource} from 'resedit';
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const ico=await readFile(new URL('./icons/shallowgroove.ico',import.meta.url));
const last=6+(ico.readUInt16LE(4)-1)*16;
const png=ico.subarray(ico.readUInt32LE(last+12),ico.readUInt32LE(last+12)+ico.readUInt32LE(last+8));
for(const path of process.argv.slice(2)){
 const resources=NtExecutableResource.from(NtExecutable.from(await readFile(path))).entries;
 const info=Resource.VersionInfo.fromEntries(resources)[0];assert.ok(info);
 const values=info.getStringValues(info.getAvailableLanguages()[0]);
 assert.ok([version,version+'.0'].includes(values.ProductVersion),values.ProductVersion);
 assert.ok(resources.some(entry=>entry.type===3&&Buffer.from(entry.bin).equals(png)),'Custom icon PNG missing from EXE');
}
console.log('PASS: Windows application/portable EXE version metadata and custom icons');
