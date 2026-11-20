"""Build bilingual, evidence-backed track descriptors without duplicating MIDI events."""
import json
from hashlib import sha256
from pathlib import Path
from midi_labels import GM

ROLE_EN={1:'Pad or section transition',2:'Bass part',3:'Repeating pattern and synth accompaniment',4:'Harmonic pad',5:'Special-timbre melody or accents',6:'Short-note rhythmic accompaniment',7:'Percussive accents',8:'Repeating high-register pattern',9:'High-register ornament or transition',10:'Main drum groove',11:'Auxiliary percussion and accents'}
def loc(zh,en):return {'zh-CN':zh,'en':en}

def describe(project,root):
    tracks=[]
    for t in project['tracks']:
        a=t['annotation'];p=a['initial_program'];drums=a['rhythm_map']>0
        variant=bool(p and (p['bank_msb'] or p['bank_lsb'])) and not drums
        name_en=('Main drums' if t['midi_channel']==10 else 'Auxiliary percussion') if drums else a['instrument']+(' · variant' if variant else '')
        basis_en='Default GM/GS drum channel' if t['midi_channel']==10 else 'Explicit Roland GS rhythm-part SysEx' if drums else 'GM base sound derived from Program Change' if p else 'No Program Change before the first note'
        if variant:basis_en+='; the exact GS bank variant has not been verified'
        zh=f"原文件指定{t['name']}。包含 {a['note_count']} 个 Note On 事件。"
        en=f"The source requests {name_en}. Contains {a['note_count']} note-on events."
        if variant:zh+='显示的是 GM 基础音色，具体 Bank 变体尚未核实。';en+=' This is the GM base name; the bank variation remains unverified.'
        if drums:zh+='这是鼓映射，Program 不按旋律乐器解释。';en+=' This is a drum map; Program is not interpreted as a melodic instrument.'
        role={'status':'inferred','description':loc(a['role'],ROLE_EN[t['midi_channel']]),'basis':loc(a['role_source'],'Inferred from patch, register and note distribution; not text from the MIDI file'),'review_status':'not_auditioned'} if a['role'] else {'status':'unknown','description':loc('尚未分析编曲角色','Musical role has not been analyzed'),'basis':None,'review_status':'not_auditioned'}
        family='percussion' if drums else 'bass' if p and 32<=p['program_zero_based']<=39 else 'pad' if p and (48<=p['program_zero_based']<=55 or 88<=p['program_zero_based']<=95) else 'pitched'
        suggestions={
          'percussion':loc('建议后续按鼓音符号路由到独立打击乐 DSP；尚未实现。','Consider routing drum note numbers to separate percussion DSPs; not implemented.'),
          'bass':loc('建议后续设计带滤波与包络的贝斯 DSP；需要听审，不代表原曲复刻。','Consider a bass DSP with filtering and envelopes; audition required, not a reconstruction.'),
          'pad':loc('建议后续设计慢包络与可调音色的铺底 DSP；参数需听审。','Consider a pad DSP with slow envelopes and adjustable timbre; audition required.'),
          'pitched':loc('建议根据原始音色和音区设计专用 DSP；当前没有匹配音色。','Consider a dedicated DSP based on the source patch and register; no matching patch exists yet.')}
        tracks.append({'id':t['id'],'midi_channel':t['midi_channel'],'name':loc(t['name'],name_en),'description':loc(zh,en),
          'source':{'kind':'midi_events','name_status':'decoded_not_authored','instrument':a['instrument'],'basis':loc(a['basis'],basis_en),
          'initial_program':p,'program_history':a['program_history'],'rhythm_map':a['rhythm_map'],'bank_variant_status':'unverified' if variant else 'not_applicable',
          'statistics':{'note_on_count':a['note_count'],'midi_pitch_range':a['pitch_range']}},'musical_role':role,
          'faust':{'initial_assignment':'shallow-synth-v1','match_to_source':'not_matched','proposal':{'status':'not_implemented','family':family,'description':suggestions[family],'dsp_source':None}}})
    code=root/'src/audio/synth.dsp'
    result={'$schema':'../schemas/track-descriptions.schema.json','schema_version':1,'project_id':Path(project['source']['path']).stem.split('_')[-1],
      'title':project['title'],'default_locale':'zh-CN','supported_locales':['zh-CN','en'],
      'source_midi':project['source'],'description':loc('按原始 MIDI 事件解释的轨道描述；音乐角色与 Faust 建议不是原文件内容。','Track descriptions decoded from MIDI events; musical roles and Faust proposals are editorial additions.'),
      'faust_instruments':{'shallow-synth-v1':{'name':loc('基础 Faust 合成器','Basic Faust synth'),'status':'prototype',
        'description':loc('用于对照的基础音色，不还原原 MIDI 的 GM/GS 音色。','Baseline comparison patch; it does not reproduce the source GM/GS sounds.'),
        'source_path':'../src/audio/synth.dsp','source_sha256':sha256(code.read_bytes()).hexdigest(),
        'audio_inputs':0,'audio_outputs':2,'voices_per_track':16,'midi_voice_controls':['freq','gain','gate'],
        'parameters':[
         {'id':'level','faust_label':'Level','name':loc('音量','Level'),'description':loc('每个合成声部的输出电平','Output level per synthesized voice'),'default':0.18,'min':0,'max':0.5,'step':0.001,'unit':'linear'},
         {'id':'attack','faust_label':'Attack','name':loc('起音','Attack'),'description':loc('振幅包络的起音时间','Amplitude envelope attack time'),'default':0.008,'min':0.001,'max':1,'step':0.001,'unit':'s'},
         {'id':'release','faust_label':'Release','name':loc('释音','Release'),'description':loc('松开音符后的释音时间','Release time after note-off'),'default':0.18,'min':0.01,'max':2,'step':0.01,'unit':'s'},
         {'id':'tone','faust_label':'Tone','name':loc('音色','Tone'),'description':loc('正弦波与锯齿波之间的混合','Blend between sine and sawtooth'),'default':0.3,'min':0,'max':1,'step':0.01,'unit':'normalized'}],
        'parameter_binding':'faust_label is descriptive; resolve actual addresses from compiled Faust UI metadata',
        'scope':'initial project assignment; live edits are not synchronized to this descriptor'}},'tracks':tracks}

    bank_dir={'Korobeiniki':'korobeiniki','DaisyBell':'daisy-bell'}.get(result['project_id'])
    if bank_dir:
        bank=json.loads((root/'patches'/bank_dir/'manifest.json').read_text())
        for patch in bank['patches']:
            result['faust_instruments'][patch['id']]={
              **{k:patch[k] for k in ['name','description','status','source_sha256','parameters','hardware_inspiration','hardware_attribution','source_refs']},
              'source_path':'../patches/'+bank_dir+'/'+patch['file'],
              'audio_inputs':0,'audio_outputs':2,'voices_per_track':16,'midi_voice_controls':['freq','gain','gate'],
              'mix_gain':patch['mix_gain'],'pan':patch['pan'],
              'scope':'Initial period-inspired sound set; live edits are not synchronized.'}
            track=next(t for t in tracks if t['id']==patch['track_id'])
            track['faust']['initial_assignment']=patch['id']
            track['faust']['match_to_source']='approximation_not_verified_against_original_recording'
            track['name']=patch['name']
            track['description']=patch['description']
            track['faust']['proposal']['description']=patch['description']
    return result
