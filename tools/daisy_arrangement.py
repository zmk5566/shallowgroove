"""Arrange the source chorus with four bars of reed and four bars of keys before the vocal."""
def arrange(project):
    keys, voice, reed = project['tracks']
    start, stop = 3456, 31104
    # The source counts three 288-tick beats per bar with a 384-tick PPQN.
    # Express those beats as quarters so the project transport displays 3/4.
    bar = 3 * project['timing']['ppqn']
    def chorus(source, dest, bars, transpose, start=start, stop=stop):
        notes = []
        for event in source:
            status = event['status'] >> 4
            if status not in (8, 9):
                continue
            attack = status == 9 and event['data'][1] > 0
            tick = event['tick']
            if not (start <= tick < stop if attack else start < tick <= stop):
                continue
            channel = dest['midi_channel']
            notes.append(dict(event, tick=bars*bar+(tick-start)*4//3,
                channel=channel, status=(status<<4)+channel-1, source_track=channel-1,
                data=[event['data'][0]+transpose,event['data'][1]]))
        return notes

    accompaniment, melody = keys['events'], voice['events']
    for track, events in [
        (keys, chorus(accompaniment, keys, 4, -5, 0, start) +
               chorus(accompaniment, keys, 8, -5)),
        (voice, chorus(melody, voice, 8, -17)),
        (reed, chorus(melody, reed, 0, -17, start, start + 4*3*288)),
    ]:
        track['events'] = [track['events'][0], *events]
    # The monophonic reed releases halfway through each written note.
    for onset, release in zip(reed['events'][1::2], reed['events'][2::2]):
        assert onset['status'] >> 4 == 9 and onset['data'][1] > 0
        assert release['status'] >> 4 == 8 or release['data'][1] == 0
        assert onset['data'][0] == release['data'][0]
        release['tick'] = (onset['tick'] + release['tick']) // 2
    end = 40*bar
    project['timing'].update(end_tick=end, default_tempo_us_per_quarter=323000)
    for e in project['global_events']:
        if e['type'] == 88: e['data'][0] = 3
        if e['type'] == 81: e['data'] = list((323000).to_bytes(3,'big'))
        if e['type'] == 47: e['tick'] = end
        if e['type'] == 3:
            e['data'] = list(['Pulse keys','Singing voice','Reed lead'][e['source_track']].encode())
    events = project['global_events'] + [e for t in project['tracks'] for e in t['events']]
    for order,event in enumerate(sorted(events,key=lambda e:(e['tick'], e['order']))):
        event['order'] = order


def apply_vocal_note_edits(project):
    # Piano-roll edits, keyed by (onset tick, MIDI pitch). Keep the recorded
    # vowel and frication lanes on their original timeline.
    durations = {
        (16128, 43): 1152,
        (25344, 50): 1088,
        (30336, 48): 864,
        (34944, 43): 896,
        (43776, 48): 1216,
    }
    events = project['tracks'][1]['events']
    for onset, release in zip(events[1::2], events[2::2]):
        duration = durations.pop((onset['tick'], onset['data'][0]), None)
        if duration is not None:
            release['tick'] = onset['tick'] + duration
    assert not durations, 'Unmatched Daisy Bell vocal edits'
