"""Read SMF structure and event counts without third-party dependencies."""
import hashlib, json, struct
from pathlib import Path

def inspect(path):
    data = path.read_bytes()
    assert data[:4] == b'MThd', 'Missing MIDI header'
    size = int.from_bytes(data[4:8], 'big')
    fmt, count, division = struct.unpack('>HHH', data[8:14])
    assert not division & 0x8000, 'SMPTE timing not supported by this inspector'
    pos, tracks, tempos = 8 + size, [], []
    events = []
    for index in range(count):
        assert data[pos:pos+4] == b'MTrk', 'Missing track chunk'
        length = int.from_bytes(data[pos+4:pos+8], 'big')
        buf = data[pos+8:pos+8+length]
        assert len(buf) == length
        pos += 8 + length
        i = tick = notes = 0
        running = None
        channels, programs, names = set(), set(), []
        eot = False
        def vlq():
            nonlocal i
            value = 0
            for _ in range(4):
                b = buf[i]; i += 1
                value = (value << 7) | (b & 127)
                if b < 128: return value
            raise ValueError('Invalid VLQ')
        while i < len(buf):
            tick += vlq()
            status = buf[i]
            if status >= 128:
                i += 1
                if status < 240: running = status
            else:
                assert running is not None
                status = running
            if status == 255:
                running = None
                kind = buf[i]; i += 1
                n = vlq(); payload = buf[i:i+n]; i += n
                assert len(payload) == n
                events.append(dict(tick=tick, source_track=index, kind='meta', type=kind, data=list(payload)))
                if kind == 3: names.append(payload.decode('utf-8', errors='replace'))
                if kind == 81:
                    assert n == 3
                    tempos.append((tick, int.from_bytes(payload, 'big')))
                if kind == 47: eot = True
            elif status in (240, 247):
                running = None
                n = vlq(); payload = buf[i:i+n]; i += n
                assert len(payload) == n
                events.append(dict(tick=tick, source_track=index, kind='sysex', status=status, data=list(payload)))
            else:
                assert 128 <= status < 240
                kind, ch = status >> 4, status & 15
                n = 1 if kind in (12, 13) else 2
                payload = buf[i:i+n]; i += n
                assert len(payload) == n and all(b < 128 for b in payload)
                events.append(dict(tick=tick, source_track=index, kind='midi', channel=ch + 1, status=status, data=list(payload)))
                channels.add(ch + 1)
                if kind == 9 and payload[1]: notes += 1
                if kind == 12: programs.add((ch + 1, payload[0]))
            assert i <= len(buf)
        tracks.append(dict(index=index, names=names, channels=sorted(channels), note_on_count=notes, end_tick=tick, program_changes_zero_based=sorted(programs), end_of_track=eot))
    assert pos == len(data), 'Trailing bytes'
    end = max(t['end_tick'] for t in tracks)
    elapsed, last, tempo = 0., 0, 500000
    for tick, value in sorted(set(tempos)):
        elapsed += (tick-last)*tempo/division/1e6
        last, tempo = tick, value
    elapsed += (end-last)*tempo/division/1e6
    return dict(file=path.name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), format=fmt, ppqn=division, track_count=count, note_track_count=sum(t['note_on_count'] > 0 for t in tracks), duration_seconds=round(elapsed, 3), tempo_events=sorted(set(tempos)), tracks=tracks, events=events)

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    results = [inspect(p) for p in sorted((root/'midi').glob('*.mid')) if not p.name.startswith('._')]
    for result in results: result.pop('events')
    print(json.dumps(results, ensure_ascii=False, indent=2))
