const fs = require('node:fs/promises');
const {dirname, join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {createNativeAudio} = require('./native-audio.cjs');

const rendererBytesPerFrame = 6; // Renderer always returns stereo PCM24.
const headerSize = 44;
const tailSeconds = 30;
const blockFrames = 32768;

function waveHeader(sampleRate, frames, bitDepth) {
 const bytesPerFrame = 2 * bitDepth / 8;
 const dataSize = frames * bytesPerFrame;
 const h = Buffer.alloc(headerSize);
 h.write('RIFF', 0); h.writeUInt32LE(36 + dataSize, 4); h.write('WAVEfmt ', 8);
 h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
 h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * bytesPerFrame, 28);
 h.writeUInt16LE(bytesPerFrame, 32); h.writeUInt16LE(bitDepth, 34);
 h.write('data', 36); h.writeUInt32LE(dataSize, 40);
 return h;
}

function pcm16(pcm24) {
 const output = Buffer.allocUnsafe(pcm24.length / 3 * 2);
 for (let src = 0, dst = 0; src < pcm24.length; src += 3, dst += 2) {
  const sample = Math.round(pcm24.readIntLE(src, 3) / 256);
  output.writeInt16LE(Math.min(32767, sample), dst);
 }
 return output;
}

async function writeAt(file, data, position) {
 let offset = 0;
 while (offset < data.length) {
  const {bytesWritten} = await file.write(data, offset, data.length - offset, position + offset);
  if (!bytesWritten) throw Error('Could not write WAV file');
  offset += bytesWritten;
 }
}

function exportEvents(sequence) {
 const events = sequence.events.filter(event => event.time <= sequence.end);
 const channels = new Set();
 for (const event of events) {
  if ((event.status >> 4) === 9 && event.data2 > 0)
   channels.add(event.track * 16 + (event.status & 15));
 }
 // Release unmatched notes and sustain pedals without resetting the effect chain.
 for (const channel of channels)
  events.push({time:sequence.end, track:Math.floor(channel / 16), status:0xb0 + (channel % 16), data1:123, data2:0});
 return events;
}

async function exportAudio({binary, path, graph, sequence, sampleRate, bitDepth = 24, signal, onProgress, createRenderer}) {
 if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000)
  throw Error('Invalid WAV sample rate');
 if (!Number.isFinite(sequence?.end) || sequence.end < 0 || !Array.isArray(sequence.events))
  throw Error('Invalid arrangement for WAV export');
 if (bitDepth !== 16 && bitDepth !== 24) throw Error('Invalid WAV bit depth');
 const bytesPerFrame = 2 * bitDepth / 8;
 const maxFrames = Math.floor((0xffffffff - headerSize + 8) / bytesPerFrame);
 const bodyFrames = Math.round(sequence.end * sampleRate);
 if (bodyFrames > maxFrames) throw Error('Arrangement exceeds the 4 GiB WAV limit');
 const renderFrames = bodyFrames + tailSeconds * sampleRate;
 const temporary = join(dirname(path), '.shallowgroove-' + randomUUID() + '.wav.tmp');
 let helper, file, ownsTemp = false, finalFrames = bodyFrames, stopping;
 const stop = () => { if (helper) return stopping ??= helper.stop(); };
 function checkCancelled() {
  if (signal?.aborted) throw Object.assign(Error('Audio export cancelled'), {name:'AbortError'});
 }
 try {
  checkCancelled();
  signal?.addEventListener('abort', stop, {once:true});
  file = await fs.open(temporary, 'wx', 0o600);
  ownsTemp = true;
  checkCancelled();
  onProgress?.(0);
  checkCancelled();
  helper = createRenderer ? await createRenderer({sampleRate}) :
   createNativeAudio({binary, args:['--headless', '--sample-rate', String(sampleRate)]});
  checkCancelled();
  await helper.request({...graph, op:'load'});
  checkCancelled();
  await helper.request({op:'play', events:exportEvents(sequence), position:0, end:(renderFrames + 1) / sampleRate});
  for (let frame = 0; frame < renderFrames;) {
   checkCancelled();
   const tail = frame >= bodyFrames;
   const frames = Math.min(blockFrames, (tail ? renderFrames : bodyFrames) - frame);
   const result = await helper.request({op:'renderPcm24', frames, tail});
   const pcm = Buffer.from(result.pcm, 'base64');
   if (!Number.isSafeInteger(result.frames) || result.frames < 0 || result.frames > frames ||
       (!tail && result.frames !== frames) || pcm.length !== result.frames * rendererBytesPerFrame)
    throw Error('Incomplete audio block from offline renderer');
   if (result.frames) {
    finalFrames = Math.max(finalFrames, frame + result.frames);
    if (finalFrames > maxFrames) throw Error('Export exceeds the 4 GiB WAV limit');
    await writeAt(file, bitDepth === 16 ? pcm16(pcm) : pcm, headerSize + frame * bytesPerFrame);
   }
   frame += frames;
   if (frame < renderFrames) onProgress?.(frame / renderFrames);
  }
  await writeAt(file, waveHeader(sampleRate, finalFrames, bitDepth), 0);
  await file.sync();
  await file.close();
  file = undefined;
  checkCancelled();
  await fs.rename(temporary, path);
  ownsTemp = false;
  // The file has been published even if the progress window just closed.
  try { onProgress?.(1); } catch {}
  return {path, sampleRate, frames:finalFrames, tailFrames:finalFrames - bodyFrames};
 } catch (error) {
  checkCancelled();
  throw error;
 } finally {
  signal?.removeEventListener('abort', stop);
  try { await stop(); } finally {
   try { await file?.close(); } finally { if (ownsTemp) await fs.unlink(temporary); }
  }
 }
}
module.exports = {exportAudio};
