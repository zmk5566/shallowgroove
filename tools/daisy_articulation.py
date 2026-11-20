"""Shape the supplied Daisy Bell melody with editable vowel and consonant lanes."""
# Each token is one sung syllable. A second vowel gives its closing mouth shape;
# an asterisk adds a short fricative onset. Values run oo, oh, ah, eh, ee.
CHORUS = [
    'ei *i ei *i i i o a e u',
    'ai a ei *i o o e a e u i',
    'o i e *ai i a i ai a e o e a i a',
    'u u *i *i o e *i o e ai *i e i o u',
]
SHAPE = {'u':0.02, 'o':0.24, 'a':0.50, 'e':0.74, 'i':0.98}

def articulate(project):
    lead = project['tracks'][1]
    notes = [e for e in lead['events'] if e['status'] >> 4 == 9 and e['data'][1]]
    syllables = ' '.join(CHORUS).split()
    assert len(notes) == len(syllables)
    vowel, noise = {}, {}
    for index, (note, token) in enumerate(zip(notes, syllables)):
        start = note['tick']
        end = next(e['tick'] for e in lead['events'] if e['tick'] > start and
                   e['data'][0] == note['data'][0] and
                   (e['status'] >> 4 == 8 or (e['status'] >> 4 == 9 and e['data'][1] == 0)))
        if index+1 < len(notes):
            end = min(end, notes[index+1]['tick'])
        span = end-start
        sounds = token.lstrip('*')
        vowel[start] = SHAPE[sounds[0]]
        vowel[start+int(span*.60)] = SHAPE[sounds[0]]
        vowel[max(start,end-16)] = SHAPE[sounds[-1]]
        # Close the previous consonant before scheduling a new onset.
        noise[max(0,start-2)] = 0
        if token.startswith('*'):
            noise[start] = .88
            noise[start+min(48,span//3)] = 0
    return [dict(id='daisy-'+label.lower(),trackId=lead['id'],device='instrument',
                 address='/Daisy_FM_Voice/'+label,label=label,min=0,max=1,step=.01,
                 scale='linear',mode='read',interpolation='linear',
                 points=[dict(tick=t,value=v) for t,v in sorted(points.items())])
            for label,points in [('Vowel',vowel),('Frication',noise)]]
