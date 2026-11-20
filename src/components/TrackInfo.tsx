import {localize,type DescriptionFile,type Locale,type Localized,type TrackDescription} from '../model/descriptions';
export function TrackInfo({activeInstrument,track,file,locale}:{activeInstrument?:{name:Localized;description:Localized};track:TrackDescription|undefined;file:DescriptionFile|null;locale:Locale}){
 if(!track)return null;
 const zh=locale==='zh-CN',s=track.source,p=s.initial_program,instrument=activeInstrument??file?.faust_instruments[track.faust.initial_assignment];
 return <section className="track-info" aria-label={zh?'轨道说明':'Track description'}>
 <h3>CH {track.midi_channel} · {localize(track.name,locale)}</h3><p>{localize(track.description,locale)}</p><p className="instrument-name">{s.instrument}</p><p>{localize(s.basis,locale)}</p>
 {p&&<p className="program-id">Program {p.program_zero_based+1} · Bank {p.bank_msb}/{p.bank_lsb}</p>}
 <p>{s.statistics.note_on_count} {zh?'个音符':'notes'}{s.statistics.midi_pitch_range?` · MIDI ${s.statistics.midi_pitch_range.join('–')}`:''}</p>
 {s.program_history.length>1&&<p>{zh?'音色选择次数':'Program changes'}: {s.program_history.length}</p>}
 <p><strong>{zh?'可能的角色':'Possible role'}</strong>：{localize(track.musical_role.description,locale)}<small>{localize(track.musical_role.basis??undefined,locale)}</small></p>
 {instrument&&<><h3>{zh?'所选 Faust 音色':'Selected Faust patch'}</h3><p>{localize(instrument.name,locale)}</p><p className="patch-note">{localize(instrument.description,locale)}</p></>}
 </section>;
}
