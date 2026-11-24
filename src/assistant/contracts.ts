import type {LibraryKind} from '../model/effect-library';
import type {NoteTransform} from '../model/note-transforms';
import type {NoteEdit,NoteQuery} from '../model/notes';
export type Selection = {channel: number | 'delay' | 'reverb' | 'master'; device: 'channel' | 'instrument' | string};
export type MusicCommand = Partial<NoteEdit>&Partial<NoteTransform>&NoteQuery&{semitones?:number;bpm?:number;resetToMidi?:boolean;clipId?:string;sceneId?:string;lengthBars?:number;bars?:number[];refId?:string;query?:string;source?:'factory'|'user';offset?:number;entryId?:string;entryRevision?:number;action:'search_effect_library'|'load_library_effect'|'assign_clip'|'create_clip'|'place_clip'|'fork_clip'|'transform_notes'|'transpose_notes'|'set_tempo'|'inspect_notes'|'edit_notes'|'inspect_hardware'|'set_hardware_mapping'|'remove_hardware_mapping'|'remove_effect'|'move_effect'|'bypass_effect'|'set_mix'|'seek'|'set_loop'|'undo'|'redo'|'export_project'|'export_history'|'import_project'|'delete_automation'|'set_automation'|'add_track'|'delete_track'|'duplicate_track'|'rename_track'|'select_target'|'play'|'pause'|'stop'|'enable_audio'|'inspect'|'set_send'|'set_parameter'|'add_effect'|'replace_patch'; connectorId?:string;uid?:string;sensorChannel?:number;mappingId?:string;inputMin?:number;inputMax?:number;outputMin?:number;outputMax?:number;curve?:'linear'|'log';invert?:boolean;smoothingMs?:number;position?:number;bypassed?:boolean;gain?:number;pan?:number;mute?:boolean;solo?:boolean;seconds?:number;enabled?:boolean;includeHistory?:boolean;includeConversation?:boolean;automationId?:string;points?:{tick:number;value:number}[];mode?:'read'|'off';name?:string;channel?:string; device?:string; destination?:'delay'|'reverb'; amount?:number; address?:string; value?:number; presetId?:string;kind?:LibraryKind|'custom'; code?:string};
export function finiteRange(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(`Expected a number between ${min} and ${max}`);return value;}
export function sendTarget(selection:Selection){if(typeof selection.channel!=='number')throw Error('Select a MIDI track or a device on that track to use a send. Return and Master channels cannot send to themselves.');return selection.channel;}

export type ParameterDevice={id:string;controls:{address:string;label:string}[]};
export function resolveParameterTarget(selection:Selection,address:string|undefined,devices:ParameterDevice[]){
 if(!address)throw Error('Provide a parameter address or label.');
 const scope=selection.device==='channel'?devices:devices.filter(d=>d.id===selection.device);
 const exact=scope.flatMap(d=>d.controls.filter(c=>c.address===address).map(c=>({device:d.id,address:c.address})));
 const matches=exact.length?exact:scope.flatMap(d=>d.controls.filter(c=>c.label.toLowerCase()===address.toLowerCase()).map(c=>({device:d.id,address:c.address})));
 if(matches.length>1)throw Error(`Ambiguous parameter ${address}; ask which device the user means, then use select_target. Candidates: ${JSON.stringify(matches)}`);
 if(!matches.length)throw Error('Unknown parameter. Inspect the channel or select_target to inspect another device.');
 return {selection:{...selection,device:matches[0].device},address:matches[0].address};
}
export function resolveChannelTarget(current:Selection['channel'],channel:string|undefined,trackIds:string[]):Selection['channel']{
 if(channel===undefined)return current;
 if(['delay','reverb','master'].includes(channel))return channel as Selection['channel'];
 const index=trackIds.indexOf(channel);if(index>=0)return index;
 if(/^[1-9][0-9]*$/.test(channel)&&Number(channel)<=trackIds.length)return Number(channel)-1;
 throw Error('Unknown channel. Use a track ID, a 1-based channel number, delay, reverb or master from inspect_selection.');
}
