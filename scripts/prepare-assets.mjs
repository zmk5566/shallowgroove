import { cpSync, mkdirSync } from 'node:fs';
cpSync('node_modules/pdfjs-dist/cmaps','public/pdf-cmaps',{recursive:true});
mkdirSync('public/faust', {recursive:true});
for (const ext of ['js','wasm','data']) cpSync(`node_modules/@grame/faustwasm/libfaust-wasm/libfaust-wasm.${ext}`, `public/faust/libfaust-wasm.${ext}`);
