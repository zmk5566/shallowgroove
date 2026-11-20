"""Import supplied synchronous MIDI files into draft engine-independent projects."""
import json
import sys
from pathlib import Path
from inspect_midi import inspect
from midi_labels import label_tracks
from track_descriptions import describe

root = Path(__file__).resolve().parents[1]
out = root / 'demo-projects'
out.mkdir(exist_ok=True)
for path in sorted((root / 'midi').glob('*.mid')):
    if path.name.startswith('._'): continue
    if len(sys.argv)>1 and path.stem.split('_')[-1] not in sys.argv[1:]: continue
    source = inspect(path)
    assert source['format'] in (0, 1), 'Independent Format 2 sequences require separate projects'
    events = source.pop('events')
    if source['format'] == 1: events.sort(key=lambda event: event['tick'])
    for order, event in enumerate(events): event['order'] = order
    channels = sorted({e['channel'] for e in events if e['kind'] == 'midi'})
    title = 'Daisy Bell (Demonstration of Envelope)' if path.stem == 'DaisyBell' else source['tracks'][0]['names'][0]
    project = dict(schema='shallowgroove.project.draft-1', title=title,
        source=dict(path='../midi/' + path.name, sha256=source['sha256']),
        timing=dict(unit='ticks', ppqn=source['ppqn'], default_tempo_us_per_quarter=500000,
                    end_tick=max(t['end_tick'] for t in source['tracks'])),
        global_events=[e for e in events if e['kind'] != 'midi'],
        tracks=[dict(id=f'midi-channel-{ch}', name=f'Channel {ch}', midi_channel=ch,
                     devices=[], instrument_status='unassigned', gain=1, pan=0, mute=False, solo=False,
                     events=[e for e in events if e.get('channel') == ch]) for ch in channels])
    slug = path.stem.split('_')[-1]
    # Every parsed event survives, including tempo, CC, program, pitch bend and SysEx.
    rebuilt = project['global_events'] + [e for t in project['tracks'] for e in t['events']]
    assert sorted({e['order']:e for e in rebuilt}.values(), key=lambda e:e['order']) == events
    slug = path.stem.split('_')[-1]
    if slug == 'DaisyBell':
        from daisy_arrangement import arrange, apply_vocal_note_edits
        from daisy_articulation import articulate
        arrange(project)
        project['automation'] = articulate(project)
        apply_vocal_note_edits(project)
    if slug == 'Korobeiniki':
        from korobeiniki_arrangement import arrange
        arrange(project)
    label_tracks(project)
    target = out / (slug + '.json')
    target.write_text(json.dumps(project, ensure_ascii=False, separators=(',', ':')) + '\n')
    descriptions = root / 'track-descriptions'
    descriptions.mkdir(exist_ok=True)
    (descriptions / (slug + '.json')).write_text(json.dumps(describe(project, root), ensure_ascii=False, indent=2) + '\n')
    saved = json.loads(target.read_text())
    assert {t['midi_channel'] for t in saved['tracks']} == set(channels)
    print(f'{target.name}: {len(saved['tracks'])} tracks, {len(events)} events preserved')
