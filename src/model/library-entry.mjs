const kinds = new Set(['instrument','compressor','delay','reverb','eq','filter','saturator','chorus','utility','custom']);
export const validLibraryId = id => typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
export function validLibraryRef(value) {
 return !!value && validLibraryId(value.id) && Number.isSafeInteger(value.revision) && value.revision >= 1 &&
  typeof value.name === 'string' && !!value.name.trim() && value.name.length <= 200;
}
export function makeLibraryEntry(name, patch, previous, current) {
 if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) throw Error('Invalid patch name');
 if (!patch || !kinds.has(patch.kind) || typeof patch.code !== 'string' || !patch.code.trim() || patch.code.length > 60000 ||
     !patch.values || typeof patch.values !== 'object' || Array.isArray(patch.values)) throw Error('Invalid patch');
 const controls = Object.entries(patch.values);
 if (controls.some(([key,value])=>!key || !Number.isFinite(value) || Math.abs(value)>1e12)) throw Error('Invalid patch parameter');
 if (previous !== undefined) {
  if (!validLibraryRef(previous) || !current || current.id !== previous.id || current.revision !== previous.revision)
   throw Error('This library patch has changed. Reload its latest version or save a copy.');
  if (current.kind !== patch.kind) throw Error('Patch type changed');
 }
 return {id:previous?.id ?? crypto.randomUUID(), revision:(previous?.revision ?? 0)+1, name:name.trim(),
  kind:patch.kind, code:patch.code, values:Object.fromEntries(controls)};
}

export function hasPresetName(entries,name,previousId){
 const normalized=value=>value.trim().normalize('NFC').toLowerCase();
 return entries.some(entry=>entry.id!==previousId&&normalized(entry.name)===normalized(name));
}
