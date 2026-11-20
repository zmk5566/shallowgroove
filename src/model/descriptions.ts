export type Locale='zh-CN'|'en';
export type Localized=Partial<Record<Locale,string>>;
export function localize(text:Localized|undefined,locale:Locale,fallback=''){return text?.[locale]||text?.['zh-CN']||text?.en||fallback;}
export interface TrackDescription {
 id:string;midi_channel:number;name:Localized;description:Localized;
 source:{instrument:string;basis:Localized;initial_program:{program_zero_based:number;bank_msb:number;bank_lsb:number}|null;program_history:unknown[];statistics:{note_on_count:number;midi_pitch_range:number[]|null}};
 musical_role:{status:'inferred'|'unknown';description:Localized;basis:Localized|null};
 faust:{initial_assignment:string;match_to_source:string;proposal:{status:string;description:Localized}};
}
export interface DescriptionFile {
 schema_version:number;project_id:string;default_locale:Locale;tracks:TrackDescription[];
 faust_instruments:Record<string,{name:Localized;description:Localized;source_path:string;parameters:{id:string;faust_label:string;name:Localized;description:Localized}[]}>;
}
