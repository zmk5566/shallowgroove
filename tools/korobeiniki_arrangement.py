"""Build the short arrangement and keep unique four-bar phrases in Session."""
# One-based source bars; each entry places four bars on the timeline.
SECTIONS = [
    1,                  # Original bass introduction.
    9, 13, 17, 21,      # Lead and hat enter; arpeggios join the second statement.
    25, 29, 33, 37,     # Full theme followed by its answering phrase.
    41, 45,             # Contrasting sustained lead.
    57, 61,             # Theme returns over the denser rhythm.
    97, 101, 145, 149,  # Raised-key variations and final ensemble statement.
    169, 173,           # Original closing melody and cadence.
]
VOICE_NAMES = ['Bass', 'Lead', 'Arp', 'Hi-Hat']


def arrange(project):
    length = project['timing']['ppqn'] * 4 * 4
    end = len(SECTIONS) * length
    library, scenes = [], {}
    for track, name in zip(project['tracks'], VOICE_NAMES, strict=True):
        channel = track['midi_channel']
        setup, phrases = [], {}
        for event in track['events']:
            kind = event['status'] >> 4
            if kind == 12 and event['tick'] == 0:
                setup.append(event)
                continue
            assert kind in (8, 9)
            release = kind == 8 or event['data'][1] == 0
            # A release on a phrase boundary closes the preceding note.
            index = (event['tick'] - int(release)) // length
            phrase = phrases.setdefault(index * 4 + 1, [])
            phrase.append(dict(event, tick=event['tick'] - index * length, order=len(phrase)))

        unique, by_bar = {}, {}
        for bar, phrase in phrases.items():
            signature = tuple((e['tick'], e['status'], *e['data']) for e in phrase)
            if signature not in unique:
                clip = dict(id=f'koro-ch{channel}-bar{bar}', name=f'{name} {len(unique)+1:02}',
                            length=length, channel=channel, events=phrase)
                unique[signature] = clip
                library.append(clip)
                row = scenes.setdefault(bar, dict(id=f'koro-row-{bar}', name=f'{bar}–{bar+3}', slots=[]))
                row['slots'].append(dict(trackId=track['id'], clipId=clip['id']))
            by_bar[bar] = unique[signature]

        track['events'], track['clipRefs'] = setup, []
        for index, bar in enumerate(SECTIONS):
            clip = by_bar.get(bar)
            if clip is None:
                continue
            start = index * length
            ref = dict(id=f'koro-ref-{channel}-{index}', clipId=clip['id'], start=start)
            track['clipRefs'].append(ref)
            for e in clip['events']:
                track['events'].append(dict(e, tick=start+e['tick'], order=len(track['events']), clipRef=ref['id']))

    project.update(clips=library, scenes=[scenes[bar] for bar in sorted(scenes)])
    project['timing']['end_tick'] = end
    for event in project['global_events']:
        if event.get('type') == 47:
            event['tick'] = end
