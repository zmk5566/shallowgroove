import test from 'node:test';
import assert from 'node:assert/strict';
import {readAttachment} from '../src/assistant/attachments.ts';
import {readFile} from 'node:fs/promises';

test('chat attachments preserve XML and explicitly mark shortened text',async()=>{
 const xml='<score-partwise><part id="P1">音轨</part></score-partwise>';
 assert.equal((await readAttachment(new File([xml],'score.musicxml'),true)).content,xml);
 const excerpt=await readAttachment(new File(['x'.repeat(25000)],'notes.md'),false);
 assert.ok(excerpt.truncated&&excerpt.content.length<=24000);
 await assert.rejects(readAttachment(new File([],'empty.txt'),true));
});
test('MIDI reference includes tempo, tracks and time-stamped note data',async()=>{
 const bytes=await readFile(new URL('../midi/DaisyBell.mid',import.meta.url));
 const a=await readAttachment(new File([bytes],'DaisyBell.midi'),true);
 for(const field of ['ticksPerBeat','firstNotes_tick_channel_pitch_velocity','setTempo'])assert.ok(a.content.includes(field));
});
