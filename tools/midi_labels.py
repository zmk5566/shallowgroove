"""Source-derived labels for the supplied GM/GS demos; musical roles are hypotheses."""
GM = {
 0:('原声钢琴','Acoustic Grand Piano'),1:('明亮钢琴','Bright Acoustic Piano'),
 23:('班多钮手风琴','Bandoneon'),61:('铜管合奏','Brass Section'),85:('人声主音','Lead 6 (voice)'),99:('氛围效果','FX 4 (atmosphere)'),
 24:('尼龙弦吉他','Acoustic Guitar (nylon)'),25:('钢弦吉他','Acoustic Guitar (steel)'),
 26:('爵士吉他','Electric Guitar (jazz)'),28:('弱音吉他','Electric Guitar (muted)'),
 30:('失真吉他','Distortion Guitar'),33:('指弹贝斯','Electric Bass (finger)'),
 37:('击弦贝斯 2','Slap Bass 2'),38:('合成贝斯 1','Synth Bass 1'),
 48:('弦乐合奏 1','String Ensemble 1'),49:('弦乐合奏 2','String Ensemble 2'),
 50:('合成弦乐 1','SynthStrings 1'),52:('合唱人声','Choir Aahs'),
 62:('合成铜管 1','SynthBrass 1'),63:('合成铜管 2','SynthBrass 2'),
 72:('短笛','Piccolo'),80:('方波主音','Lead 1 (square)'),81:('锯齿波主音','Lead 2 (sawtooth)'),
 87:('贝斯与主音','Lead 8 (bass + lead)'),90:('复音合成铺底','Pad 3 (polysynth)'),
 95:('扫频铺底','Pad 8 (sweep)'),102:('回声效果','FX 7 (echoes)'),103:('科幻效果','FX 8 (sci-fi)'),
 104:('西塔琴','Sitar'),108:('卡林巴','Kalimba'),118:('合成鼓','Synth Drum'),127:('枪声效果','Gunshot')}
def label_tracks(project):
    rhythm = {10:1}
    first_note=min((e['tick'] for t in project['tracks'] for e in t['events'] if e['status']>>4==9 and e['data'][1]), default=0)
    for e in sorted(project['global_events'],key=lambda e:(e['tick'],e['order'])):
        if e['tick']>first_note: continue
        d=e['data']
        if e['kind']!='sysex' or len(d)!=10 or d[:1]!=[0x41] or d[2:5]!=[0x42,0x12,0x40] or d[-1]!=0xf7:continue
        if sum(d[4:9])%128:continue
        if d[5:8]==[0,0x7f,0]:rhythm={10:1}
        if d[5]&0xf0==0x10 and d[6]==0x15 and d[7] in (0,1,2):
            block=d[5]&15;channel=10 if block==0 else block if block<10 else block+1
            rhythm[channel]=d[7]
    for track in project['tracks']:
        bank_msb=bank_lsb=0;programs=[]
        for e in track['events']:
            kind=e['status']>>4
            if kind==11 and e['data'][0]==0:bank_msb=e['data'][1]
            if kind==11 and e['data'][0]==32:bank_lsb=e['data'][1]
            if kind==12:programs.append(dict(tick=e['tick'],program_zero_based=e['data'][0],bank_msb=bank_msb,bank_lsb=bank_lsb))
        notes=[e for e in track['events'] if e['status']>>4==9 and e['data'][1]>0]
        initial=next((p for p in reversed(programs) if p['tick']<=(notes[0]['tick'] if notes else 0)),None)
        drum_map=rhythm.get(track['midi_channel'],0)
        if drum_map:
            name='主鼓组' if track['midi_channel']==10 else '辅助打击乐'
            instrument=f'GS Rhythm Map {drum_map}'
            basis='GS/GM 默认鼓通道' if track['midi_channel']==10 else 'Roland GS SysEx 明确指定鼓通道'
        elif initial:
            name,instrument=GM.get(initial['program_zero_based'],(f"音色 {initial['program_zero_based']+1}",'Unmapped GM program'))
            basis='Program Change 对应的 GM 基础音色'
            if initial['bank_msb'] or initial['bank_lsb']:
                name+=' · 变体';basis+='；存在 Bank 变体，具体 GS 音色名称尚未核实'
        else:name,instrument,basis='未指定音色','Unknown','首个音符之前没有 Program Change'
        track['name']=name
        track['annotation']=dict(instrument=instrument,basis=basis,initial_program=initial,program_history=programs,
            rhythm_map=drum_map,note_count=len(notes),pitch_range=[min(e['data'][0] for e in notes),max(e['data'][0] for e in notes)] if notes else None,
            role=None, role_source=None)
