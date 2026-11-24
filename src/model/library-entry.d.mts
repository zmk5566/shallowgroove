import type {LibraryRef, LibraryPatch, LibraryEntry} from './user-library';
export function validLibraryId(id:unknown):id is string;
export function validLibraryRef(value:unknown):value is LibraryRef;
export function makeLibraryEntry(name:string,patch:LibraryPatch,previous?:LibraryRef,current?:LibraryEntry):LibraryEntry;
