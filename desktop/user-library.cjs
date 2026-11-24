const fs = require('node:fs/promises');
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {validLibraryRef, validLibraryId, makeLibraryEntry} = require('../src/model/library-entry.mjs');

exports.createUserLibrary = function (userData) {
 const directory = join(userData,'User Library');
 // Link the completed revision into place; concurrent writers cannot overwrite it.
 async function readHead(id) {
  let files;
  try { files = await fs.readdir(join(directory,id)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const revisions = files.filter(name => /^[1-9]\d*\.json$/.test(name)).map(name => Number.parseInt(name,10));
  if (!revisions.length) return;
  const revision = revisions.reduce((head,n)=>Math.max(head,n),0);
  const entry = JSON.parse(await fs.readFile(join(directory,id,revision+'.json'),'utf8'));
  if (!validLibraryRef(entry) || entry.id !== id || entry.revision !== revision) throw Error('Invalid library revision');
  return entry;
 }
 return {
  async list() {
   let folders;
   try { folders = await fs.readdir(directory,{withFileTypes:true}); }
   catch (error) { if (error.code === 'ENOENT') return []; throw error; }
   const entries = await Promise.all(folders.filter(f=>f.isDirectory() && validLibraryId(f.name)).map(f=>readHead(f.name)));
   return entries.filter(Boolean);
  },
  async save(name,patch,previous) {
   if (previous !== undefined && !validLibraryRef(previous)) throw Error('Invalid patch reference');
   const current = previous && await readHead(previous.id);
   const entry = makeLibraryEntry(name,patch,previous,current);
   const folder = join(directory,entry.id);
   await fs.mkdir(folder,{recursive:true});
   const temporary = join(folder,randomUUID()+'.tmp');
   try {
    await fs.writeFile(temporary,JSON.stringify(entry),{flag:'wx',mode:0o600,flush:true});
    await fs.link(temporary,join(folder,entry.revision+'.json'));
   } catch (error) {
    if (error.code === 'EEXIST') throw Error('This library patch has changed. Reload its latest version or save a copy.');
    throw error;
   } finally { await fs.rm(temporary,{force:true}); }
   return entry;
  }
 };
};
