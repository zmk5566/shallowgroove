import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),icons=resolve(root,'desktop/icons');
const svg=await readFile(resolve(icons,'shallowgroove.svg'));
await sharp(svg).png().toFile(resolve(icons,'shallowgroove.png'));
await mkdir(resolve(root,'public'),{recursive:true});
await sharp(svg).resize(64,64).png().toFile(resolve(root,'public/favicon.png'));
const sizes=[16,24,32,48,64,128,256];
const pngs=await Promise.all(sizes.map(size=>sharp(svg).resize(size,size).png().toBuffer()));
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(let i=0;i<sizes.length;i++){
 const entry=6+16*i;header[entry]=header[entry+1]=sizes[i]===256?0:sizes[i];header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(pngs[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=pngs[i].length;
}
await writeFile(resolve(icons,'shallowgroove.ico'),Buffer.concat([header,...pngs]));
const iconset=resolve(root,'release/icon-build.iconset');await mkdir(iconset,{recursive:true});
for(const size of [16,32,128,256,512])for(const scale of [1,2])await sharp(svg).resize(size*scale,size*scale).png().toFile(resolve(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`));
execFileSync('iconutil',['-c','icns',iconset,'-o',resolve(icons,'shallowgroove.icns')]);
