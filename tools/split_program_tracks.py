"""Project one MIDI channel onto editable instruments without moving its notes.

Channel controls are copied to each instrument so seeking and sustain still work.
Note-off and poly-pressure follow the owning note, including across program changes.
The source MIDI remains unchanged and each event retains its original order.
"""
from collections import defaultdict, deque
from copy import deepcopy


def split_program_tracks(project):
    result = []
    for track in project['tracks']:
        programs = sorted({e['data'][0] for e in track['events'] if e['status'] >> 4 == 12})
        if len(programs) < 2:
            result.append(track)
            continue
        parts = {p: {**deepcopy(track), 'id': f"{track['id']}-program-{p}", 'events': []} for p in programs}
        active = defaultdict(deque)
        current = programs[0]
        for event in track['events']:
            kind = event['status'] >> 4
            if kind == 12:
                current = event['data'][0]
                targets = [current]
            elif kind == 9 and event['data'][1] > 0:
                active[event['data'][0]].append(current)
                targets = [current]
            elif kind == 8 or (kind == 9 and event['data'][1] == 0):
                owners = active[event['data'][0]]
                targets = [owners.popleft()] if owners else [current]
            elif kind == 10:
                targets = set(active[event['data'][0]]) or {current}
            else:
                targets = programs
            for program in targets:
                parts[program]['events'].append(deepcopy(event))
        assert not any(active.values()), 'Unclosed MIDI note during program split'
        # First-use order, rather than numeric GM program order.
        result.extend(sorted(parts.values(), key=lambda t: min(e['tick'] for e in t['events'] if e['status'] >> 4 == 9 and e['data'][1])))
    original = sorted((e for t in project['tracks'] for e in t['events'] if e['status'] >> 4 in (8, 9)), key=lambda e: e['order'])
    split = sorted((e for t in result for e in t['events'] if e['status'] >> 4 in (8, 9)), key=lambda e: e['order'])
    assert split == original, 'Program split must preserve every note event exactly once'
    project['tracks'] = result
