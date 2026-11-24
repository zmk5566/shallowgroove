import {Worker, parentPort, workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export function createRenderer({sampleRate}) {
 const worker = new Worker(new URL(import.meta.url), {workerData:{sampleRate, task:'wav-export'}, execArgv:[]});
 let id = 0, closed, stopping;
 const pending = new Map();
 function finish(error) {
  closed = error;
  for (const request of pending.values()) request.reject(error);
  pending.clear();
 }
 worker.on('error', finish);
 worker.on('exit', code => finish(closed ?? Error('Offline audio worker exited (' + code + ')')));
 worker.on('message', ({id, value, error}) => {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  if (error) entry.reject(Error(error)); else entry.resolve(value);
 });
 return {
  request(command) {
   if (closed) return Promise.reject(closed);
   const key = ++id;
   return new Promise((resolve,reject) => {
    pending.set(key,{resolve,reject});
    try { worker.postMessage({id:key, command}); }
    catch (error) { pending.delete(key); reject(error); }
   });
  },
  stop() {
   if (!stopping) {
    finish(Error('Offline audio worker stopped'));
    stopping = worker.terminate();
   }
   return stopping;
  }
 };
}

const quantum = 16;
const stereo = () => [new Float32Array(quantum),new Float32Array(quantum)];
function clear(stereo) { stereo[0].fill(0); stereo[1].fill(0); }
function accumulate(dest, src, gain = 1) {
 for (let c=0;c<2;c++) for (let i=0;i<quantum;i++) dest[c][i] += src[c][i]*gain;
}
async function offlineMixer(sampleRate) {
 // The embedded Emscripten module expects CommonJS globals when running in Node.
 // These are local to the dedicated worker; the bundled compiler never writes to the app directory.
 globalThis.require = createRequire(import.meta.url);
 globalThis.__dirname = dirname(fileURLToPath(import.meta.url));
 const {instantiateFaustModule,LibFaust,FaustCompiler,FaustMonoDspGenerator,FaustPolyDspGenerator} =
  await import('@grame/faustwasm/dist/esm-bundle/index.js');
 const compiler = new FaustCompiler(new LibFaust(await instantiateFaustModule()));
 const {mixerModule} = await compiler.getAsyncInternalMixerModule(false);
 const factories = new Map();
 async function device(code, instrument, values = {}) {
  const key = (instrument?'synth:':'fx:') + code;
  let factory = factories.get(key);
  if (!factory) {
   factory = instrument ? await compiler.createPolyDSPFactory('ShallowSynth',code,'-ftz 2') :
    await compiler.createMonoDSPFactory('ShallowEffect',code,'-ftz 2');
   if (!factory) throw Error('Faust compilation failed');
   const meta = JSON.parse(factory.json);
   if (meta.inputs !== (instrument?0:2) || meta.outputs !== 2) throw Error('Expected a stereo Faust device');
   factories.set(key,factory);
  }
  const dsp = instrument ? await new FaustPolyDspGenerator().createOfflineProcessor(sampleRate,quantum,16,factory,mixerModule) :
   await new FaustMonoDspGenerator().createOfflineProcessor(sampleRate,quantum,factory);
  if (!dsp) throw Error('Could not instantiate offline Faust processor');
  const params = new Set(dsp.getParams());
  for (const [address,value] of Object.entries(values)) if (params.has(address)) dsp.setParamValue(address,value);
  dsp.start();
  return {dsp,params};
 }
 async function rack(spec, instrument) {
  const voice = instrument ? await device(spec.instrument,true,spec.values) : undefined;
  const effects = [];
  for (const fx of spec.effects ?? []) effects.push({...fx,...await device(fx.code,false,fx.values),output:stereo()});
  return {voice, effects, input:stereo(), gain:spec.gain??1, pan:spec.pan??0,
   delay:spec.sends?.delay??0,reverb:spec.sends?.reverb??0};
 }
 function chain(channel) {
  let current = channel.input;
  for (const fx of channel.effects) {
   if (!fx.dsp.compute(current,fx.output)) throw Error('Faust effect stopped');
   if (fx.bypass) { if (fx.wetOnly) clear(current); }
   else current = fx.output;
  }
  return current;
 }
 let tracks=[], buses={}, events=[], cursor=0, computed=0, consumed=quantum;
 let output=stereo();
 const returns=['delay','reverb'];
 function dispatch(event) {
  const channel=typeof event.track==='number'?tracks[event.track]:buses[event.track];
  if (!channel) throw Error('Unknown export track or bus');
  if (event.device==='mixer') {
   const key={'send:delay':'delay','send.delay':'delay','send:reverb':'reverb','send.reverb':'reverb',level:'gain'}[event.address]??event.address;
   if (['delay','reverb','gain','pan'].includes(key)) channel[key]=event.value;
  } else if (event.address) {
   const target=event.device==='instrument'?channel.voice:channel.effects.find(e=>e.id===event.device);
   if (target?.params.has(event.address)) target.dsp.setParamValue(event.address,event.value);
  } else channel.voice.dsp.midiMessage([event.status,event.data1,event.data2]);
 }
 function mix() {
  while (cursor<events.length && events[cursor].frame<=computed) dispatch(events[cursor++]);
  for (const bus of Object.values(buses)) clear(bus.input);
  for (const track of tracks) {
   if (!track.voice.dsp.compute([],track.input)) throw Error('Faust instrument stopped');
   const signal=chain(track), pan=track.pan, angle=(pan<0?pan+1:pan)*Math.PI/2;
   const c=Math.cos(angle),s=Math.sin(angle);
   for (let i=0;i<quantum;i++) {
    const l=signal[0][i], r=signal[1][i];
    signal[0][i]=track.gain*(pan<0?l+r*c:l*c);
    signal[1][i]=track.gain*(pan<0?r*s:r+l*s);
   }
   accumulate(buses.master.input,signal);
   for (const bus of returns) if (track[bus]) accumulate(buses[bus].input,signal,track[bus]);
  }
  for (const id of returns) {
   const bus=buses[id];
   if (bus.effects.length) accumulate(buses.master.input,chain(bus),bus.gain);
  }
  output=chain(buses.master);
  for (const channel of output) for (let i=0;i<quantum;i++) channel[i]*=buses.master.gain;
  computed+=quantum; consumed=0;
 }
 return async command=>{
  switch(command.op) {
   case 'load': {
    tracks=[];
    for(const spec of command.racks) tracks.push(await rack(spec,true));
    for(const id of [...returns,'master']) buses[id]=await rack(command.buses?.[id]??{},false);
    return {};
   }
   case 'play': {
    events=command.events.map(e=>({...e,frame:Math.round(e.time*sampleRate/quantum)*quantum})).sort((a,b)=>a.frame-b.frame);
    computed=cursor=0;consumed=quantum;return {};
   }
   case 'renderPcm24': {
    const n=command.frames, pcm=Buffer.allocUnsafe(n*6);
    let kept=command.tail?0:n;
    for(let i=0;i<n;i++) {
     if(consumed===quantum) mix();
     for(let c=0;c<2;c++) {
      const value=output[c][consumed];
      if(!Number.isFinite(value)) throw Error('Cannot export non-finite audio samples');
      if(command.tail && Math.abs(value)>1e-6) kept=i+1;
      pcm.writeIntLE(Math.max(-8388608,Math.min(8388607,Math.round(value*8388608))),i*6+c*3,3);
     }
     consumed++;
    }
    return {frames:kept,pcm:pcm.toString('base64',0,kept*6)};
   }
   default: throw Error('Unknown offline renderer operation');
  }
 };
}

if (parentPort && workerData?.task==='wav-export') {
 const render = await offlineMixer(workerData.sampleRate);
 parentPort.on('message', async ({id, command})=>{
  try { parentPort.postMessage({id, value:await render(command)}); }
  catch(error) { parentPort.postMessage({id,error:String(error?.message??error)}); }
 });
}
