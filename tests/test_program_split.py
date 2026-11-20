import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from split_program_tracks import split_program_tracks
from midi_labels import label_tracks


def event(order, status, data):
    return dict(order=order, tick=order*10, kind='midi', status=status, data=data, channel=4)


class ProgramSplitTest(unittest.TestCase):
    def test_rhythm_map_and_bank_variants(self):
        address = [0x40, 0x1a, 0x15, 2]
        sysex = dict(kind='sysex', tick=0, order=0,
                     data=[0x41, 0x10, 0x42, 0x12, *address, -sum(address) % 128, 0xf7])
        drum = dict(midi_channel=11, events=[event(1, 0xca, [25])])
        synth = dict(midi_channel=4, events=[event(1, 0xb3, [0, 8]), event(2, 0xc3, [80]), event(3, 0x93, [60, 80])])
        label_tracks(dict(global_events=[sysex], tracks=[drum, synth]))
        self.assertEqual(drum['annotation']['rhythm_map'], 2)
        self.assertEqual(synth['annotation']['initial_program']['bank_msb'], 8)

    def test_held_note_off_follows_old_instrument_and_controllers_reach_both(self):
        events = [event(0, 0xC3, [72]), event(1, 0xB3, [64, 127]),
                  event(2, 0x93, [76, 90]), event(3, 0xC3, [23]),
                  event(4, 0x93, [76, 70]), event(5, 0xA3, [76, 50]),
                  event(6, 0x83, [76, 0]), event(7, 0x93, [76, 0]),
                  event(8, 0xB3, [64, 0]), event(9, 0xE3, [0, 64])]
        project = {'tracks': [{'id': 'midi-channel-4', 'midi_channel': 4, 'events': events}]}
        split_program_tracks(project)
        a, b = project['tracks']
        self.assertTrue(a['id'].endswith('-72'))
        self.assertTrue(b['id'].endswith('-23'))
        self.assertIn(events[6], a['events'])
        self.assertNotIn(events[6], b['events'])
        self.assertIn(events[7], b['events'])
        for controller in [events[1], events[5], events[8], events[9]]:
            self.assertIn(controller, a['events'])
            self.assertIn(controller, b['events'])


if __name__ == '__main__':
    unittest.main()
